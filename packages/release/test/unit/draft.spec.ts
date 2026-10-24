import type { VersionOutput } from '@releasekit/core';
import { type CommentAuthor, createFakeForge, type FakeForge } from '@releasekit/forge';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { serializeManifest } from '../../src/standing-pr/standing-pr.js';

const mockGetGitHubContext = vi.fn();
vi.mock('../../src/git.js', () => ({
  getGitHubContext: (...args: unknown[]) => mockGetGitHubContext(...args),
}));

const mockForgeFor = vi.fn();
vi.mock('../../src/github.js', () => ({
  forgeFor: (...args: unknown[]) => mockForgeFor(...args),
}));

const mockRunRelease = vi.fn();
vi.mock('../../src/release.js', () => ({
  runRelease: (...args: unknown[]) => mockRunRelease(...args),
}));

let headSha = 'sha-draft';
vi.mock('@releasekit/git', () => ({
  createGitCli: () => ({ headSha: async () => headSha }),
}));

vi.mock('@releasekit/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@releasekit/core')>();
  return { ...actual, info: vi.fn(), success: vi.fn(), warn: vi.fn() };
});

const context = { owner: 'o', repo: 'r', token: 'tok', sha: null };

const versionOutput: VersionOutput = {
  dryRun: false,
  updates: [{ packageName: '@scope/core', newVersion: '1.2.0', filePath: 'packages/core/package.json' }],
  changelogs: [
    {
      packageName: '@scope/core',
      version: '1.2.0',
      previousVersion: '1.1.0',
      revisionRange: 'v1.1.0..HEAD',
      repoUrl: null,
      entries: [],
    },
  ],
  commitMessage: 'chore: release 1.2.0',
  tags: ['v1.2.0'],
};

const manifest = {
  schemaVersion: 2 as const,
  versionOutput,
  releaseNotes: {},
  notesFiles: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  baseSha: 'sha-draft',
};
const validManifestComment = serializeManifest(manifest);
const botAuthor: CommentAuthor = { login: 'github-actions[bot]', type: 'Bot' };
const humanAuthor: CommentAuthor = { login: 'attacker', type: 'User' };

const baseOptions = {
  dryRun: false,
  sync: false,
  skipNotes: false,
  skipPublish: false,
  skipGit: false,
  skipGithubRelease: false,
  skipVerification: false,
  json: false,
  verbose: false,
  quiet: false,
  projectDir: '/p',
};

