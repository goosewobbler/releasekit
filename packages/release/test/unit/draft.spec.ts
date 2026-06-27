import type { VersionOutput } from '@releasekit/core';
import { createFakeForge, type FakeForge } from '@releasekit/forge';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// --- Mocks ---

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
  return { ...actual, info: vi.fn(), success: vi.fn() };
});

// --- Helpers ---

const context = { owner: 'o', repo: 'r', token: 'tok', sha: null };

const versionOutput: VersionOutput = {
  dryRun: false,
  updates: [{ packageName: '@scope/core', newVersion: '1.2.0', filePath: 'packages/core/package.json' }],
  changelogs: [],
  commitMessage: 'chore: release 1.2.0',
  tags: ['v1.2.0'],
};

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

// --- Tests ---

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
    expect(issue.body).toContain('- a new feature'); // editable notes region
    // The manifest is stored as a marker comment (not in the editable body).
    const created = await forge.findComment(42, '<!-- releasekit-manifest -->');
    expect(created).not.toBeNull();
  });

  it('should reuse the existing open draft issue instead of stacking a new one', async () => {
    const seeded = createFakeForge({
      openIssues: [{ number: 7, url: 'u', labels: [DRAFT_LABEL] }],
    });
    mockForgeFor.mockReturnValue(seeded);

    await runReleaseDraft(baseOptions);

    expect(seeded.createdIssues).toHaveLength(0); // no new issue
    expect(seeded.updatedIssues.map((u) => u.issueNumber)).toContain(7);
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
  let serializeManifest: typeof import('../../src/standing-pr/standing-pr.js').serializeManifest;

  const manifest = {
    schemaVersion: 2 as const,
    versionOutput,
    releaseNotes: {},
    notesFiles: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    baseSha: 'sha-draft',
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    headSha = 'sha-draft';
    mockGetGitHubContext.mockReturnValue(context);
    mockRunRelease.mockResolvedValue({ versionOutput, notesGenerated: true });
    const mod = await import('../../src/draft/draft.js');
    publishFromDraft = mod.publishFromDraft;
    ({ serializeManifest } = await import('../../src/standing-pr/standing-pr.js'));
  });

  function forgeWithDraft(body: string): FakeForge {
    return createFakeForge({
      issues: { 9: { body, title: 'Release draft', labels: ['release:draft'], isPullRequest: false } },
      comments: [{ id: 1, body: serializeManifest(manifest), prNumber: 9 }],
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
    // Issue closed after a successful publish.
    expect(forge.updatedIssues).toContainEqual({ issueNumber: 9, changes: { state: 'closed' } });
  });

  it('should refuse to publish when HEAD has drifted from the draft baseSha', async () => {
    headSha = 'sha-moved';
    const forge = forgeWithDraft('## Release Notes');
    mockForgeFor.mockReturnValue(forge);

    await expect(publishFromDraft(9, baseOptions)).rejects.toThrow(/HEAD is sha-moved/);
    expect(mockRunRelease).not.toHaveBeenCalled();
  });

  it('should throw when the issue has no manifest comment', async () => {
    const forge = createFakeForge({
      issues: { 9: { body: 'x', title: 't', labels: [], isPullRequest: false } },
    });
    mockForgeFor.mockReturnValue(forge);

    await expect(publishFromDraft(9, baseOptions)).rejects.toThrow(/No release-draft manifest/);
  });

  it('should not close the issue when the publish is a no-op', async () => {
    mockRunRelease.mockResolvedValue(null);
    const forge = forgeWithDraft('## Release Notes');
    mockForgeFor.mockReturnValue(forge);

    await publishFromDraft(9, baseOptions);

    expect(forge.updatedIssues).not.toContainEqual({ issueNumber: 9, changes: { state: 'closed' } });
  });
});
