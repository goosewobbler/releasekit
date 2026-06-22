import { createFakeForge, type FakeForge, type FakeForgeSeed } from '@releasekit/forge';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderFailureReport, renderResolvedReport } from '../../src/failure-report/failure-report.js';
import { renderNotesRegion } from '../../src/standing-pr/notes-region.js';
import type { StandingPRManifest } from '../../src/standing-pr/standing-pr.js';
import {
  createReleaseTags,
  findLatestMergedStandingPR,
  parseManifest,
  publishFromManifest,
  runStandingPRMerge,
  runStandingPRPublish,
  runStandingPRUpdate,
  STANDING_PR_BODY_CAP,
  serializeManifest,
} from '../../src/standing-pr/standing-pr.js';

vi.mock('node:child_process', () => ({
  execSync: vi.fn().mockReturnValue(''),
  execFileSync: vi.fn().mockReturnValue(''),
}));

vi.mock('node:fs', () => ({
  default: {
    readFileSync: vi.fn(),
  },
  readFileSync: vi.fn(),
}));

vi.mock('@releasekit/config', () => ({
  loadCIConfig: vi.fn(),
  loadConfig: vi.fn().mockReturnValue({
    ci: { standingPr: { branch: 'release/next', deleteBranchOnMerge: true } },
    git: { branch: 'main' },
    release: { ci: { skipPatterns: ['chore: release '] } },
  }),
}));

vi.mock('../../src/steps.js', () => ({
  runVersionStep: vi.fn(),
  runNotesStep: vi.fn(),
  runPublishStep: vi.fn(),
}));

vi.mock('../../src/github.js', () => ({
  forgeFor: vi.fn(),
}));

function createMockVersionOutput(updates: { packageName: string; newVersion: string }[] = []) {
  return {
    dryRun: false,
    updates: updates.map((u) => ({ ...u, filePath: `packages/${u.packageName}/package.json` })),
    changelogs: [],
    tags: updates.map((u) => `${u.packageName}@v${u.newVersion}`),
    commitMessage: `chore: release ${updates.map((u) => u.packageName).join(', ')}`,
    sharedEntries: [],
  };
}

const MANIFEST_MARKER = '<!-- releasekit-manifest -->';

// Build a FakeForge from seed state and point the mocked `forgeFor` at it, so production code
// that calls `forgeFor(githubContext)` is driven by this fake.
async function mockForge(seed: FakeForgeSeed = {}): Promise<FakeForge> {
  const { forgeFor } = await import('../../src/github.js');
  const forge = createFakeForge(seed);
  vi.mocked(forgeFor).mockReturnValue(forge);
  return forge;
}

function openStandingPR(number: number, labels: string[] = []) {
  return { number, url: `https://github.com/owner/repo/pull/${number}`, labels };
}

const baseManifest: StandingPRManifest = {
  schemaVersion: 1,
  versionOutput: createMockVersionOutput([{ packageName: '@scope/core', newVersion: '1.2.3' }]),
  releaseNotes: { '@scope/core': '- added new feature' },
  notesFiles: ['packages/core/CHANGELOG.md'],
  createdAt: '2024-01-01T00:00:00.000Z',
  baseSha: 'abc123',
};

describe('createReleaseTags', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('should be a no-op for an empty tag list', async () => {
    const { execSync, execFileSync } = await import('node:child_process');
    createReleaseTags([], '/tmp/test');
    expect(execSync).not.toHaveBeenCalled();
    expect(execFileSync).not.toHaveBeenCalled();
  });

  it('should create a tag when none exists', async () => {
    const { execFileSync } = await import('node:child_process');
    // git rev-parse HEAD
    vi.mocked(execFileSync).mockReturnValueOnce('headsha\n');
    // git rev-parse --verify (doesn't exist) — throws
    vi.mocked(execFileSync).mockImplementationOnce(() => {
      throw new Error('not found');
    });
    // git tag -a (succeeds)
    vi.mocked(execFileSync).mockReturnValueOnce('');

    createReleaseTags(['v1.2.3'], '/tmp/test');

    expect(execFileSync).toHaveBeenLastCalledWith(
      'git',
      ['tag', '-a', 'v1.2.3', '-m', 'Release v1.2.3'],
      expect.anything(),
    );
  });

  it('should skip creation when the tag already points at HEAD', async () => {
    const { execFileSync } = await import('node:child_process');
    vi.mocked(execFileSync).mockReturnValueOnce('headsha\n');
    // tag exists at HEAD
    vi.mocked(execFileSync).mockReturnValueOnce('headsha\n');

    createReleaseTags(['v1.2.3'], '/tmp/test');

    // Two calls only: rev-parse HEAD, rev-parse refs/tags/...^{}. No `git tag -a`.
    expect(execFileSync).toHaveBeenCalledTimes(2);
    expect(execFileSync).not.toHaveBeenCalledWith('git', expect.arrayContaining(['tag', '-a']), expect.anything());
  });

  it('should not recreate a tag that points at a different commit', async () => {
    const { execFileSync } = await import('node:child_process');
    vi.mocked(execFileSync).mockReturnValueOnce('headsha\n');
    vi.mocked(execFileSync).mockReturnValueOnce('othersha\n');

    createReleaseTags(['v1.2.3'], '/tmp/test');

    expect(execFileSync).not.toHaveBeenCalledWith('git', expect.arrayContaining(['tag', '-a']), expect.anything());
  });

  it('should process multiple tags independently', async () => {
    const { execFileSync } = await import('node:child_process');
    // git rev-parse HEAD
    vi.mocked(execFileSync).mockReturnValueOnce('headsha\n');
    // tag 1: doesn't exist
    vi.mocked(execFileSync).mockImplementationOnce(() => {
      throw new Error('not found');
    });
    // tag 1: git tag -a (succeeds)
    vi.mocked(execFileSync).mockReturnValueOnce('');
    // tag 2: exists at HEAD
    vi.mocked(execFileSync).mockReturnValueOnce('headsha\n');

    createReleaseTags(['v1.2.3', '@scope/pkg@v1.2.3'], '/tmp/test');

    expect(execFileSync).toHaveBeenCalledWith(
      'git',
      ['tag', '-a', 'v1.2.3', '-m', 'Release v1.2.3'],
      expect.anything(),
    );
    // Exactly one `git tag -a` invocation — the second tag was already at HEAD.
    const tagCalls = vi.mocked(execFileSync).mock.calls.filter((c) => c[1]?.[0] === 'tag');
    expect(tagCalls).toHaveLength(1);
  });

  it('should not throw when tag creation fails', async () => {
    const { execFileSync } = await import('node:child_process');
    vi.mocked(execFileSync).mockReturnValueOnce('headsha\n');
    vi.mocked(execFileSync).mockImplementationOnce(() => {
      throw new Error('not found');
    });
    vi.mocked(execFileSync).mockImplementationOnce(() => {
      throw new Error('git tag failed');
    });

    expect(() => createReleaseTags(['v1.2.3'], '/tmp/test')).not.toThrow();
  });

  it('should not throw when HEAD lookup fails', async () => {
    const { execFileSync } = await import('node:child_process');
    vi.mocked(execFileSync).mockImplementationOnce(() => {
      throw new Error('fatal: not a git repository');
    });

    expect(() => createReleaseTags(['v1.2.3'], '/tmp/test')).not.toThrow();
    // Bails at HEAD lookup — only one call.
    expect(execFileSync).toHaveBeenCalledTimes(1);
  });
});

describe('serializeManifest / parseManifest', () => {
  it('should round-trip a manifest through serialize/parse', () => {
    const serialized = serializeManifest(baseManifest);
    expect(serialized).toContain('<!-- releasekit-manifest -->');
    expect(serialized).toMatch(/<!-- base64 [A-Za-z0-9+/=]+ -->/);

    const parsed = parseManifest(serialized);
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.versionOutput.updates).toHaveLength(1);
    expect(parsed.releaseNotes['@scope/core']).toBe('- added new feature');
    expect(parsed.baseSha).toBe('abc123');
  });

  it('should throw when manifest comment is missing', () => {
    expect(() => parseManifest('No marker here')).toThrow(/not found or malformed/);
  });

  it('should throw when manifest encoding is invalid', () => {
    const bad = '<!-- releasekit-manifest -->\n<!-- base64 !!!invalid!!! -->';
    expect(() => parseManifest(bad)).toThrow(/encoding is invalid|malformed/);
  });

  it('should throw when schemaVersion is incompatible', () => {
    const wrongVersion = serializeManifest({ ...baseManifest, schemaVersion: 99 as unknown as 1 });
    expect(() => parseManifest(wrongVersion)).toThrow(/incompatible/);
  });

  it('should accept a v1 manifest without firstUpdatedAt (backward compat)', () => {
    // v1 manifests from before schema v2 have no firstUpdatedAt
    const v1Manifest = { ...baseManifest, schemaVersion: 1 as const };
    const serialized = serializeManifest(v1Manifest);
    const parsed = parseManifest(serialized);
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.firstUpdatedAt).toBeUndefined();
  });

  it('should round-trip a v2 manifest with firstUpdatedAt', () => {
    const v2Manifest = {
      ...baseManifest,
      schemaVersion: 2 as const,
      firstUpdatedAt: '2024-06-01T12:00:00.000Z',
    };
    const serialized = serializeManifest(v2Manifest);
    const parsed = parseManifest(serialized);
    expect(parsed.schemaVersion).toBe(2);
    expect(parsed.firstUpdatedAt).toBe('2024-06-01T12:00:00.000Z');
  });

  it('should round-trip overrideLabels (#337)', () => {
    const m = { ...baseManifest, schemaVersion: 2 as const, overrideLabels: ['bump:major', 'channel:prerelease'] };
    const parsed = parseManifest(serializeManifest(m));
    expect(parsed.overrideLabels).toEqual(['bump:major', 'channel:prerelease']);
  });

  it('should accept a manifest without overrideLabels (backward compat)', () => {
    const parsed = parseManifest(serializeManifest(baseManifest));
    expect(parsed.overrideLabels).toBeUndefined();
  });
});