describe('runReleaseDraft', () => {
  let runReleaseDraft: typeof import('../../src/draft/draft.js').runReleaseDraft;
  let DRAFT_LABEL: string;
  let forge: FakeForge;

  beforeEach(async () => {
    vi.clearAllMocks();
    headSha = 'sha-draft';
    mockGetGitHubContext.mockReturnValue(context);
    forge = createFakeForge();
    mockForgeFor.mockReturnValue(forge);
    mockRunRelease.mockResolvedValue({
      versionOutput,
      notesGenerated: true,
      releaseNotes: { '@scope/core': '- a new feature' },
    });
    const mod = await import('../../src/draft/draft.js');
    runReleaseDraft = mod.runReleaseDraft;
    DRAFT_LABEL = mod.DRAFT_LABEL;
  });

  it('should compute in dry-run so the working tree is never mutated', async () => {
    await runReleaseDraft(baseOptions);
    expect(mockRunRelease).toHaveBeenCalledWith(expect.objectContaining({ dryRun: true }));
  });

  it('should open a labelled draft issue carrying the editable notes and a manifest comment', async () => {
    await runReleaseDraft(baseOptions);

    expect(forge.createdIssues).toHaveLength(1);
    const issue = forge.createdIssues[0];
    expect(issue.labels).toEqual([DRAFT_LABEL]);
    expect(issue.body).toContain('@scope/core');
    expect(issue.body).toContain('- a new feature');
    const created = await forge.findComment(42, '<!-- releasekit-manifest -->');
    expect(created).not.toBeNull();
  });

  it('should reuse the existing open draft issue (with a manifest comment) instead of stacking a new one', async () => {
    const seeded = createFakeForge({
      openIssues: [{ number: 7, url: 'u', labels: [DRAFT_LABEL] }],
      // A real draft carries a decodable, bot-authored manifest comment - that's what marks it as ours to reuse.
      comments: [{ id: 1, body: validManifestComment, prNumber: 7, user: botAuthor }],
    });
    mockForgeFor.mockReturnValue(seeded);

    await runReleaseDraft(baseOptions);

    expect(seeded.createdIssues).toHaveLength(0);
    expect(seeded.updatedIssues.map((u) => u.issueNumber)).toContain(7);
  });

  it('should NOT overwrite a human-labelled issue that lacks a manifest comment', async () => {
    const seeded = createFakeForge({
      openIssues: [{ number: 7, url: 'u', labels: [DRAFT_LABEL] }],
    });
    mockForgeFor.mockReturnValue(seeded);

    await runReleaseDraft(baseOptions);

    expect(seeded.createdIssues).toHaveLength(1);
    expect(seeded.updatedIssues.map((u) => u.issueNumber)).not.toContain(7);
  });

  it('should NOT reuse an issue whose marker comment is not a valid manifest', async () => {
    const seeded = createFakeForge({
      openIssues: [{ number: 7, url: 'u', labels: [DRAFT_LABEL] }],
      comments: [{ id: 1, body: '<!-- releasekit-manifest -->\nnot-a-real-manifest', prNumber: 7 }],
    });
    mockForgeFor.mockReturnValue(seeded);

    await runReleaseDraft(baseOptions);

    expect(seeded.createdIssues).toHaveLength(1);
    expect(seeded.updatedIssues.map((u) => u.issueNumber)).not.toContain(7);
  });

  it('should NOT reuse an issue whose only manifest comment is human-authored', async () => {
    const seeded = createFakeForge({
      openIssues: [{ number: 7, url: 'u', labels: [DRAFT_LABEL] }],
      comments: [{ id: 1, body: validManifestComment, prNumber: 7, user: humanAuthor }],
    });
    mockForgeFor.mockReturnValue(seeded);

    await runReleaseDraft(baseOptions);

    expect(seeded.createdIssues).toHaveLength(1);
    expect(seeded.updatedIssues.map((u) => u.issueNumber)).not.toContain(7);
    expect(seeded.upsertedComments.map((c) => c.prNumber)).not.toContain(7);
  });

  it('should create no issue when there are no releasable changes', async () => {
    mockRunRelease.mockResolvedValue(null);
    const result = await runReleaseDraft(baseOptions);
    expect(result).toBeNull();
    expect(forge.createdIssues).toHaveLength(0);
  });

  it('should throw when no GitHub token is present', async () => {
    mockGetGitHubContext.mockReturnValue({ ...context, token: null });
    await expect(runReleaseDraft(baseOptions)).rejects.toThrow(/no GitHub token/);
  });
});

describe('publishFromDraft', () => {
  let publishFromDraft: typeof import('../../src/draft/draft.js').publishFromDraft;

  beforeEach(async () => {
    vi.clearAllMocks();
    headSha = 'sha-draft';
    mockGetGitHubContext.mockReturnValue(context);
    mockRunRelease.mockResolvedValue({ versionOutput, notesGenerated: true });
    const mod = await import('../../src/draft/draft.js');
    publishFromDraft = mod.publishFromDraft;
  });

  function forgeWithDraft(body: string, user?: CommentAuthor): FakeForge {
    return createFakeForge({
      issues: { 9: { body, title: 'Release draft', labels: ['release:draft'], isPullRequest: false } },
      comments: [{ id: 1, body: serializeManifest(manifest), prNumber: 9, user }],
      openIssues: [{ number: 9, url: 'u', labels: ['release:draft'] }],
    });
  }

  it('should extract edited notes, publish with them, and close the issue', async () => {
    const { wrapNotesRegion } = await import('@releasekit/core');
    const body = `## Release Notes\n${wrapNotesRegion('- EDITED BY HUMAN', '@scope/core')}`;
    const forge = forgeWithDraft(body);
    mockForgeFor.mockReturnValue(forge);

    await publishFromDraft(9, baseOptions);

    expect(mockRunRelease).toHaveBeenCalledWith(
      expect.objectContaining({ dryRun: false, editedNotes: { '@scope/core': '- EDITED BY HUMAN' } }),
    );
    expect(forge.updatedIssues).toContainEqual({ issueNumber: 9, changes: { state: 'closed' } });
  });

  it('should publish from a bot-authored manifest comment', async () => {
    const forge = forgeWithDraft('## Release Notes', botAuthor);
    mockForgeFor.mockReturnValue(forge);

    await publishFromDraft(9, baseOptions);

    expect(mockRunRelease).toHaveBeenCalledWith(expect.objectContaining({ dryRun: false }));
    expect(forge.updatedIssues).toContainEqual({ issueNumber: 9, changes: { state: 'closed' } });
  });

  it('should refuse a manifest comment the bot did not write, before computing the release', async () => {
    const forge = forgeWithDraft('## Release Notes', humanAuthor);
    mockForgeFor.mockReturnValue(forge);

    await expect(publishFromDraft(9, baseOptions)).rejects.toThrow(
      /authored by 'attacker', not the release bot.*Re-run 'releasekit release --draft'/,
    );
    expect(mockRunRelease).not.toHaveBeenCalled();
    expect(forge.updatedIssues).toHaveLength(0);
  });

  it('should read a sync draft edit from the region keyed by the changelog', async () => {
    const { warn, wrapNotesRegion } = await import('@releasekit/core');
    const syncOutput: VersionOutput = {
      ...versionOutput,
      strategy: 'sync',
      changelogs: [
        {
          packageName: 'monorepo',
          version: '1.2.0',
          previousVersion: '1.1.0',
          revisionRange: 'v1.1.0..HEAD',
          repoUrl: null,
          entries: [],
        },
      ],
    };
    mockRunRelease.mockResolvedValue({ versionOutput: syncOutput, notesGenerated: true });
    const syncManifest = { ...manifest, versionOutput: syncOutput, releaseNotes: { monorepo: '- drafted' } };
    const forge = createFakeForge({
      issues: {
        9: {
          body: `## Release Notes\n${wrapNotesRegion('- EDITED SYNC NOTES', 'monorepo')}`,
          title: 'Release draft',
          labels: ['release:draft'],
          isPullRequest: false,
        },
      },
      comments: [{ id: 1, body: serializeManifest(syncManifest), prNumber: 9 }],
      openIssues: [{ number: 9, url: 'u', labels: ['release:draft'] }],
    });
    mockForgeFor.mockReturnValue(forge);

    await publishFromDraft(9, baseOptions);

    expect(mockRunRelease).toHaveBeenCalledWith(
      expect.objectContaining({ editedNotes: { monorepo: '- EDITED SYNC NOTES' } }),
    );
    expect(vi.mocked(warn)).not.toHaveBeenCalledWith(expect.stringContaining('markers may have been removed'));
  });

  async function dispatchOversizedSyncDraft(editRegion: boolean): Promise<{ full: string; published: string }> {
    const { renderNotesRegion } = await import('../../src/standing-pr/notes-region.js');
    const full = `- ${'x'.repeat(9000)}`;
    const syncOutput: VersionOutput = {
      ...versionOutput,
      strategy: 'sync',
      changelogs: [
        {
          packageName: 'monorepo',
          version: '1.2.0',
          previousVersion: '1.1.0',
          revisionRange: 'v1.1.0..HEAD',
          repoUrl: null,
          entries: [],
        },
      ],
    };
    mockRunRelease.mockResolvedValue({ versionOutput: syncOutput, notesGenerated: true });
    const rendered = renderNotesRegion({ monorepo: full });
    const forge = createFakeForge({
      issues: {
        9: {
          body: editRegion ? rendered.replace('- x', '- EDITED x') : rendered,
          title: 'Release draft',
          labels: ['release:draft'],
          isPullRequest: false,
        },
      },
      comments: [
        {
          id: 1,
          body: serializeManifest({ ...manifest, versionOutput: syncOutput, releaseNotes: { monorepo: full } }),
          prNumber: 9,
        },
      ],
      openIssues: [{ number: 9, url: 'u', labels: ['release:draft'] }],
    });
    mockForgeFor.mockReturnValue(forge);

    await publishFromDraft(9, baseOptions);

    return { full, published: mockRunRelease.mock.calls.at(-1)?.[0].editedNotes.monorepo };
  }

  it('should publish the full drafted notes when a truncated region is untouched', async () => {
    const { full, published } = await dispatchOversizedSyncDraft(false);

    expect(published).toBe(full);
  });

  it('should publish the edit when a truncated region was changed', async () => {
    const { full, published } = await dispatchOversizedSyncDraft(true);

    expect(published).not.toBe(full);
    expect(published.startsWith('- EDITED x')).toBe(true);
  });

  it('should refuse to publish when HEAD has drifted from the draft baseSha', async () => {
    headSha = 'sha-moved';
    const forge = forgeWithDraft('## Release Notes');
    mockForgeFor.mockReturnValue(forge);

    await expect(publishFromDraft(9, baseOptions)).rejects.toThrow(/HEAD is sha-moved/);
    expect(mockRunRelease).not.toHaveBeenCalled();
  });

  it('should refuse when the recomputed plan differs from the reviewed draft', async () => {
    // Preview (first runRelease call) recomputes a different plan than the manifest stored.
    mockRunRelease.mockReset();
    mockRunRelease.mockResolvedValueOnce({
      versionOutput: {
        ...versionOutput,
        updates: [{ packageName: '@scope/core', newVersion: '2.0.0', filePath: 'p' }],
      },
    });
    const forge = forgeWithDraft('## Release Notes');
    mockForgeFor.mockReturnValue(forge);

    await expect(publishFromDraft(9, baseOptions)).rejects.toThrow(/differs from the reviewed draft/);
    // Only the preview ran - no real publish.
    expect(mockRunRelease).toHaveBeenCalledTimes(1);
    expect(forge.updatedIssues).not.toContainEqual({ issueNumber: 9, changes: { state: 'closed' } });
  });

  it('should refuse when only tags/commit-message drift even though name@version matches', async () => {
    // Same name@version as the manifest, but different tags & commit message - only the full-plan fingerprint
    // catches it.
    mockRunRelease.mockReset();
    mockRunRelease.mockResolvedValueOnce({
      versionOutput: { ...versionOutput, tags: ['v9.9.9'], commitMessage: 'chore: a different release' },
    });
    const forge = forgeWithDraft('## Release Notes');
    mockForgeFor.mockReturnValue(forge);

    await expect(publishFromDraft(9, baseOptions)).rejects.toThrow(/differs from the reviewed draft/);
    expect(mockRunRelease).toHaveBeenCalledTimes(1);
    expect(forge.updatedIssues).not.toContainEqual({ issueNumber: 9, changes: { state: 'closed' } });
  });

  it('should respect --dry-run: validate without publishing or closing', async () => {
    const forge = forgeWithDraft('## Release Notes');
    mockForgeFor.mockReturnValue(forge);

    await publishFromDraft(9, { ...baseOptions, dryRun: true });

    expect(mockRunRelease).toHaveBeenCalledWith(expect.objectContaining({ dryRun: true }));
    expect(forge.updatedIssues).not.toContainEqual({ issueNumber: 9, changes: { state: 'closed' } });
  });

  it('should not close the issue on a --skip-publish run', async () => {
    const forge = forgeWithDraft('## Release Notes');
    mockForgeFor.mockReturnValue(forge);

    await publishFromDraft(9, { ...baseOptions, skipPublish: true });

    expect(forge.updatedIssues).not.toContainEqual({ issueNumber: 9, changes: { state: 'closed' } });
  });

  it('should fall back to drafted notes and warn when an editable region was removed', async () => {
    const { warn } = await import('@releasekit/core');
    const draftWithNotes = { ...manifest, releaseNotes: { '@scope/core': '- reviewed in the draft' } };
    const forge = createFakeForge({
      issues: { 9: { body: 'no markers here', title: 't', labels: ['release:draft'], isPullRequest: false } },
      comments: [{ id: 1, body: serializeManifest(draftWithNotes), prNumber: 9 }],
      openIssues: [{ number: 9, url: 'u', labels: ['release:draft'] }],
    });
    mockForgeFor.mockReturnValue(forge);

    await publishFromDraft(9, baseOptions);

    expect(vi.mocked(warn)).toHaveBeenCalledWith(expect.stringContaining('markers may have been removed'));
    expect(mockRunRelease).toHaveBeenCalledWith(
      expect.objectContaining({ editedNotes: { '@scope/core': '- reviewed in the draft' } }),
    );
  });

  it('should throw when the issue has no manifest comment', async () => {
    const forge = createFakeForge({
      issues: { 9: { body: 'x', title: 't', labels: [], isPullRequest: false } },
    });
    mockForgeFor.mockReturnValue(forge);

    await expect(publishFromDraft(9, baseOptions)).rejects.toThrow(/No release-draft manifest/);
  });
});