describe('runStandingPRUpdate', () => {
  const originalEnv = { ...process.env };

  const defaultConfig = {
    ci: {
      standingPr: {
        branch: 'release/next',
        labels: ['release'],
        deleteBranchOnMerge: true,
        mergeMethod: 'squash',
        title: 'chore: release ${count} package(s)',
      },
      releaseStrategy: 'standing-pr',
      releaseTrigger: 'label',
      prPreview: true,
      autoRelease: false,
      skipPatterns: ['chore: release '],
      minChanges: 1,
      labels: {
        stable: 'channel:stable',
        prerelease: 'channel:prerelease',
        skip: 'release:skip',
        immediate: 'release:immediate',
        previewNotes: 'release:preview-notes',
        major: 'bump:major',
        minor: 'bump:minor',
        patch: 'bump:patch',
        withPrerequisites: 'release:with-prerequisites',
      },
    },
    git: { branch: 'main', remote: 'origin', pushMethod: 'auto' },
    release: { ci: { skipPatterns: ['chore: release '] } },
  };

  beforeEach(async () => {
    vi.resetAllMocks();
    process.env.GITHUB_REPOSITORY = 'owner/repo';
    process.env.GITHUB_TOKEN = 'test-token';

    const { loadConfig } = await import('@releasekit/config');
    vi.mocked(loadConfig).mockReturnValue(defaultConfig as ReturnType<typeof loadConfig>);

    const { execSync } = await import('node:child_process');
    vi.mocked(execSync).mockReturnValue('abc123\n');
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('should return noop when HEAD commit matches skip pattern', async () => {
    const { execSync } = await import('node:child_process');
    vi.mocked(execSync).mockReturnValueOnce('chore: release @scope/core v1.2.3');

    const result = await runStandingPRUpdate({
      projectDir: '/test',
      verbose: false,
      quiet: false,
      json: false,
    });

    expect(result.action).toBe('noop');
  });

  it('should return noop when a release commit lands on the base branch during the run (#323)', async () => {
    // Top-of-function guard sees a non-release HEAD (passes), but after resetting to origin/main a
    // release commit is now HEAD — a release merged mid-run. The post-reset recheck must bow out so
    // the standing PR doesn't double-bump off the just-merged-but-untagged version bump.
    const { execSync } = await import('node:child_process');
    let logCalls = 0;
    vi.mocked(execSync).mockImplementation((cmd: string) => {
      if (typeof cmd === 'string' && cmd.includes('git log -1 --pretty=%s')) {
        logCalls += 1;
        return logCalls === 1 ? 'feat: something (#320)' : 'chore: release v0.29.0 (#318)';
      }
      return 'abc123\n';
    });

    const { runVersionStep, runNotesStep } = await import('../../src/steps.js');
    const versionOutput = createMockVersionOutput([{ packageName: '@scope/core', newVersion: '0.29.0' }]);
    vi.mocked(runVersionStep).mockResolvedValue(versionOutput as unknown as Awaited<ReturnType<typeof runVersionStep>>);
    vi.mocked(runNotesStep).mockResolvedValue({ packageNotes: {}, releaseNotes: {}, files: [] });

    const forge = await mockForge({ standingPR: openStandingPR(99) });

    const result = await runStandingPRUpdate({ projectDir: '/test', verbose: false, quiet: false, json: false });

    expect(result.action).toBe('noop');
    // No PR write — the update bowed out before force-push / PR update.
    expect(forge.updatedPullRequests).toHaveLength(0);
    expect(forge.createdPullRequests).toHaveLength(0);
  });

  it('should bypass the skip-pattern guard when reconcile is set', async () => {
    // HEAD is a release commit (matches the skip pattern) — the post-release reconcile scenario.
    // Without reconcile this would noop; with reconcile it must proceed and create the PR.
    const { execSync } = await import('node:child_process');
    vi.mocked(execSync).mockReturnValue('chore: release @scope/core v1.2.3');

    const { runVersionStep, runNotesStep } = await import('../../src/steps.js');
    const versionOutput = createMockVersionOutput([{ packageName: '@scope/core', newVersion: '1.2.3' }]);
    vi.mocked(runVersionStep)
      .mockResolvedValueOnce(versionOutput as unknown as Awaited<ReturnType<typeof runVersionStep>>)
      .mockResolvedValueOnce(versionOutput as unknown as Awaited<ReturnType<typeof runVersionStep>>);
    vi.mocked(runNotesStep).mockResolvedValue({ packageNotes: {}, releaseNotes: {}, files: [] });

    const forge = await mockForge({ standingPR: null });

    const result = await runStandingPRUpdate({
      projectDir: '/test',
      verbose: false,
      quiet: false,
      json: false,
      reconcile: true,
    });

    expect(result.action).toBe('created');
    expect(forge.createdPullRequests).toHaveLength(1);
  });

  it('should enable prerequisites in the version run when the with-prerequisites label is present', async () => {
    const { runVersionStep, runNotesStep } = await import('../../src/steps.js');
    const versionOutput = createMockVersionOutput([{ packageName: '@scope/app', newVersion: '1.2.3' }]);
    vi.mocked(runVersionStep).mockResolvedValue(versionOutput as unknown as Awaited<ReturnType<typeof runVersionStep>>);
    vi.mocked(runNotesStep).mockResolvedValue({ packageNotes: {}, releaseNotes: {}, files: [] });

    await mockForge({ standingPR: openStandingPR(99, ['release:with-prerequisites']) });

    await runStandingPRUpdate({ projectDir: '/test', verbose: false, quiet: false, json: false });

    // The label OR'd `includePrerequisites` into the version run (dry-run call is the first one).
    const firstCall = vi.mocked(runVersionStep).mock.calls[0]?.[0] as { includePrerequisites?: boolean };
    expect(firstCall.includePrerequisites).toBe(true);
  });

  it('should render the PR body grouped by target → its prerequisites', async () => {
    const { runVersionStep, runNotesStep } = await import('../../src/steps.js');
    const versionOutput = {
      ...createMockVersionOutput([
        { packageName: '@scope/app', newVersion: '2.0.0' },
        { packageName: '@scope/core', newVersion: '1.1.0' },
      ]),
      strategy: 'async' as const,
      changelogs: [
        {
          packageName: '@scope/app',
          version: '2.0.0',
          previousVersion: '1.0.0',
          revisionRange: '',
          repoUrl: null,
          entries: [],
        },
        {
          packageName: '@scope/core',
          version: '1.1.0',
          previousVersion: '1.0.0',
          revisionRange: '',
          repoUrl: null,
          entries: [],
        },
      ],
    };
    versionOutput.updates[0]!.role = 'target';
    versionOutput.updates[1]!.role = 'prerequisite';
    versionOutput.updates[1]!.prerequisiteOf = ['@scope/app'];
    vi.mocked(runVersionStep)
      .mockResolvedValueOnce(versionOutput as unknown as Awaited<ReturnType<typeof runVersionStep>>)
      .mockResolvedValueOnce(versionOutput as unknown as Awaited<ReturnType<typeof runVersionStep>>);
    vi.mocked(runNotesStep).mockResolvedValue({ packageNotes: {}, releaseNotes: {}, files: [] });

    const forge = await mockForge({ standingPR: null });

    await runStandingPRUpdate({ projectDir: '/test', verbose: false, quiet: false, json: false });

    const body = forge.createdPullRequests[0]?.body ?? '';
    expect(body).toContain('@scope/app');
    expect(body).toContain('(major)'); // target's overridden bump
    expect(body).toContain('prerequisite');
    expect(body).toContain('@scope/core');
    expect(body).toContain('(minor)'); // prerequisite's own commit-driven bump
  });

  it('should list a prerequisite whose target has no update entry rather than render an empty body', async () => {
    // The targeted package (@scope/app) had no releasable change of its own, so the engine never
    // emits an update for it and it is never tagged 'target'. Its changed prerequisite (@scope/core)
    // still publishes — the body must show it, not just the intro line.
    const { runVersionStep, runNotesStep } = await import('../../src/steps.js');
    const versionOutput = {
      ...createMockVersionOutput([{ packageName: '@scope/core', newVersion: '1.1.0' }]),
      strategy: 'async' as const,
      changelogs: [
        {
          packageName: '@scope/core',
          version: '1.1.0',
          previousVersion: '1.0.0',
          revisionRange: '',
          repoUrl: null,
          entries: [],
        },
      ],
    };
    versionOutput.updates[0]!.role = 'prerequisite';
    versionOutput.updates[0]!.prerequisiteOf = ['@scope/app'];
    vi.mocked(runVersionStep)
      .mockResolvedValueOnce(versionOutput as unknown as Awaited<ReturnType<typeof runVersionStep>>)
      .mockResolvedValueOnce(versionOutput as unknown as Awaited<ReturnType<typeof runVersionStep>>);
    vi.mocked(runNotesStep).mockResolvedValue({ packageNotes: {}, releaseNotes: {}, files: [] });

    const forge = await mockForge({ standingPR: null });

    await runStandingPRUpdate({ projectDir: '/test', verbose: false, quiet: false, json: false });

    const body = forge.createdPullRequests[0]?.body ?? '';
    expect(body).toContain('@scope/core');
    expect(body).toContain('(minor)');
  });

  it('should exclude a package the maintainer unticked in the selection region (#367)', async () => {
    const { runVersionStep, runNotesStep } = await import('../../src/steps.js');
    const versionOutput = {
      ...createMockVersionOutput([
        { packageName: '@scope/a', newVersion: '1.1.0' },
        { packageName: '@scope/b', newVersion: '2.0.0' },
      ]),
      strategy: 'async' as const,
    };
    vi.mocked(runVersionStep).mockResolvedValue(versionOutput as unknown as Awaited<ReturnType<typeof runVersionStep>>);
    vi.mocked(runNotesStep).mockResolvedValue({ packageNotes: {}, releaseNotes: {}, files: [] });

    // The live PR body carries a prior selection with @scope/b unticked.
    const priorBody = [
      '<!-- releasekit-selection -->',
      '',
      '- [x] `@scope/a` → 1.1.0 <!-- rk-sel:@scope/a -->',
      '- [ ] `@scope/b` → 2.0.0 <!-- rk-sel:@scope/b -->',
      '',
      '<!-- releasekit-selection-end -->',
    ].join('\n');
    const forge = await mockForge({
      standingPR: openStandingPR(99),
      pullRequests: { 99: { body: priorBody, labels: [] } },
    });

    await runStandingPRUpdate({ projectDir: '/test', verbose: false, quiet: false, json: false });

    // The write run (second call) excludes the unticked package so it is never bumped.
    const writeCall = vi.mocked(runVersionStep).mock.calls[1]?.[0] as { exclude?: string[] };
    expect(writeCall.exclude).toEqual(['@scope/b']);

    // The regenerated body preserves the untick (merge-preserve) — @scope/b stays unticked, @scope/a ticked.
    const updatedBody = forge.updatedPullRequests[0]?.changes.body ?? '';
    expect(updatedBody).toContain('- [ ] `@scope/b`');
    expect(updatedBody).toContain('- [x] `@scope/a`');
  });

  const selectionBody = (untickedB = true) =>
    [
      '<!-- releasekit-selection -->',
      '',
      '- [x] `@scope/a` → 1.1.0 <!-- rk-sel:@scope/a -->',
      `- [${untickedB ? ' ' : 'x'}] \`@scope/b\` → 2.0.0 <!-- rk-sel:@scope/b -->`,
      '',
      '<!-- releasekit-selection-end -->',
    ].join('\n');

  const withAuthz = async () => {
    const { loadConfig } = await import('@releasekit/config');
    vi.mocked(loadConfig).mockReturnValue({
      ...defaultConfig,
      ci: {
        ...defaultConfig.ci,
        standingPr: { ...defaultConfig.ci.standingPr, authorization: { requiredPermission: 'admin' } },
      },
    } as unknown as ReturnType<typeof loadConfig>);
  };

  const asEditedBy = async (login: string) => {
    const { readFileSync } = await import('node:fs');
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify({ action: 'edited', sender: { login, type: 'User' } }));
    process.env.GITHUB_EVENT_NAME = 'pull_request';
    process.env.GITHUB_EVENT_PATH = '/event.json';
  };

  it('should honour an authorized actor’s checkbox untick (#401)', async () => {
    await withAuthz();
    await asEditedBy('admin-user');
    const { runVersionStep, runNotesStep } = await import('../../src/steps.js');
    const versionOutput = {
      ...createMockVersionOutput([
        { packageName: '@scope/a', newVersion: '1.1.0' },
        { packageName: '@scope/b', newVersion: '2.0.0' },
      ]),
      strategy: 'async' as const,
    };
    vi.mocked(runVersionStep).mockResolvedValue(versionOutput as unknown as Awaited<ReturnType<typeof runVersionStep>>);
    vi.mocked(runNotesStep).mockResolvedValue({ packageNotes: {}, releaseNotes: {}, files: [] });

    await mockForge({
      standingPR: openStandingPR(99),
      pullRequests: { 99: { body: selectionBody(), labels: [] } },
      actorPermissions: { 'admin-user': 'admin' },
    });

    await runStandingPRUpdate({ projectDir: '/test', verbose: false, quiet: false, json: false });

    const writeCall = vi.mocked(runVersionStep).mock.calls[1]?.[0] as { exclude?: string[] };
    expect(writeCall.exclude).toEqual(['@scope/b']); // admin's untick is applied
  });

  it('should ignore an unauthorized actor’s untick (manifest stays authoritative) and post a notice (#401)', async () => {
    await withAuthz();
    await asEditedBy('rando');
    const { runVersionStep, runNotesStep } = await import('../../src/steps.js');
    const versionOutput = {
      ...createMockVersionOutput([
        { packageName: '@scope/a', newVersion: '1.1.0' },
        { packageName: '@scope/b', newVersion: '2.0.0' },
      ]),
      strategy: 'async' as const,
    };
    vi.mocked(runVersionStep).mockResolvedValue(versionOutput as unknown as Awaited<ReturnType<typeof runVersionStep>>);
    vi.mocked(runNotesStep).mockResolvedValue({ packageNotes: {}, releaseNotes: {}, files: [] });

    // Body unticks @scope/b, but the authoritative manifest holds back @scope/a — the unauthorized
    // edit must be ignored and the manifest's selection used instead.
    const forge = await mockForge({
      standingPR: openStandingPR(99),
      pullRequests: { 99: { body: selectionBody(), labels: [] } },
      actorPermissions: { rando: 'write' }, // below the 'admin' threshold
      comments: [{ id: 5, prNumber: 99, body: serializeManifest({ ...baseManifest, deselected: ['@scope/a'] }) }],
    });

    await runStandingPRUpdate({ projectDir: '/test', verbose: false, quiet: false, json: false });

    const writeCall = vi.mocked(runVersionStep).mock.calls[1]?.[0] as { exclude?: string[] };
    expect(writeCall.exclude).toEqual(['@scope/a']); // manifest's selection wins, not the body's
    expect(forge.upsertedComments.some((c) => c.marker === '<!-- releasekit-selection-denied -->')).toBe(true);
  });

  it('should never honour a residual selection region in a sync release (#367)', async () => {
    // A repo that switched to sync may carry a leftover selection region. Sync ships atomically, so a
    // stale deselection must NOT narrow it into a partial release — exclude stays empty.
    const { runVersionStep, runNotesStep } = await import('../../src/steps.js');
    const versionOutput = {
      ...createMockVersionOutput([
        { packageName: '@scope/a', newVersion: '1.1.0' },
        { packageName: '@scope/b', newVersion: '1.1.0' },
      ]),
      strategy: 'sync' as const,
    };
    vi.mocked(runVersionStep).mockResolvedValue(versionOutput as unknown as Awaited<ReturnType<typeof runVersionStep>>);
    vi.mocked(runNotesStep).mockResolvedValue({ packageNotes: {}, releaseNotes: {}, files: [] });

    const priorBody = [
      '<!-- releasekit-selection -->',
      '',
      '- [ ] `@scope/b` → 1.1.0 <!-- rk-sel:@scope/b -->',
      '',
      '<!-- releasekit-selection-end -->',
    ].join('\n');
    await mockForge({ standingPR: openStandingPR(99), pullRequests: { 99: { body: priorBody, labels: [] } } });

    await runStandingPRUpdate({ projectDir: '/test', verbose: false, quiet: false, json: false });

    const writeCall = vi.mocked(runVersionStep).mock.calls[1]?.[0] as { exclude?: string[] };
    expect(writeCall.exclude).toEqual([]);
  });

  it('should bypass the initial skip-pattern guard on a pull_request label event (#336)', async () => {
    // A label event checks out the standing PR's `chore: release preparation` commit (matches the
    // skip pattern) — the first guard would noop. A label-triggered run must proceed. The post-reset
    // HEAD is a normal commit, so the post-reset guard (not bypassed for label runs) passes.
    // HEAD is the release-prep commit until the branch is reset to origin/main, after which it's a
    // normal commit. Keying on the reset (not call count) keeps this correct whether or not the
    // first guard runs its git-log call — the whole point is that the bypass skips that call.
    const { execSync } = await import('node:child_process');
    let resetDone = false;
    vi.mocked(execSync).mockImplementation((cmd: string) => {
      if (typeof cmd === 'string') {
        if (cmd.includes('reset --hard')) resetDone = true;
        if (cmd.includes('git log -1 --pretty=%s')) {
          return resetDone ? 'feat: something (#320)' : 'chore: release preparation';
        }
      }
      return 'abc123\n';
    });

    const { readFileSync } = await import('node:fs');
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify({ action: 'labeled' }));
    const prevName = process.env.GITHUB_EVENT_NAME;
    const prevPath = process.env.GITHUB_EVENT_PATH;
    process.env.GITHUB_EVENT_NAME = 'pull_request';
    process.env.GITHUB_EVENT_PATH = '/event.json';

    try {
      const { runVersionStep, runNotesStep } = await import('../../src/steps.js');
      const versionOutput = createMockVersionOutput([{ packageName: '@scope/core', newVersion: '1.2.3' }]);
      vi.mocked(runVersionStep)
        .mockResolvedValueOnce(versionOutput as unknown as Awaited<ReturnType<typeof runVersionStep>>)
        .mockResolvedValueOnce(versionOutput as unknown as Awaited<ReturnType<typeof runVersionStep>>);
      vi.mocked(runNotesStep).mockResolvedValue({ packageNotes: {}, releaseNotes: {}, files: [] });

      await mockForge({ standingPR: openStandingPR(99) });

      const result = await runStandingPRUpdate({ projectDir: '/test', verbose: false, quiet: false, json: false });

      // Did NOT noop on the first guard — the label-triggered run proceeded to update the PR.
      expect(result.action).not.toBe('noop');
    } finally {
      if (prevName === undefined) delete process.env.GITHUB_EVENT_NAME;
      else process.env.GITHUB_EVENT_NAME = prevName;
      if (prevPath === undefined) delete process.env.GITHUB_EVENT_PATH;
      else process.env.GITHUB_EVENT_PATH = prevPath;
    }
  });

  it('should return noop when no releasable changes found and no existing PR', async () => {
    const { runVersionStep } = await import('../../src/steps.js');
    vi.mocked(runVersionStep).mockResolvedValue(
      createMockVersionOutput([]) as unknown as Awaited<ReturnType<typeof runVersionStep>>,
    );

    await mockForge({ standingPR: null });

    const result = await runStandingPRUpdate({
      projectDir: '/test',
      verbose: false,
      quiet: false,
      json: false,
    });

    expect(result.action).toBe('noop');
  });

  it('should close existing PR when no releasable changes', async () => {
    const { runVersionStep } = await import('../../src/steps.js');
    vi.mocked(runVersionStep).mockResolvedValue(
      createMockVersionOutput([]) as unknown as Awaited<ReturnType<typeof runVersionStep>>,
    );

    const forge = await mockForge({ standingPR: openStandingPR(10) });

    const result = await runStandingPRUpdate({
      projectDir: '/test',
      verbose: false,
      quiet: false,
      json: false,
    });

    expect(result.action).toBe('closed');
    expect(result.prNumber).toBe(10);
    expect(forge.updatedPullRequests).toContainEqual(
      expect.objectContaining({ prNumber: 10, changes: expect.objectContaining({ state: 'closed' }) }),
    );
  });

  it('should close (not render ****) when the write step recomputes to an empty release set (#396)', async () => {
    // Reconcile-race: the dry run sees updates (guard passes), but a release landing on base mid-run
    // makes the write step recompute to 0 publishable updates. The second guard must close the PR
    // instead of rendering a degenerate `****` body.
    const { runVersionStep, runNotesStep } = await import('../../src/steps.js');
    const withUpdates = createMockVersionOutput([{ packageName: '@scope/core', newVersion: '1.2.3' }]);
    const empty = createMockVersionOutput([]);
    vi.mocked(runVersionStep)
      .mockResolvedValueOnce(withUpdates as unknown as Awaited<ReturnType<typeof runVersionStep>>) // dry run
      .mockResolvedValueOnce(empty as unknown as Awaited<ReturnType<typeof runVersionStep>>); // write step
    vi.mocked(runNotesStep).mockResolvedValue({ packageNotes: {}, releaseNotes: {}, files: [] });

    const forge = await mockForge({ standingPR: openStandingPR(42) });

    const result = await runStandingPRUpdate({
      projectDir: '/test',
      verbose: false,
      quiet: false,
      json: false,
      reconcile: true,
    });

    expect(result.action).toBe('closed');
    expect(forge.updatedPullRequests).toContainEqual(
      expect.objectContaining({ prNumber: 42, changes: expect.objectContaining({ state: 'closed' }) }),
    );
    // The empty body must never be rendered onto the PR.
    expect(forge.updatedPullRequests.some((u) => u.changes.body !== undefined)).toBe(false);
  });

  it('should create a new PR when no existing standing PR', async () => {
    const { runVersionStep, runNotesStep } = await import('../../src/steps.js');
    const versionOutput = createMockVersionOutput([{ packageName: '@scope/core', newVersion: '1.2.3' }]);
    vi.mocked(runVersionStep)
      .mockResolvedValueOnce(versionOutput as unknown as Awaited<ReturnType<typeof runVersionStep>>)
      .mockResolvedValueOnce(versionOutput as unknown as Awaited<ReturnType<typeof runVersionStep>>);
    vi.mocked(runNotesStep).mockResolvedValue({ packageNotes: {}, releaseNotes: {}, files: [] });

    const forge = await mockForge({ standingPR: null });

    const result = await runStandingPRUpdate({
      projectDir: '/test',
      verbose: false,
      quiet: false,
      json: false,
    });

    expect(result.action).toBe('created');
    expect(result.prNumber).toBe(42);
    expect(forge.createdPullRequests).toHaveLength(1);
  });

  it('should default the PR title to the release tag in sync mode', async () => {
    const { loadConfig } = await import('@releasekit/config');
    const configWithoutTitle = {
      ...defaultConfig,
      ci: { ...defaultConfig.ci, standingPr: { ...defaultConfig.ci.standingPr, title: undefined } },
    };
    vi.mocked(loadConfig).mockReturnValue(configWithoutTitle as unknown as ReturnType<typeof loadConfig>);

    const { runVersionStep, runNotesStep } = await import('../../src/steps.js');
    const versionOutput = {
      ...createMockVersionOutput([]),
      strategy: 'sync',
      updates: [
        { packageName: 'my-monorepo', newVersion: '1.2.3', filePath: 'package.json', isRoot: true },
        { packageName: '@scope/core', newVersion: '1.2.3', filePath: 'packages/core/package.json' },
      ],
      tags: ['v1.2.3'],
    };
    vi.mocked(runVersionStep)
      .mockResolvedValueOnce(versionOutput as unknown as Awaited<ReturnType<typeof runVersionStep>>)
      .mockResolvedValueOnce(versionOutput as unknown as Awaited<ReturnType<typeof runVersionStep>>);
    vi.mocked(runNotesStep).mockResolvedValue({ packageNotes: {}, releaseNotes: {}, files: [] });

    const forge = await mockForge({ standingPR: null });

    await runStandingPRUpdate({ projectDir: '/test', verbose: false, quiet: false, json: false });

    expect(forge.createdPullRequests[0]).toEqual(expect.objectContaining({ title: 'chore: release v1.2.3' }));
  });

  it('should exclude the root lockstep bump from ${count} and the PR body publish table', async () => {
    const { runVersionStep, runNotesStep } = await import('../../src/steps.js');
    const versionOutput = {
      ...createMockVersionOutput([]),
      strategy: 'sync',
      updates: [
        { packageName: 'my-monorepo', newVersion: '1.2.3', filePath: 'package.json', isRoot: true },
        { packageName: '@scope/core', newVersion: '1.2.3', filePath: 'packages/core/package.json' },
        { packageName: '@scope/utils', newVersion: '1.2.3', filePath: 'packages/utils/package.json' },
      ],
      tags: ['v1.2.3'],
    };
    vi.mocked(runVersionStep)
      .mockResolvedValueOnce(versionOutput as unknown as Awaited<ReturnType<typeof runVersionStep>>)
      .mockResolvedValueOnce(versionOutput as unknown as Awaited<ReturnType<typeof runVersionStep>>);
    vi.mocked(runNotesStep).mockResolvedValue({ packageNotes: {}, releaseNotes: {}, files: [] });

    const forge = await mockForge({ standingPR: null });

    await runStandingPRUpdate({ projectDir: '/test', verbose: false, quiet: false, json: false });

    // Configured title template counts publishable packages only (root excluded)
    expect(forge.createdPullRequests[0]).toEqual(expect.objectContaining({ title: 'chore: release 2 package(s)' }));

    // Sync body leads with the version and lists bare package names, root excluded
    const body = forge.createdPullRequests[0]?.body;
    expect(body).toContain('Merging this PR will publish **v1.2.3**:');
    expect(body).toContain('- `@scope/core`');
    expect(body).toContain('- `@scope/utils`');
    expect(body).not.toContain('my-monorepo');
  });

  it('should include a ### Changelog section in the PR body with changelog entries', async () => {
    const { runVersionStep, runNotesStep } = await import('../../src/steps.js');
    const versionOutput = {
      ...createMockVersionOutput([{ packageName: '@scope/core', newVersion: '1.2.3' }]),
      changelogs: [
        {
          packageName: '@scope/core',
          version: '1.2.3',
          previousVersion: '1.2.2',
          revisionRange: 'v1.2.2..HEAD',
          repoUrl: null,
          entries: [
            { type: 'feat', description: 'Add new widget' },
            { type: 'fix', description: 'Fix broken export' },
          ],
        },
      ],
    };
    vi.mocked(runVersionStep)
      .mockResolvedValueOnce(versionOutput as unknown as Awaited<ReturnType<typeof runVersionStep>>)
      .mockResolvedValueOnce(versionOutput as unknown as Awaited<ReturnType<typeof runVersionStep>>);
    vi.mocked(runNotesStep).mockResolvedValue({ packageNotes: {}, releaseNotes: {}, files: [] });

    const forge = await mockForge({ standingPR: null });

    await runStandingPRUpdate({ projectDir: '/test', verbose: false, quiet: false, json: false });

    const body = forge.createdPullRequests[0]?.body;
    expect(body).toContain('### Changelog');
    expect(body).toContain('**Added**');
    expect(body).toContain('Add new widget');
    expect(body).toContain('**Fixed**');
    expect(body).toContain('Fix broken export');
    expect(body).toContain('@scope/core — 1.2.2 → 1.2.3');
  });

  it("should truncate the PR body when the changelog would exceed GitHub's limit (#333)", async () => {
    const { runVersionStep, runNotesStep } = await import('../../src/steps.js');
    // A no-baseline-tag package's full-history changelog: thousands of entries blow past 65,536 chars.
    const hugeEntries = Array.from({ length: 4000 }, (_, i) => ({
      type: 'added',
      description: `feature number ${i} with some descriptive text to pad the changelog body length`,
    }));
    const versionOutput = {
      ...createMockVersionOutput([{ packageName: '@scope/core', newVersion: '1.0.0' }]),
      changelogs: [
        {
          packageName: '@scope/core',
          version: '1.0.0',
          previousVersion: null,
          revisionRange: 'HEAD',
          entries: hugeEntries,
        },
      ],
    };
    vi.mocked(runVersionStep)
      .mockResolvedValueOnce(versionOutput as unknown as Awaited<ReturnType<typeof runVersionStep>>)
      .mockResolvedValueOnce(versionOutput as unknown as Awaited<ReturnType<typeof runVersionStep>>);
    vi.mocked(runNotesStep).mockResolvedValue({ packageNotes: {}, releaseNotes: {}, files: [] });

    const forge = await mockForge({ standingPR: null });

    await runStandingPRUpdate({ projectDir: '/test', verbose: false, quiet: false, json: false });

    const body = forge.createdPullRequests[0]?.body as string;
    // Assert against the module's cap (well under GitHub's 65,536), so a truncation that leaks into
    // the 64,001–65,535 safety margin still fails the test.
    expect(body.length).toBeLessThanOrEqual(STANDING_PR_BODY_CAP);
    expect(body).toContain('Changelog truncated');
    // The selection region above the changelog is preserved so the PR is still usable.
    expect(body).toContain('- [x] `@scope/core` → 1.0.0');
  });

  it('should omit the ### Changelog section when all updates are sync-bumped (no entries)', async () => {
    const { runVersionStep, runNotesStep } = await import('../../src/steps.js');
    // sync-bumped: updates present but changelogs array is empty
    const versionOutput = createMockVersionOutput([{ packageName: '@scope/core', newVersion: '1.2.3' }]);
    vi.mocked(runVersionStep)
      .mockResolvedValueOnce(versionOutput as unknown as Awaited<ReturnType<typeof runVersionStep>>)
      .mockResolvedValueOnce(versionOutput as unknown as Awaited<ReturnType<typeof runVersionStep>>);
    vi.mocked(runNotesStep).mockResolvedValue({ packageNotes: {}, releaseNotes: {}, files: [] });

    const forge = await mockForge({ standingPR: null });

    await runStandingPRUpdate({ projectDir: '/test', verbose: false, quiet: false, json: false });

    const body = forge.createdPullRequests[0]?.body;
    expect(body).not.toContain('### Changelog');
    expect(body).toContain('@scope/core');
    expect(body).toContain('1.2.3');
  });

  describe('partial-publish supersede warning on the next standing PR', () => {
    function failureReportBody() {
      const versionOutput = {
        ...createMockVersionOutput([
          { packageName: '@scope/core', newVersion: '0.24.0' },
          { packageName: '@scope/utils', newVersion: '0.24.0' },
        ]),
      } as unknown as Parameters<typeof renderFailureReport>[0]['versionOutput'];
      return renderFailureReport({
        versionOutput,
        publishOutput: {
          dryRun: false,
          git: { committed: true, tags: [], pushed: false },
          npm: [
            { packageName: '@scope/core', version: '0.24.0', registry: 'npm', success: true, skipped: false },
            {
              packageName: '@scope/utils',
              version: '0.24.0',
              registry: 'npm',
              success: false,
              skipped: false,
              reason: 'npm 403',
            },
          ],
          cargo: [],
          verification: [],
          githubReleases: [],
          publishSucceeded: false,
        },
        failedStage: 'npm-publish',
        errorMessage: 'npm 403',
        recovery: { mode: 'standing-pr', standingPrNumber: 7 },
      });
    }

    it('should include the warning when the latest merged standing PR has an unresolved failure', async () => {
      const { runVersionStep, runNotesStep } = await import('../../src/steps.js');
      const versionOutput = createMockVersionOutput([{ packageName: '@scope/core', newVersion: '0.25.0' }]);
      vi.mocked(runVersionStep)
        .mockResolvedValueOnce(versionOutput as unknown as Awaited<ReturnType<typeof runVersionStep>>)
        .mockResolvedValueOnce(versionOutput as unknown as Awaited<ReturnType<typeof runVersionStep>>);
      vi.mocked(runNotesStep).mockResolvedValue({ packageNotes: {}, releaseNotes: {}, files: [] });

      // No open standing PR (creates a new one); the most-recently-merged standing PR (#7) carries an
      // unresolved failure-report comment.
      const forge = await mockForge({
        standingPR: null,
        recentlyClosedPRs: [{ number: 7, mergedAt: '2026-01-01T00:00:00Z' }],
        comments: [{ id: 1, body: failureReportBody() }],
      });

      await runStandingPRUpdate({ projectDir: '/test', verbose: false, quiet: false, json: false });

      const body = forge.createdPullRequests[0]?.body;
      expect(body).toContain('partially published');
      expect(body).toContain('1/2 packages');
      expect(body).toContain('#7');
    });

    it('should omit the warning when the latest merged standing PR failure is resolved', async () => {
      const { runVersionStep, runNotesStep } = await import('../../src/steps.js');
      const versionOutput = createMockVersionOutput([{ packageName: '@scope/core', newVersion: '0.25.0' }]);
      vi.mocked(runVersionStep)
        .mockResolvedValueOnce(versionOutput as unknown as Awaited<ReturnType<typeof runVersionStep>>)
        .mockResolvedValueOnce(versionOutput as unknown as Awaited<ReturnType<typeof runVersionStep>>);
      vi.mocked(runNotesStep).mockResolvedValue({ packageNotes: {}, releaseNotes: {}, files: [] });

      const resolved = renderResolvedReport(
        createMockVersionOutput([{ packageName: '@scope/core', newVersion: '0.24.0' }]) as unknown as Parameters<
          typeof renderResolvedReport
        >[0],
      );
      const forge = await mockForge({
        standingPR: null,
        recentlyClosedPRs: [{ number: 7, mergedAt: '2026-01-01T00:00:00Z' }],
        comments: [{ id: 1, body: resolved }],
      });

      await runStandingPRUpdate({ projectDir: '/test', verbose: false, quiet: false, json: false });

      const body = forge.createdPullRequests[0]?.body;
      expect(body).not.toContain('partially published');
    });

    it('should omit the warning when there is no merged standing PR', async () => {
      const { runVersionStep, runNotesStep } = await import('../../src/steps.js');
      const versionOutput = createMockVersionOutput([{ packageName: '@scope/core', newVersion: '0.25.0' }]);
      vi.mocked(runVersionStep)
        .mockResolvedValueOnce(versionOutput as unknown as Awaited<ReturnType<typeof runVersionStep>>)
        .mockResolvedValueOnce(versionOutput as unknown as Awaited<ReturnType<typeof runVersionStep>>);
      vi.mocked(runNotesStep).mockResolvedValue({ packageNotes: {}, releaseNotes: {}, files: [] });

      const forge = await mockForge({ standingPR: null, recentlyClosedPRs: [] });

      await runStandingPRUpdate({ projectDir: '/test', verbose: false, quiet: false, json: false });

      const body = forge.createdPullRequests[0]?.body;
      expect(body).not.toContain('partially published');
    });
  });

  it('should update existing PR when standing PR already exists', async () => {
    const { runVersionStep, runNotesStep } = await import('../../src/steps.js');
    const versionOutput = createMockVersionOutput([{ packageName: '@scope/core', newVersion: '1.2.3' }]);
    vi.mocked(runVersionStep)
      .mockResolvedValueOnce(versionOutput as unknown as Awaited<ReturnType<typeof runVersionStep>>)
      .mockResolvedValueOnce(versionOutput as unknown as Awaited<ReturnType<typeof runVersionStep>>);
    vi.mocked(runNotesStep).mockResolvedValue({ packageNotes: {}, releaseNotes: {}, files: [] });

    const forge = await mockForge({ standingPR: openStandingPR(99) });

    const result = await runStandingPRUpdate({
      projectDir: '/test',
      verbose: false,
      quiet: false,
      json: false,
    });

    expect(result.action).toBe('updated');
    expect(result.prNumber).toBe(99);
    expect(forge.updatedPullRequests).toContainEqual(expect.objectContaining({ prNumber: 99 }));
    expect(forge.createdPullRequests).toHaveLength(0);
  });

  it('should update manifest comment when existing manifest comment found on PR', async () => {
    const { runVersionStep, runNotesStep } = await import('../../src/steps.js');
    const versionOutput = createMockVersionOutput([{ packageName: '@scope/core', newVersion: '1.2.3' }]);
    vi.mocked(runVersionStep)
      .mockResolvedValueOnce(versionOutput as unknown as Awaited<ReturnType<typeof runVersionStep>>)
      .mockResolvedValueOnce(versionOutput as unknown as Awaited<ReturnType<typeof runVersionStep>>);
    vi.mocked(runNotesStep).mockResolvedValue({ packageNotes: {}, releaseNotes: {}, files: [] });

    // An existing manifest comment so the update path is taken.
    const forge = await mockForge({
      standingPR: openStandingPR(99),
      comments: [{ id: 77, body: serializeManifest(baseManifest) }],
    });

    await runStandingPRUpdate({ projectDir: '/test', verbose: false, quiet: false, json: false });

    expect(forge.updatedComments).toContainEqual(expect.objectContaining({ commentId: 77 }));
    expect(forge.createdComments.some((c) => c.body.includes(MANIFEST_MARKER))).toBe(false);
  });

  it('should return noop with versionOutput when no GitHub context is available but changes exist', async () => {
    delete process.env.GITHUB_REPOSITORY;
    delete process.env.GITHUB_TOKEN;

    const { runVersionStep, runNotesStep } = await import('../../src/steps.js');
    const versionOutput = createMockVersionOutput([{ packageName: '@scope/core', newVersion: '1.2.3' }]);
    vi.mocked(runVersionStep)
      .mockResolvedValueOnce(versionOutput as unknown as Awaited<ReturnType<typeof runVersionStep>>)
      .mockResolvedValueOnce(versionOutput as unknown as Awaited<ReturnType<typeof runVersionStep>>);
    vi.mocked(runNotesStep).mockResolvedValue({ packageNotes: {}, releaseNotes: {}, files: [] });

    const result = await runStandingPRUpdate({ projectDir: '/test', verbose: false, quiet: false, json: false });

    expect(result.action).toBe('noop');
    expect(result.versionOutput).toBeDefined();
    expect(result.versionOutput?.updates).toHaveLength(1);
  });

  it('should return noop when package count is below minPackages threshold', async () => {
    const { loadConfig } = await import('@releasekit/config');
    vi.mocked(loadConfig).mockReturnValue({
      ...defaultConfig,
      ci: { ...defaultConfig.ci, standingPr: { ...defaultConfig.ci.standingPr, minPackages: 3 } },
    } as ReturnType<typeof loadConfig>);

    const { runVersionStep } = await import('../../src/steps.js');
    // Only 1 package changed — below threshold of 3
    const versionOutput = createMockVersionOutput([{ packageName: '@scope/core', newVersion: '1.2.3' }]);
    vi.mocked(runVersionStep).mockResolvedValue(versionOutput as unknown as Awaited<ReturnType<typeof runVersionStep>>);

    const forge = await mockForge({ standingPR: null });

    const result = await runStandingPRUpdate({ projectDir: '/test', verbose: false, quiet: false, json: false });

    expect(result.action).toBe('noop');
    expect(forge.createdPullRequests).toHaveLength(0);
  });

  it('should close existing PR when package count is below minPackages threshold', async () => {
    const { loadConfig } = await import('@releasekit/config');
    vi.mocked(loadConfig).mockReturnValue({
      ...defaultConfig,
      ci: { ...defaultConfig.ci, standingPr: { ...defaultConfig.ci.standingPr, minPackages: 3 } },
    } as ReturnType<typeof loadConfig>);

    const { runVersionStep } = await import('../../src/steps.js');
    const versionOutput = createMockVersionOutput([{ packageName: '@scope/core', newVersion: '1.2.3' }]);
    vi.mocked(runVersionStep).mockResolvedValue(versionOutput as unknown as Awaited<ReturnType<typeof runVersionStep>>);

    const forge = await mockForge({ standingPR: openStandingPR(55) });

    const result = await runStandingPRUpdate({ projectDir: '/test', verbose: false, quiet: false, json: false });

    expect(result.action).toBe('closed');
    expect(result.prNumber).toBe(55);
    expect(forge.updatedPullRequests).toContainEqual(
      expect.objectContaining({ prNumber: 55, changes: expect.objectContaining({ state: 'closed' }) }),
    );
    expect(forge.createdComments).toContainEqual(
      expect.objectContaining({ body: expect.stringContaining('1 of 3 required') }),
    );
  });

  it('should post success status check when all gates are satisfied', async () => {
    const { runVersionStep, runNotesStep } = await import('../../src/steps.js');
    const versionOutput = createMockVersionOutput([{ packageName: '@scope/core', newVersion: '1.2.3' }]);
    vi.mocked(runVersionStep)
      .mockResolvedValueOnce(versionOutput as unknown as Awaited<ReturnType<typeof runVersionStep>>)
      .mockResolvedValueOnce(versionOutput as unknown as Awaited<ReturnType<typeof runVersionStep>>);
    vi.mocked(runNotesStep).mockResolvedValue({ packageNotes: {}, releaseNotes: {}, files: [] });

    const forge = await mockForge({ standingPR: null });

    await runStandingPRUpdate({ projectDir: '/test', verbose: false, quiet: false, json: false });

    expect(forge.commitStatuses).toContainEqual(
      expect.objectContaining({
        sha: 'abc123',
        state: 'success',
        description: 'Ready to merge',
        context: 'releasekit/standing-pr',
      }),
    );
  });

  it('should post pending status check when minAge has not elapsed', async () => {
    const { loadConfig } = await import('@releasekit/config');
    vi.mocked(loadConfig).mockReturnValue({
      ...defaultConfig,
      ci: { ...defaultConfig.ci, standingPr: { ...defaultConfig.ci.standingPr, minAge: '6h' } },
    } as ReturnType<typeof loadConfig>);

    const { runVersionStep, runNotesStep } = await import('../../src/steps.js');
    const versionOutput = createMockVersionOutput([{ packageName: '@scope/core', newVersion: '1.2.3' }]);
    vi.mocked(runVersionStep)
      .mockResolvedValueOnce(versionOutput as unknown as Awaited<ReturnType<typeof runVersionStep>>)
      .mockResolvedValueOnce(versionOutput as unknown as Awaited<ReturnType<typeof runVersionStep>>);
    vi.mocked(runNotesStep).mockResolvedValue({ packageNotes: {}, releaseNotes: {}, files: [] });

    // Existing PR with a manifest that has a recent firstUpdatedAt (5 minutes ago)
    const recentTimestamp = new Date(Date.now() - 5 * 60_000).toISOString();
    const existingManifest = serializeManifest({ ...baseManifest, schemaVersion: 2, firstUpdatedAt: recentTimestamp });
    const forge = await mockForge({
      standingPR: openStandingPR(99),
      comments: [{ id: 77, body: existingManifest }],
    });

    await runStandingPRUpdate({ projectDir: '/test', verbose: false, quiet: false, json: false });

    expect(forge.commitStatuses).toContainEqual(
      expect.objectContaining({
        state: 'pending',
        context: 'releasekit/standing-pr',
        description: expect.stringMatching(/Waiting .+ for minAge/),
      }),
    );
  });

  it('should post success status check when minAge has elapsed', async () => {
    const { loadConfig } = await import('@releasekit/config');
    vi.mocked(loadConfig).mockReturnValue({
      ...defaultConfig,
      ci: { ...defaultConfig.ci, standingPr: { ...defaultConfig.ci.standingPr, minAge: '1h' } },
    } as ReturnType<typeof loadConfig>);

    const { runVersionStep, runNotesStep } = await import('../../src/steps.js');
    const versionOutput = createMockVersionOutput([{ packageName: '@scope/core', newVersion: '1.2.3' }]);
    vi.mocked(runVersionStep)
      .mockResolvedValueOnce(versionOutput as unknown as Awaited<ReturnType<typeof runVersionStep>>)
      .mockResolvedValueOnce(versionOutput as unknown as Awaited<ReturnType<typeof runVersionStep>>);
    vi.mocked(runNotesStep).mockResolvedValue({ packageNotes: {}, releaseNotes: {}, files: [] });

    // firstUpdatedAt is 2 hours ago — minAge of 1h is satisfied
    const oldTimestamp = new Date(Date.now() - 2 * 3_600_000).toISOString();
    const existingManifest = serializeManifest({ ...baseManifest, schemaVersion: 2, firstUpdatedAt: oldTimestamp });
    const forge = await mockForge({
      standingPR: openStandingPR(99),
      comments: [{ id: 77, body: existingManifest }],
    });

    await runStandingPRUpdate({ projectDir: '/test', verbose: false, quiet: false, json: false });

    expect(forge.commitStatuses).toContainEqual(
      expect.objectContaining({ state: 'success', description: 'Ready to merge' }),
    );
  });

  it('should preserve firstUpdatedAt from existing manifest across updates', async () => {
    const { runVersionStep, runNotesStep } = await import('../../src/steps.js');
    const versionOutput = createMockVersionOutput([{ packageName: '@scope/core', newVersion: '1.2.3' }]);
    vi.mocked(runVersionStep)
      .mockResolvedValueOnce(versionOutput as unknown as Awaited<ReturnType<typeof runVersionStep>>)
      .mockResolvedValueOnce(versionOutput as unknown as Awaited<ReturnType<typeof runVersionStep>>);
    vi.mocked(runNotesStep).mockResolvedValue({ packageNotes: {}, releaseNotes: {}, files: [] });

    const originalTimestamp = '2024-01-15T08:00:00.000Z';
    const existingManifest = serializeManifest({
      ...baseManifest,
      schemaVersion: 2,
      firstUpdatedAt: originalTimestamp,
    });
    const forge = await mockForge({
      standingPR: openStandingPR(99),
      comments: [{ id: 77, body: existingManifest }],
    });

    await runStandingPRUpdate({ projectDir: '/test', verbose: false, quiet: false, json: false });

    // The manifest comment update should contain the original firstUpdatedAt
    const updateCall = forge.updatedComments.find((c) => c.body.includes(MANIFEST_MARKER));
    expect(updateCall).toBeDefined();
    const writtenManifest = parseManifest(updateCall?.body as string);
    expect(writtenManifest.firstUpdatedAt).toBe(originalTimestamp);
  });

  it('should use createdAt as firstUpdatedAt fallback when migrating from v1 manifest', async () => {
    const { runVersionStep, runNotesStep } = await import('../../src/steps.js');
    const versionOutput = createMockVersionOutput([{ packageName: '@scope/core', newVersion: '1.2.3' }]);
    vi.mocked(runVersionStep)
      .mockResolvedValueOnce(versionOutput as unknown as Awaited<ReturnType<typeof runVersionStep>>)
      .mockResolvedValueOnce(versionOutput as unknown as Awaited<ReturnType<typeof runVersionStep>>);
    vi.mocked(runNotesStep).mockResolvedValue({ packageNotes: {}, releaseNotes: {}, files: [] });

    // v1 manifest has no firstUpdatedAt — should fall back to createdAt
    const v1Manifest = serializeManifest({ ...baseManifest, schemaVersion: 1 });
    const forge = await mockForge({
      standingPR: openStandingPR(99),
      comments: [{ id: 77, body: v1Manifest }],
    });

    await runStandingPRUpdate({ projectDir: '/test', verbose: false, quiet: false, json: false });

    const updateCall = forge.updatedComments.find((c) => c.body.includes(MANIFEST_MARKER));
    expect(updateCall).toBeDefined();
    const writtenManifest = parseManifest(updateCall?.body as string);
    expect(writtenManifest.firstUpdatedAt).toBe(baseManifest.createdAt);
  });

  it('should not fail update when status check post throws', async () => {
    const { runVersionStep, runNotesStep } = await import('../../src/steps.js');
    const versionOutput = createMockVersionOutput([{ packageName: '@scope/core', newVersion: '1.2.3' }]);
    vi.mocked(runVersionStep)
      .mockResolvedValueOnce(versionOutput as unknown as Awaited<ReturnType<typeof runVersionStep>>)
      .mockResolvedValueOnce(versionOutput as unknown as Awaited<ReturnType<typeof runVersionStep>>);
    vi.mocked(runNotesStep).mockResolvedValue({ packageNotes: {}, releaseNotes: {}, files: [] });

    const forge = await mockForge({ standingPR: null });
    vi.spyOn(forge, 'setCommitStatus').mockRejectedValue(new Error('API rate limit exceeded'));

    // Should resolve (not throw) even when status check post fails
    const result = await runStandingPRUpdate({ projectDir: '/test', verbose: false, quiet: false, json: false });

    expect(result.action).toBe('created');
    expect(result.prNumber).toBe(42);
  });

  describe('standing-PR labels as overrides', () => {
    async function setupWithStandingPRLabels(labelNames: string[]) {
      const { runVersionStep, runNotesStep } = await import('../../src/steps.js');
      const versionOutput = createMockVersionOutput([{ packageName: '@scope/core', newVersion: '1.2.3' }]);
      vi.mocked(runVersionStep)
        .mockResolvedValueOnce(versionOutput as unknown as Awaited<ReturnType<typeof runVersionStep>>)
        .mockResolvedValueOnce(versionOutput as unknown as Awaited<ReturnType<typeof runVersionStep>>);
      vi.mocked(runNotesStep).mockResolvedValue({ packageNotes: {}, releaseNotes: {}, files: [] });

      const forge = await mockForge({ standingPR: openStandingPR(99, labelNames) });

      return { forge, runVersionStepMock: vi.mocked(runVersionStep) };
    }

    it('should pass bump:major from standing PR labels into version step', async () => {
      const { runVersionStepMock } = await setupWithStandingPRLabels(['release', 'bump:major']);

      await runStandingPRUpdate({ projectDir: '/test', verbose: false, quiet: false, json: false });

      // First call (dry run) and second call (write) should both carry bump: 'major'
      expect(runVersionStepMock.mock.calls[0]?.[0]).toMatchObject({ bump: 'major' });
      expect(runVersionStepMock.mock.calls[1]?.[0]).toMatchObject({ bump: 'major' });
    });

    it('should pass channel:prerelease from standing PR labels as prerelease override', async () => {
      const { runVersionStepMock } = await setupWithStandingPRLabels(['release', 'channel:prerelease']);

      await runStandingPRUpdate({ projectDir: '/test', verbose: false, quiet: false, json: false });

      expect(runVersionStepMock.mock.calls[0]?.[0]).toMatchObject({ prerelease: true });
    });

    it('should compose bump:major + channel:prerelease into a premajor bump', async () => {
      const { runVersionStepMock } = await setupWithStandingPRLabels(['release', 'bump:major', 'channel:prerelease']);

      await runStandingPRUpdate({ projectDir: '/test', verbose: false, quiet: false, json: false });

      // Composed so an already-prerelease package escalates a fresh line (premajor → 2.0.0-next.0)
      // rather than degrading to a prerelease increment (#335). Both dry-run and write calls agree.
      expect(runVersionStepMock.mock.calls[0]?.[0]).toMatchObject({ bump: 'premajor', prerelease: true });
      expect(runVersionStepMock.mock.calls[1]?.[0]).toMatchObject({ bump: 'premajor', prerelease: true });
    });

    it('should record the override labels in the manifest, excluding the marker label (#337)', async () => {
      const { forge } = await setupWithStandingPRLabels(['release', 'bump:major', 'channel:prerelease']);

      await runStandingPRUpdate({ projectDir: '/test', verbose: false, quiet: false, json: false });

      const writes = [...forge.createdComments.map((c) => c.body), ...forge.updatedComments.map((c) => c.body)];
      const manifestWrite = writes.find((b) => b.includes(MANIFEST_MARKER));
      expect(manifestWrite).toBeDefined();
      const manifest = parseManifest(manifestWrite as string);
      // Sorted, marker 'release' label excluded.
      expect(manifest.overrideLabels).toEqual(['bump:major', 'channel:prerelease']);
    });

    it('should drop the bump under channel:stable (graduation is bump-less, matching the SSOT)', async () => {
      const { runVersionStepMock } = await setupWithStandingPRLabels(['release', 'bump:major', 'channel:stable']);

      await runStandingPRUpdate({ projectDir: '/test', verbose: false, quiet: false, json: false });

      // channel:stable wins — bump is dropped (not leaked as 'major'), consistent with
      // composeBumpFromLabels returning undefined for stable.
      expect(runVersionStepMock.mock.calls[0]?.[0]).toMatchObject({ stable: true });
      expect(runVersionStepMock.mock.calls[0]?.[0]?.bump).toBeUndefined();
    });

    it('should drop conflicting bump labels and posts pending status check', async () => {
      const { forge, runVersionStepMock } = await setupWithStandingPRLabels(['release', 'bump:patch', 'bump:major']);

      await runStandingPRUpdate({ projectDir: '/test', verbose: false, quiet: false, json: false });

      // Conflict → bump override dropped, version analysis runs commit-driven
      expect(runVersionStepMock.mock.calls[0]?.[0]).not.toHaveProperty('bump', 'major');
      expect(runVersionStepMock.mock.calls[0]?.[0]?.bump).toBeUndefined();
      // Final status check is pending with conflict description
      const lastStatus = forge.commitStatuses.at(-1);
      expect(lastStatus?.state).toBe('pending');
      expect(lastStatus?.description).toMatch(/Conflicting bump labels/);
    });

    it('should show conflict description when both a label conflict and a pending minAge exist', async () => {
      const { loadConfig } = await import('@releasekit/config');
      vi.mocked(loadConfig).mockReturnValue({
        ...defaultConfig,
        ci: { ...defaultConfig.ci, standingPr: { ...defaultConfig.ci.standingPr, minAge: '6h' } },
      } as ReturnType<typeof loadConfig>);

      const { forge } = await setupWithStandingPRLabels(['release', 'bump:patch', 'bump:major']);

      await runStandingPRUpdate({ projectDir: '/test', verbose: false, quiet: false, json: false });

      const lastStatus = forge.commitStatuses.at(-1);
      expect(lastStatus?.state).toBe('pending');
      expect(lastStatus?.description).toMatch(/Conflicting bump labels/);
      expect(lastStatus?.description).not.toMatch(/minAge/);
    });

    it('should preserve maintainer-added labels in setLabels (union with configured labels)', async () => {
      const { forge } = await setupWithStandingPRLabels(['release', 'bump:major']);

      await runStandingPRUpdate({ projectDir: '/test', verbose: false, quiet: false, json: false });

      const lastSetLabels = forge.setLabelsCalls.at(-1);
      // Should contain BOTH the configured 'release' and the maintainer-added 'bump:major'
      expect(lastSetLabels?.labels).toContain('release');
      expect(lastSetLabels?.labels).toContain('bump:major');
    });

    it('should default sync to false when not set in config (preserves per-package versioning)', async () => {
      const { runVersionStepMock } = await setupWithStandingPRLabels([]);

      await runStandingPRUpdate({ projectDir: '/test', verbose: false, quiet: false, json: false });

      expect(runVersionStepMock.mock.calls[0]?.[0]).toMatchObject({ sync: false });
    });

    it('should inherit sync: true from version config when explicitly set', async () => {
      const { loadConfig } = await import('@releasekit/config');
      vi.mocked(loadConfig).mockReturnValue({
        ...defaultConfig,
        version: { sync: true },
      } as ReturnType<typeof loadConfig>);
      const { runVersionStepMock } = await setupWithStandingPRLabels([]);

      await runStandingPRUpdate({ projectDir: '/test', verbose: false, quiet: false, json: false });

      expect(runVersionStepMock.mock.calls[0]?.[0]).toMatchObject({ sync: true });
    });
  });

  describe('preview-notes editable region (#200)', () => {
    async function setupPreviewPR(opts: { labels: string[]; liveBody?: string; freshNotes?: Record<string, string> }) {
      const { runVersionStep, runNotesStep } = await import('../../src/steps.js');
      const versionOutput = createMockVersionOutput([{ packageName: '@scope/core', newVersion: '1.2.3' }]);
      vi.mocked(runVersionStep)
        .mockResolvedValueOnce(versionOutput as unknown as Awaited<ReturnType<typeof runVersionStep>>)
        .mockResolvedValueOnce(versionOutput as unknown as Awaited<ReturnType<typeof runVersionStep>>);
      vi.mocked(runNotesStep).mockResolvedValue({
        packageNotes: {},
        releaseNotes: opts.freshNotes ?? {},
        files: [],
      });

      const forge = await mockForge({
        standingPR: openStandingPR(99, opts.labels),
        pullRequests: { 99: { body: opts.liveBody ?? '', labels: [] } },
      });

      return { forge, runNotesStepMock: vi.mocked(runNotesStep) };
    }

    it('should seed generated notes into the editable region when the preview label is present', async () => {
      const { forge, runNotesStepMock } = await setupPreviewPR({
        labels: ['release', 'release:preview-notes'],
        liveBody: '',
        freshNotes: { '@scope/core': 'Generated notes for core' },
      });

      await runStandingPRUpdate({ projectDir: '/test', verbose: false, quiet: false, json: false });

      // LLM release notes were requested (skipReleaseNotes false) on the seeding run.
      expect(runNotesStepMock.mock.calls.at(-1)?.[1]).toMatchObject({ skipReleaseNotes: false });
      const body = forge.updatedPullRequests.at(-1)?.changes.body as string;
      expect(body).toContain('## Release Notes');
      expect(body).toContain('<!-- releasekit-notes:@scope/core -->');
      expect(body).toContain('Generated notes for core');
    });

    it('should preserve a human-edited region across an update without regenerating', async () => {
      const editedBody = renderNotesRegion({ '@scope/core': 'HUMAN EDITED notes' });
      const { forge, runNotesStepMock } = await setupPreviewPR({
        labels: ['release', 'release:preview-notes'],
        liveBody: editedBody,
        // Even if the mock returned fresh notes, the edit must win — but generation should be skipped.
        freshNotes: { '@scope/core': 'REGENERATED notes' },
      });

      await runStandingPRUpdate({ projectDir: '/test', verbose: false, quiet: false, json: false });

      // Every releasing package already has a region → LLM generation is skipped.
      expect(runNotesStepMock.mock.calls.at(-1)?.[1]).toMatchObject({ skipReleaseNotes: true });
      const body = forge.updatedPullRequests.at(-1)?.changes.body as string;
      expect(body).toContain('HUMAN EDITED notes');
      expect(body).not.toContain('REGENERATED notes');
    });

    it('should not add a notes region when the preview label is absent', async () => {
      const { forge } = await setupPreviewPR({ labels: ['release'], freshNotes: {} });

      await runStandingPRUpdate({ projectDir: '/test', verbose: false, quiet: false, json: false });

      const body = forge.updatedPullRequests.at(-1)?.changes.body as string;
      expect(body).not.toContain('## Release Notes');
      expect(body).not.toContain('<!-- releasekit-notes');
    });
  });
});

describe('findLatestMergedStandingPR', () => {
  it('should pick the most recently merged PR even when an older merge was updated more recently', async () => {
    // List order is the API's 'updated' sort — late activity (a comment, a label) on the
    // older merged #42 floats it above the newer merge #77.
    const forge = createFakeForge({
      recentlyClosedPRs: [
        { number: 42, mergedAt: '2024-01-01T00:00:00Z' },
        { number: 80, mergedAt: null },
        { number: 77, mergedAt: '2024-01-02T00:00:00Z' },
      ],
    });

    const result = await findLatestMergedStandingPR(forge, 'release/next');

    expect(result).toBe(77);
  });

  it('should return null when no closed PR from the branch was merged', async () => {
    const forge = createFakeForge({ recentlyClosedPRs: [{ number: 80, mergedAt: null }] });

    const result = await findLatestMergedStandingPR(forge, 'release/next');

    expect(result).toBeNull();
  });
});

describe('runStandingPRPublish', () => {
  const originalEnv = { ...process.env };

  beforeEach(async () => {
    vi.resetAllMocks();
    process.env.GITHUB_REPOSITORY = 'owner/repo';
    process.env.GITHUB_TOKEN = 'test-token';
    process.env.GITHUB_EVENT_PATH = '/tmp/test-event.json';

    const { loadConfig } = await import('@releasekit/config');
    vi.mocked(loadConfig).mockReturnValue({
      ci: {
        standingPr: { branch: 'release/next', deleteBranchOnMerge: true },
      },
      git: { branch: 'main' },
    } as ReturnType<typeof loadConfig>);

    const { execSync } = await import('node:child_process');
    vi.mocked(execSync).mockReturnValue('abc123\n');
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('should infer the latest merged standing PR from the API when GITHUB_EVENT_PATH is not set', async () => {
    delete process.env.GITHUB_EVENT_PATH;

    // No manifest comment on the inferred PR — the publish attempt throwing proves the
    // inference resolved #77 and proceeded to publishFromManifest.
    const forge = await mockForge({
      recentlyClosedPRs: [
        { number: 80, mergedAt: null },
        { number: 77, mergedAt: '2024-01-02T00:00:00Z' },
      ],
    });
    const listClosed = vi.spyOn(forge, 'listRecentlyClosedPullRequests');

    await expect(
      runStandingPRPublish({ projectDir: '/test', verbose: false, quiet: false, json: false }),
    ).rejects.toThrow(/manifest not found/);

    expect(listClosed).toHaveBeenCalledWith('release/next', expect.any(Number));
  });

  it('should fall back to API inference when the event payload has no pull_request (workflow_dispatch)', async () => {
    const { readFileSync } = await import('node:fs');
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify({ inputs: {} }));

    await mockForge({ recentlyClosedPRs: [{ number: 42, mergedAt: '2024-01-02T00:00:00Z' }] });

    await expect(
      runStandingPRPublish({ projectDir: '/test', verbose: false, quiet: false, json: false }),
    ).rejects.toThrow(/manifest not found/);
  });

  it('should return null when API inference finds no merged standing PR', async () => {
    delete process.env.GITHUB_EVENT_PATH;

    await mockForge({ recentlyClosedPRs: [{ number: 80, mergedAt: null }] });

    const result = await runStandingPRPublish({
      projectDir: '/test',
      verbose: false,
      quiet: false,
      json: false,
    });

    expect(result).toBeNull();
  });

  it('should return null when inference is needed but no GitHub token is available', async () => {
    delete process.env.GITHUB_EVENT_PATH;
    delete process.env.GITHUB_TOKEN;

    const result = await runStandingPRPublish({
      projectDir: '/test',
      verbose: false,
      quiet: false,
      json: false,
    });

    expect(result).toBeNull();
  });

  it('should return null when merged PR head ref does not match release branch', async () => {
    const { readFileSync } = await import('node:fs');
    vi.mocked(readFileSync).mockReturnValue(
      JSON.stringify({
        pull_request: { head: { ref: 'feature/something-else' }, number: 42, merged: true },
      }),
    );

    const result = await runStandingPRPublish({
      projectDir: '/test',
      verbose: false,
      quiet: false,
      json: false,
    });

    expect(result).toBeNull();
  });

  it('should return null when PR was not merged', async () => {
    const { readFileSync } = await import('node:fs');
    vi.mocked(readFileSync).mockReturnValue(
      JSON.stringify({
        pull_request: { head: { ref: 'release/next' }, number: 5, merged: false },
      }),
    );

    const result = await runStandingPRPublish({
      projectDir: '/test',
      verbose: false,
      quiet: false,
      json: false,
    });

    expect(result).toBeNull();
  });

  it('should throw when manifest comment is missing from merged PR', async () => {
    const { readFileSync } = await import('node:fs');
    vi.mocked(readFileSync).mockReturnValue(
      JSON.stringify({
        pull_request: { head: { ref: 'release/next' }, number: 42, merged: true },
      }),
    );

    // No manifest comment
    await mockForge({});

    await expect(
      runStandingPRPublish({ projectDir: '/test', verbose: false, quiet: false, json: false }),
    ).rejects.toThrow(/manifest not found/);
  });

  it('should publish when valid manifest found on merged PR', async () => {
    const { readFileSync } = await import('node:fs');
    vi.mocked(readFileSync).mockReturnValue(
      JSON.stringify({
        pull_request: { head: { ref: 'release/next' }, number: 42, merged: true },
      }),
    );

    await mockForge({ comments: [{ id: 1, body: serializeManifest(baseManifest) }] });

    const { runNotesStep, runPublishStep } = await import('../../src/steps.js');
    // publishFromManifest regenerates LLM-enhanced notes against the merged commit set
    // — the publish step should receive these regenerated notes, not whatever (now empty)
    // releaseNotes lives on the manifest.
    vi.mocked(runNotesStep).mockResolvedValue({
      packageNotes: {},
      releaseNotes: { '@scope/core': '- regenerated at publish time' },
      files: ['RELEASE_NOTES.md'],
    });
    vi.mocked(runPublishStep).mockResolvedValue({ publishSucceeded: true } as unknown as Awaited<
      ReturnType<typeof runPublishStep>
    >);

    const result = await runStandingPRPublish({
      projectDir: '/test',
      verbose: false,
      quiet: false,
      json: false,
    });

    expect(result).not.toBeNull();
    // runNotesStep is called with skipChangelogs:true (LLM-only, against the already-merged
    // tree) before the publish step runs.
    expect(vi.mocked(runNotesStep)).toHaveBeenCalledWith(
      expect.objectContaining({ updates: baseManifest.versionOutput.updates }),
      expect.objectContaining({ skipChangelogs: true, skipReleaseNotes: false }),
    );
    expect(vi.mocked(runPublishStep)).toHaveBeenCalledWith(
      expect.objectContaining({ updates: baseManifest.versionOutput.updates }),
      expect.objectContaining({ skipGitCommit: true }),
      { '@scope/core': '- regenerated at publish time' },
      expect.arrayContaining(['RELEASE_NOTES.md', ...baseManifest.notesFiles]),
    );
  });

  it('should refuse to publish when override labels diverge from the manifest (#337)', async () => {
    const { readFileSync } = await import('node:fs');
    vi.mocked(readFileSync).mockReturnValue(
      JSON.stringify({ pull_request: { head: { ref: 'release/next' }, number: 42, merged: true } }),
    );

    const manifestBody = serializeManifest({ ...baseManifest, schemaVersion: 2, overrideLabels: ['bump:major'] });
    // The merged PR carries a different bump label than the manifest was computed for.
    await mockForge({
      comments: [{ id: 1, body: manifestBody }],
      pullRequests: { 42: { body: '', labels: ['bump:minor', 'release'] } },
    });

    await expect(
      runStandingPRPublish({ projectDir: '/test', verbose: false, quiet: false, json: false }),
    ).rejects.toThrow(/labels changed after the last update/);

    const { runPublishStep } = await import('../../src/steps.js');
    expect(vi.mocked(runPublishStep)).not.toHaveBeenCalled();
  });

  it('should publish when override labels match the manifest, ignoring non-override labels (#337)', async () => {
    const { readFileSync } = await import('node:fs');
    vi.mocked(readFileSync).mockReturnValue(
      JSON.stringify({ pull_request: { head: { ref: 'release/next' }, number: 42, merged: true } }),
    );

    const manifestBody = serializeManifest({ ...baseManifest, schemaVersion: 2, overrideLabels: ['bump:major'] });
    // Same override label; the unrelated 'release' / 'area:ci' labels must not count as a mismatch.
    await mockForge({
      comments: [{ id: 1, body: manifestBody }],
      pullRequests: { 42: { body: '', labels: ['release', 'bump:major', 'area:ci'] } },
    });

    const { runPublishStep } = await import('../../src/steps.js');
    vi.mocked(runPublishStep).mockResolvedValue({ publishSucceeded: true } as unknown as Awaited<
      ReturnType<typeof runPublishStep>
    >);

    const result = await runStandingPRPublish({ projectDir: '/test', verbose: false, quiet: false, json: false });
    expect(result).not.toBeNull();
    expect(vi.mocked(runPublishStep)).toHaveBeenCalled();
  });

  it('should skip the override-label check for manifests without overrideLabels (backward compat)', async () => {
    const { readFileSync } = await import('node:fs');
    vi.mocked(readFileSync).mockReturnValue(
      JSON.stringify({ pull_request: { head: { ref: 'release/next' }, number: 42, merged: true } }),
    );

    // baseManifest has no overrideLabels (pre-#337) — the check must be skipped even if labels differ.
    await mockForge({
      comments: [{ id: 1, body: serializeManifest(baseManifest) }],
      pullRequests: { 42: { body: '', labels: ['bump:major'] } },
    });

    const { runPublishStep } = await import('../../src/steps.js');
    vi.mocked(runPublishStep).mockResolvedValue({ publishSucceeded: true } as unknown as Awaited<
      ReturnType<typeof runPublishStep>
    >);

    const result = await runStandingPRPublish({ projectDir: '/test', verbose: false, quiet: false, json: false });
    expect(result).not.toBeNull();
    expect(vi.mocked(runPublishStep)).toHaveBeenCalled();
  });

  it('should refuse to publish when the PR is unreadable but the manifest carried override labels (#337)', async () => {
    const { readFileSync } = await import('node:fs');
    vi.mocked(readFileSync).mockReturnValue(
      JSON.stringify({ pull_request: { head: { ref: 'release/next' }, number: 42, merged: true } }),
    );

    const manifestBody = serializeManifest({ ...baseManifest, schemaVersion: 2, overrideLabels: ['bump:major'] });
    const forge = await mockForge({ comments: [{ id: 1, body: manifestBody }] });
    // The PR can't be read (transient API failure) — can't verify labels, so fail closed.
    vi.spyOn(forge, 'getPullRequest').mockRejectedValue(new Error('API unavailable'));

    await expect(
      runStandingPRPublish({ projectDir: '/test', verbose: false, quiet: false, json: false }),
    ).rejects.toThrow(/could not be read/);

    const { runPublishStep } = await import('../../src/steps.js');
    expect(vi.mocked(runPublishStep)).not.toHaveBeenCalled();
  });

  it('should fall back to empty release notes when LLM regeneration fails', async () => {
    const { readFileSync } = await import('node:fs');
    vi.mocked(readFileSync).mockReturnValue(
      JSON.stringify({
        pull_request: { head: { ref: 'release/next' }, number: 42, merged: true },
      }),
    );

    await mockForge({ comments: [{ id: 1, body: serializeManifest(baseManifest) }] });

    const { runNotesStep, runPublishStep } = await import('../../src/steps.js');
    vi.mocked(runNotesStep).mockRejectedValue(new Error('LLM provider unavailable'));
    vi.mocked(runPublishStep).mockResolvedValue({ publishSucceeded: true } as unknown as Awaited<
      ReturnType<typeof runPublishStep>
    >);

    const result = await runStandingPRPublish({
      projectDir: '/test',
      verbose: false,
      quiet: false,
      json: false,
    });

    expect(result).not.toBeNull();
    // Publish proceeds with empty releaseNotes — the publish stage falls back to
    // GitHub's --generate-notes for the release body.
    expect(vi.mocked(runPublishStep)).toHaveBeenCalledWith(
      expect.objectContaining({ updates: baseManifest.versionOutput.updates }),
      expect.objectContaining({ skipGitCommit: true }),
      {},
      expect.arrayContaining(baseManifest.notesFiles),
    );
  });

  it('should delete release branch after publish when deleteBranchOnMerge is true', async () => {
    const { readFileSync } = await import('node:fs');
    vi.mocked(readFileSync).mockReturnValue(
      JSON.stringify({
        pull_request: { head: { ref: 'release/next' }, number: 42, merged: true },
      }),
    );

    await mockForge({ comments: [{ id: 1, body: serializeManifest(baseManifest) }] });

    const { runPublishStep } = await import('../../src/steps.js');
    vi.mocked(runPublishStep).mockResolvedValue({ publishSucceeded: true } as unknown as Awaited<
      ReturnType<typeof runPublishStep>
    >);

    const { execSync } = await import('node:child_process');

    await runStandingPRPublish({ projectDir: '/test', verbose: false, quiet: false, json: false });

    const deleteCalls = vi
      .mocked(execSync)
      .mock.calls.filter((c) => typeof c[0] === 'string' && c[0].includes('--delete'));
    expect(deleteCalls).toHaveLength(1);
    expect(deleteCalls[0][0]).toContain('release/next');
  });

  it('should skip branch deletion when deleteBranchOnMerge is false', async () => {
    const { loadConfig } = await import('@releasekit/config');
    vi.mocked(loadConfig).mockReturnValue({
      ci: { standingPr: { branch: 'release/next', deleteBranchOnMerge: false } },
      git: { branch: 'main' },
    } as ReturnType<typeof loadConfig>);

    const { readFileSync } = await import('node:fs');
    vi.mocked(readFileSync).mockReturnValue(
      JSON.stringify({
        pull_request: { head: { ref: 'release/next' }, number: 42, merged: true },
      }),
    );

    await mockForge({ comments: [{ id: 1, body: serializeManifest(baseManifest) }] });

    const { runPublishStep } = await import('../../src/steps.js');
    vi.mocked(runPublishStep).mockResolvedValue({ publishSucceeded: true } as unknown as Awaited<
      ReturnType<typeof runPublishStep>
    >);

    const { execSync } = await import('node:child_process');

    await runStandingPRPublish({ projectDir: '/test', verbose: false, quiet: false, json: false });

    const deleteCalls = vi
      .mocked(execSync)
      .mock.calls.filter((c) => typeof c[0] === 'string' && c[0].includes('--delete'));
    expect(deleteCalls).toHaveLength(0);
  });

  it('should return null when no GitHub context is available for a merged release PR', async () => {
    delete process.env.GITHUB_REPOSITORY;
    delete process.env.GITHUB_TOKEN;

    const { readFileSync } = await import('node:fs');
    vi.mocked(readFileSync).mockReturnValue(
      JSON.stringify({
        pull_request: { head: { ref: 'release/next' }, number: 42, merged: true },
      }),
    );

    const result = await runStandingPRPublish({ projectDir: '/test', verbose: false, quiet: false, json: false });

    expect(result).toBeNull();
  });

  it('should throw with actionable message when manifest JSON is malformed', async () => {
    const { readFileSync } = await import('node:fs');
    vi.mocked(readFileSync).mockReturnValue(
      JSON.stringify({
        pull_request: { head: { ref: 'release/next' }, number: 42, merged: true },
      }),
    );

    const badManifest = '<!-- releasekit-manifest -->\n<!-- json {broken -->';
    await mockForge({ comments: [{ id: 1, body: badManifest }] });

    await expect(
      runStandingPRPublish({ projectDir: '/test', verbose: false, quiet: false, json: false }),
    ).rejects.toThrow(/invalid or incompatible/);
  });
});
// ─── publishFromManifest ──────────────────────────────────────────────────────

describe('publishFromManifest', () => {
  const originalEnv = { ...process.env };

  beforeEach(async () => {
    vi.resetAllMocks();
    process.env.GITHUB_REPOSITORY = 'owner/repo';
    process.env.GITHUB_TOKEN = 'test-token';

    const { loadConfig } = await import('@releasekit/config');
    vi.mocked(loadConfig).mockReturnValue({
      ci: {
        standingPr: { branch: 'release/next', mergeMethod: 'merge', deleteBranchOnMerge: true },
      },
      git: { branch: 'main' },
    } as ReturnType<typeof loadConfig>);

    const { execSync } = await import('node:child_process');
    vi.mocked(execSync).mockReturnValue('abc123\n');
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('should return null when no GitHub context is available', async () => {
    delete process.env.GITHUB_REPOSITORY;
    delete process.env.GITHUB_TOKEN;

    const result = await publishFromManifest(42, {
      projectDir: '/test',
      verbose: false,
      quiet: false,
      json: false,
    });

    expect(result).toBeNull();
  });

  it('should throw when manifest comment is missing from PR', async () => {
    await mockForge({});

    await expect(
      publishFromManifest(42, { projectDir: '/test', verbose: false, quiet: false, json: false }),
    ).rejects.toThrow(/manifest not found/);
  });

  it('should use human-edited notes from the PR body at merge, overriding regenerated notes (#200)', async () => {
    const { runNotesStep, runPublishStep } = await import('../../src/steps.js');
    vi.mocked(runNotesStep).mockResolvedValue({
      packageNotes: {},
      releaseNotes: { '@scope/core': 'REGENERATED at merge' },
      files: [],
    });
    vi.mocked(runPublishStep).mockResolvedValue({
      npm: [],
      cargo: [],
      githubReleases: [],
      git: { committed: true, tags: [], pushed: true },
    } as unknown as Awaited<ReturnType<typeof runPublishStep>>);

    // Manifest comment present so publish proceeds; the merged PR body carries a human-edited region.
    await mockForge({
      comments: [{ id: 77, body: serializeManifest(baseManifest) }],
      pullRequests: { 99: { body: renderNotesRegion({ '@scope/core': 'EDITED AT MERGE' }), labels: [] } },
    });

    await publishFromManifest(99, { projectDir: '/test', verbose: false, quiet: false, json: false });

    // The edited notes (not the regenerated ones) reach the publish step's release-body map.
    expect(vi.mocked(runPublishStep).mock.calls[0]?.[2]).toMatchObject({ '@scope/core': 'EDITED AT MERGE' });
  });
});

describe('runStandingPRMerge', () => {
  const originalEnv = { ...process.env };

  beforeEach(async () => {
    vi.resetAllMocks();
    process.env.GITHUB_REPOSITORY = 'owner/repo';
    process.env.GITHUB_TOKEN = 'test-token';

    const { loadConfig } = await import('@releasekit/config');
    vi.mocked(loadConfig).mockReturnValue({
      ci: {
        standingPr: { branch: 'release/next', mergeMethod: 'merge', deleteBranchOnMerge: true },
      },
      git: { branch: 'main' },
    } as ReturnType<typeof loadConfig>);

    const { execSync } = await import('node:child_process');
    vi.mocked(execSync).mockReturnValue('abc123\n');
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('should return null when no GitHub context available', async () => {
    delete process.env.GITHUB_REPOSITORY;
    delete process.env.GITHUB_TOKEN;

    const result = await runStandingPRMerge(
      { projectDir: '/test', verbose: false, quiet: false, json: false },
      { publish: false },
    );

    expect(result).toBeNull();
  });

  it('should return null when no open standing PR found', async () => {
    const forge = await mockForge({ standingPR: null });

    const result = await runStandingPRMerge(
      { projectDir: '/test', verbose: false, quiet: false, json: false },
      { publish: false },
    );

    expect(result).toBeNull();
    expect(forge.mergedPullRequests).toHaveLength(0);
  });

  it('should call pulls.merge with mergeMethod from config', async () => {
    const { loadConfig } = await import('@releasekit/config');
    vi.mocked(loadConfig).mockReturnValue({
      ci: {
        standingPr: { branch: 'release/next', mergeMethod: 'squash', deleteBranchOnMerge: true },
      },
      git: { branch: 'main' },
    } as ReturnType<typeof loadConfig>);

    const forge = await mockForge({ standingPR: openStandingPR(42) });

    await runStandingPRMerge({ projectDir: '/test', verbose: false, quiet: false, json: false }, { publish: false });

    expect(forge.mergedPullRequests).toContainEqual({ prNumber: 42, method: 'squash' });
  });

  it('should default to merge method when config omits mergeMethod', async () => {
    const { loadConfig } = await import('@releasekit/config');
    vi.mocked(loadConfig).mockReturnValue({
      ci: {
        standingPr: { branch: 'release/next' }, // no mergeMethod
      },
      git: { branch: 'main' },
    } as ReturnType<typeof loadConfig>);

    const forge = await mockForge({ standingPR: openStandingPR(42) });

    await runStandingPRMerge({ projectDir: '/test', verbose: false, quiet: false, json: false }, { publish: false });

    expect(forge.mergedPullRequests).toContainEqual(expect.objectContaining({ method: 'merge' }));
  });

  it('should throw clear error message on 405 response', async () => {
    const forge = await mockForge({ standingPR: openStandingPR(42) });
    vi.spyOn(forge, 'mergePullRequest').mockRejectedValue({
      status: 405,
      response: { data: { message: 'Required status checks have not passed' } },
    });

    await expect(
      runStandingPRMerge({ projectDir: '/test', verbose: false, quiet: false, json: false }, { publish: false }),
    ).rejects.toThrow(/GitHub rejected the merge/);

    await expect(
      runStandingPRMerge({ projectDir: '/test', verbose: false, quiet: false, json: false }, { publish: false }),
    ).rejects.toThrow(/Required status checks have not passed/);
  });

  it('should re-throw non-405 errors unchanged', async () => {
    const forge = await mockForge({ standingPR: openStandingPR(42) });
    const originalError = new Error('Network error');
    vi.spyOn(forge, 'mergePullRequest').mockRejectedValue(originalError);

    await expect(
      runStandingPRMerge({ projectDir: '/test', verbose: false, quiet: false, json: false }, { publish: false }),
    ).rejects.toThrow('Network error');
  });

  it('should return null without publishing when publish flag is false', async () => {
    await mockForge({ standingPR: openStandingPR(42) });

    const result = await runStandingPRMerge(
      { projectDir: '/test', verbose: false, quiet: false, json: false },
      { publish: false },
    );

    expect(result).toBeNull();
  });

  it('should call publishFromManifest when publish flag is true and manifest exists', async () => {
    await mockForge({
      standingPR: openStandingPR(42),
      comments: [{ id: 1, body: serializeManifest(baseManifest) }],
    });

    const { runNotesStep, runPublishStep } = await import('../../src/steps.js');
    vi.mocked(runNotesStep).mockResolvedValue({
      packageNotes: {},
      releaseNotes: { '@scope/core': '- regenerated' },
      files: ['RELEASE_NOTES.md'],
    });
    vi.mocked(runPublishStep).mockResolvedValue({ publishSucceeded: true } as unknown as Awaited<
      ReturnType<typeof runPublishStep>
    >);

    const result = await runStandingPRMerge(
      { projectDir: '/test', verbose: false, quiet: false, json: false },
      { publish: true },
    );

    expect(result).not.toBeNull();
    expect(vi.mocked(runPublishStep)).toHaveBeenCalledWith(
      expect.objectContaining({ updates: baseManifest.versionOutput.updates }),
      expect.objectContaining({ skipGitCommit: true }),
      { '@scope/core': '- regenerated' },
      expect.arrayContaining(['RELEASE_NOTES.md', ...baseManifest.notesFiles]),
    );
  });

  it('should delete branch after publish when deleteBranchOnMerge is true', async () => {
    await mockForge({
      standingPR: openStandingPR(42),
      comments: [{ id: 1, body: serializeManifest(baseManifest) }],
    });

    const { runPublishStep } = await import('../../src/steps.js');
    vi.mocked(runPublishStep).mockResolvedValue({ publishSucceeded: true } as unknown as Awaited<
      ReturnType<typeof runPublishStep>
    >);

    const { execSync } = await import('node:child_process');

    await runStandingPRMerge({ projectDir: '/test', verbose: false, quiet: false, json: false }, { publish: true });

    const deleteCalls = vi
      .mocked(execSync)
      .mock.calls.filter((c) => typeof c[0] === 'string' && c[0].includes('--delete'));
    expect(deleteCalls).toHaveLength(1);
    expect(deleteCalls[0][0]).toContain('release/next');
  });

  it('should skip branch deletion when deleteBranchOnMerge is false', async () => {
    const { loadConfig } = await import('@releasekit/config');
    vi.mocked(loadConfig).mockReturnValue({
      ci: { standingPr: { branch: 'release/next', deleteBranchOnMerge: false } },
      git: { branch: 'main' },
    } as ReturnType<typeof loadConfig>);

    await mockForge({
      standingPR: openStandingPR(42),
      comments: [{ id: 1, body: serializeManifest(baseManifest) }],
    });

    const { runPublishStep } = await import('../../src/steps.js');
    vi.mocked(runPublishStep).mockResolvedValue({ publishSucceeded: true } as unknown as Awaited<
      ReturnType<typeof runPublishStep>
    >);

    const { execSync } = await import('node:child_process');

    await runStandingPRMerge({ projectDir: '/test', verbose: false, quiet: false, json: false }, { publish: true });

    const deleteCalls = vi
      .mocked(execSync)
      .mock.calls.filter((c) => typeof c[0] === 'string' && c[0].includes('--delete'));
    expect(deleteCalls).toHaveLength(0);
  });

  it('should delete branch even when publish flag is false and deleteBranchOnMerge is true', async () => {
    await mockForge({ standingPR: openStandingPR(42) });

    const { execSync } = await import('node:child_process');

    await runStandingPRMerge({ projectDir: '/test', verbose: false, quiet: false, json: false }, { publish: false });

    const deleteCalls = vi
      .mocked(execSync)
      .mock.calls.filter((c) => typeof c[0] === 'string' && c[0].includes('--delete'));
    expect(deleteCalls).toHaveLength(1);
    expect(deleteCalls[0][0]).toContain('release/next');
  });
});
