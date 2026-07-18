import { createFakeForge, type FakeForge, type FakeForgeSeed } from '@releasekit/forge';
import { FakeGit, type GitLogOptions } from '@releasekit/git';
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

/**
 * A {@link FakeGit} the standing-PR specs can steer per-call. The production code reaches git through
 * two formatted `log` reads that need independent control:
 *  - `getHeadCommitMessage` (`--format=%s`) — the HEAD commit subject the skip-pattern guards key on;
 *    `nextSubject` is a queue so a single test can return different subjects across the two guard
 *    calls (the #323 / #336 mid-run-reset scenarios).
 *  - `createReleaseTags`' tag→commit resolution (`--format=%H`) — answered with the seeded HEAD SHA so
 *    a present tag reads as "at HEAD".
 * Everything else (commit/tag/push/checkout/reset/fetch/add) is the real FakeGit recorder, so specs
 * assert on `committed`/`tagged`/`pushed`/`checkedOut`/`resetTo`/`fetched`/`addedAll`/`added`.
 */
class ControllableGit extends FakeGit {
  /** Queued HEAD subjects for successive `--format=%s` reads; the last value sticks once drained. */
  subjects: string[] = [];
  /** Commit an existing tag resolves to under `--format=%H`. Defaults to HEAD ("tag at HEAD"). */
  tagCommitSha?: string;
  /** When set, the `--format=%H` tag-resolution read throws (git couldn't resolve the tag). */
  tagResolveThrows = false;

  override async log(opts: GitLogOptions): Promise<string> {
    if (opts.format === '%s') {
      // getHeadCommitMessage — return the next queued subject (keep the last once the queue drains).
      return this.subjects.length > 1 ? (this.subjects.shift() ?? '') : (this.subjects[0] ?? '');
    }
    if (opts.format === '%H') {
      // createReleaseTags resolves an existing tag's commit — default to HEAD ("tag at HEAD").
      if (this.tagResolveThrows) throw new Error('cannot resolve tag');
      return `${this.tagCommitSha ?? (await this.headSha(opts.cwd))}\n`;
    }
    return super.log(opts);
  }
}

// The git execution seam: `createGitCli()` hands back the current ControllableGit so specs can both
// steer reads (HEAD subject/SHA) and assert recorded mutations. Re-pointed in each beforeEach.
let fakeGit: ControllableGit;
vi.mock('@releasekit/git', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@releasekit/git')>();
  return { ...actual, createGitCli: () => fakeGit };
});

/** Build a fresh ControllableGit (default HEAD subject = a non-release commit) and make it current. */
function setupGit(seed: { headSha?: string; subject?: string; remoteBranches?: Record<string, string[]> } = {}) {
  fakeGit = new ControllableGit({
    headSha: seed.headSha ?? 'abc123',
    remoteBranches: seed.remoteBranches,
  });
  fakeGit.subjects = [seed.subject ?? 'feat: some feature'];
  return fakeGit;
}

/** Recorded remote-branch deletions: `deleteReleaseBranch` pushes a `:<branch>` delete refspec. */
function branchDeletePushes() {
  return fakeGit.pushed.filter((p) => p.ref?.startsWith(':'));
}

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

// The standing-PR primary-package path lazily imports `getWorkspacePackageNames` to resolve declared
// primaries (incl. unchanged ones) against the workspace. Mock it so the test never hits a real fs;
// defaults to empty (no primaries → flat render) for every test that doesn't opt in.
const mockGetWorkspacePackageNames = vi.fn<(...args: unknown[]) => Promise<string[]>>().mockResolvedValue([]);
vi.mock('@releasekit/version', () => ({
  getWorkspacePackageNames: (...args: unknown[]) => mockGetWorkspacePackageNames(...args),
}));

vi.mock('../../src/steps.js', () => ({
  runVersionStep: vi.fn(),
  runNotesStep: vi.fn(),
  runPublishStep: vi.fn(),
}));

vi.mock('../../src/github.js', () => ({
  forgeFor: vi.fn(),
}));

vi.mock('../../src/preview/refresh.js', () => ({
  refreshFeederPreviews: vi.fn(),
  runRefreshAfterRelease: vi.fn(),
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
    setupGit();
  });

  it('should be a no-op for an empty tag list', async () => {
    await createReleaseTags([], '/tmp/test');
    expect(fakeGit.tagged).toHaveLength(0);
  });

  it('should create a tag when none exists', async () => {
    // No existing ref seeded → refExists is false → the tag is created.
    await createReleaseTags(['v1.2.3'], '/tmp/test');

    expect(fakeGit.tagged).toContainEqual({ name: 'v1.2.3', message: 'Release v1.2.3' });
  });

  it('should skip creation when the tag already points at HEAD', async () => {
    // Tag exists and resolves to HEAD (the %H read defaults to the seeded HEAD SHA) → no creation.
    fakeGit = new ControllableGit({ headSha: 'abc123', existingRefs: ['refs/tags/v1.2.3'] });
    fakeGit.subjects = ['feat: some feature'];

    await createReleaseTags(['v1.2.3'], '/tmp/test');

    expect(fakeGit.tagged).toHaveLength(0);
  });

  it('should not recreate a tag that points at a different commit', async () => {
    // Tag exists but resolves to a different commit than HEAD → warn and skip (no rewrite).
    fakeGit = new ControllableGit({ headSha: 'abc123', existingRefs: ['refs/tags/v1.2.3'] });
    fakeGit.subjects = ['feat: some feature'];
    fakeGit.tagCommitSha = 'othersha';

    await createReleaseTags(['v1.2.3'], '/tmp/test');

    expect(fakeGit.tagged).toHaveLength(0);
  });

  it('should process multiple tags independently', async () => {
    // Tag 1 absent (created); tag 2 exists at HEAD (skipped).
    fakeGit = new ControllableGit({ headSha: 'abc123', existingRefs: ['refs/tags/@scope/pkg@v1.2.3'] });
    fakeGit.subjects = ['feat: some feature'];

    await createReleaseTags(['v1.2.3', '@scope/pkg@v1.2.3'], '/tmp/test');

    // Exactly one tag created — the second was already at HEAD.
    expect(fakeGit.tagged).toEqual([{ name: 'v1.2.3', message: 'Release v1.2.3' }]);
  });

  it('should not throw when tag creation fails', async () => {
    // No existing ref → creation is attempted, but the tag write rejects; the error must not propagate.
    vi.spyOn(fakeGit, 'tag').mockRejectedValue(new Error('git tag failed'));

    await expect(createReleaseTags(['v1.2.3'], '/tmp/test')).resolves.toBeUndefined();
  });

  it('should not throw when HEAD lookup fails', async () => {
    vi.spyOn(fakeGit, 'headSha').mockRejectedValue(new Error('fatal: not a git repository'));
    const tagSpy = vi.spyOn(fakeGit, 'tag');

    await expect(createReleaseTags(['v1.2.3'], '/tmp/test')).resolves.toBeUndefined();
    // Bails at HEAD lookup — never reaches tag creation.
    expect(tagSpy).not.toHaveBeenCalled();
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

  it('should round-trip graduated packages (#486)', () => {
    const m = { ...baseManifest, schemaVersion: 2 as const, graduated: ['@scope/a', '@scope/b'] };
    const parsed = parseManifest(serializeManifest(m));
    expect(parsed.graduated).toEqual(['@scope/a', '@scope/b']);
  });

  it('should accept a manifest without graduated (backward compat)', () => {
    const parsed = parseManifest(serializeManifest(baseManifest));
    expect(parsed.graduated).toBeUndefined();
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
      prPreview: { enabled: true, refreshAfterRelease: false },
      labels: {
        graduate: 'release:graduate',
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

    // HEAD SHA defaults to 'abc123' (the status-check sha the gate assertions key on); the HEAD
    // subject defaults to a non-release commit so the skip-pattern guards pass.
    setupGit();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('should return noop when HEAD commit matches skip pattern', async () => {
    fakeGit.subjects = ['chore: release @scope/core v1.2.3'];

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
    // The first HEAD-subject read (top guard) is a normal commit; the second (post-reset recheck)
    // is a release commit — modelling a release that merged onto base mid-run.
    fakeGit.subjects = ['feat: something (#320)', 'chore: release v0.29.0 (#318)'];

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
    fakeGit.subjects = ['chore: release @scope/core v1.2.3'];

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
    expect(body).toContain('→ 2.0.0'); // target row
    expect(body).toContain('prerequisite');
    expect(body).toContain('@scope/core');
    expect(body).toContain('→ 1.1.0'); // prerequisite row
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
    expect(body).toContain('→ 1.1.0');
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

  // --- Release-unit selection: primaryPackages wiring (#464) ---

  // Config with `@wdio/tauri-service` as a primary over a linked `tauri` group, and the workspace
  // resolver returning both packages so the primary (changed here) anchors the plugin as its child.
  const withPrimaries = async () => {
    const { loadConfig } = await import('@releasekit/config');
    vi.mocked(loadConfig).mockReturnValue({
      ci: {
        standingPr: {
          branch: 'release/next',
          deleteBranchOnMerge: true,
          primaryPackages: ['@wdio/tauri-service'],
          selection: 'streamlined',
        },
      },
      git: { branch: 'main' },
      release: { ci: { skipPatterns: ['chore: release '] } },
      version: { groups: { tauri: { sync: 'linked', packages: ['@wdio/tauri-*'] } } },
    } as unknown as ReturnType<typeof import('@releasekit/config').loadConfig>);
    mockGetWorkspacePackageNames.mockResolvedValue(['@wdio/tauri-service', '@wdio/tauri-plugin']);
  };

  const tauriVersionOutput = {
    dryRun: false,
    strategy: 'group',
    updates: [
      {
        packageName: '@wdio/tauri-service',
        newVersion: '1.4.0',
        filePath: 'packages/svc/package.json',
        group: 'tauri',
      },
      { packageName: '@wdio/tauri-plugin', newVersion: '1.4.0', filePath: 'packages/plg/package.json', group: 'tauri' },
    ],
    changelogs: [],
    tags: [],
    commitMessage: 'chore: release tauri',
    sharedEntries: [],
  };

  it('should render a streamlined release unit with read-only coupled children (#464)', async () => {
    const { runVersionStep, runNotesStep } = await import('../../src/steps.js');
    await withPrimaries();
    vi.mocked(runVersionStep).mockResolvedValue(
      tauriVersionOutput as unknown as Awaited<ReturnType<typeof runVersionStep>>,
    );
    vi.mocked(runNotesStep).mockResolvedValue({ packageNotes: {}, releaseNotes: {}, files: [] });

    const forge = await mockForge({ standingPR: null });
    await runStandingPRUpdate({ projectDir: '/test', verbose: false, quiet: false, json: false });

    const body = forge.createdPullRequests[0]?.body ?? '';
    expect(body).toContain('- [x] **`@wdio/tauri-service`**');
    expect(body).toContain('<details><summary>ships 1 coupled</summary>');
    expect(body).toContain('- `@wdio/tauri-plugin`');
    expect(body).toContain('· coupled');
    // The child is read-only: no task-list checkbox and no identity marker (its state is derived).
    expect(body).not.toContain('rk-sel:@wdio/tauri-plugin');
  });

  it('should cascade a held-back primary to exclude its whole unit from the write (#464)', async () => {
    const { runVersionStep, runNotesStep } = await import('../../src/steps.js');
    await withPrimaries();
    vi.mocked(runVersionStep).mockResolvedValue(
      tauriVersionOutput as unknown as Awaited<ReturnType<typeof runVersionStep>>,
    );
    vi.mocked(runNotesStep).mockResolvedValue({ packageNotes: {}, releaseNotes: {}, files: [] });

    // The live body has the primary unticked; the child carries no marker (streamlined).
    const priorBody = [
      '<!-- releasekit-selection -->',
      '',
      '- [ ] **`@wdio/tauri-service`** → 1.4.0 <!-- rk-sel:@wdio/tauri-service -->',
      '  <details><summary>ships 1 coupled</summary>',
      '',
      '  - `@wdio/tauri-plugin` → 1.4.0 · coupled',
      '  </details>',
      '',
      '<!-- releasekit-selection-end -->',
    ].join('\n');
    // Sets up the live PR state runStandingPRUpdate reads; the assertion is on the write-step args.
    await mockForge({
      standingPR: openStandingPR(99),
      pullRequests: { 99: { body: priorBody, labels: [] } },
    });

    await runStandingPRUpdate({ projectDir: '/test', verbose: false, quiet: false, json: false });

    // Unticking the primary holds back the whole unit — both packages excluded from the bump.
    const writeCall = vi.mocked(runVersionStep).mock.calls[1]?.[0] as { exclude?: string[] };
    expect(writeCall.exclude?.slice().sort()).toEqual(['@wdio/tauri-plugin', '@wdio/tauri-service']);
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

  // Authorization AND per-row channel toggles both enabled — the combination the #526 gate protects.
  const withAuthzChannel = async () => {
    const { loadConfig } = await import('@releasekit/config');
    vi.mocked(loadConfig).mockReturnValue({
      ...defaultConfig,
      ci: {
        ...defaultConfig.ci,
        standingPr: {
          ...defaultConfig.ci.standingPr,
          authorization: { requiredPermission: 'admin' },
          channelToggle: true,
        },
      },
    } as unknown as ReturnType<typeof loadConfig>);
  };

  // A selection body with @scope/a and @scope/b selected, and @scope/b's rk-pre channel toggle ticked
  // (or not). Identity is marker-driven, so the toggle prose is illustrative only.
  const channelBody = (preB: boolean) =>
    [
      '<!-- releasekit-selection -->',
      '',
      '- [x] `@scope/a` → 1.1.0 <!-- rk-sel:@scope/a -->',
      '  - [ ] ship as prerelease → `1.1.0-next.0` · `next` <!-- rk-pre:@scope/a -->',
      '- [x] `@scope/b` → 2.0.0 <!-- rk-sel:@scope/b -->',
      `  - [${preB ? 'x' : ' '}] ship as prerelease → \`2.0.0-next.0\` · \`next\` <!-- rk-pre:@scope/b -->`,
      '',
      '<!-- releasekit-selection-end -->',
    ].join('\n');

  const asActionBy = async (action: string, login: string) => {
    const { readFileSync } = await import('node:fs');
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify({ action, sender: { login, type: 'User' } }));
    process.env.GITHUB_EVENT_NAME = 'pull_request';
    process.env.GITHUB_EVENT_PATH = '/event.json';
  };
  const asEditedBy = (login: string) => asActionBy('edited', login);

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

  it('should not crash the run when the permission check throws — fails closed to the manifest (#401)', async () => {
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

    const forge = await mockForge({
      standingPR: openStandingPR(99),
      pullRequests: { 99: { body: selectionBody(), labels: [] } },
      comments: [{ id: 5, prNumber: 99, body: serializeManifest({ ...baseManifest, deselected: [] }) }],
    });
    // A transient permission-check failure (rate-limit, etc.) must not abort the whole update.
    vi.spyOn(forge, 'getActorPermission').mockRejectedValue(Object.assign(new Error('429'), { status: 429 }));

    const result = await runStandingPRUpdate({ projectDir: '/test', verbose: false, quiet: false, json: false });

    expect(result.action).toBe('updated'); // run completed, no crash
    // Failed closed → the body's untick is ignored and the authoritative (empty) manifest selection wins.
    const writeCall = vi.mocked(runVersionStep).mock.calls[1]?.[0] as { exclude?: string[] };
    expect(writeCall.exclude).toEqual([]);
  });

  it('should ignore + remove an unauthorized actor’s release label, preserving non-release labels (#402)', async () => {
    await withAuthz();
    await asActionBy('labeled', 'rando');
    const { runVersionStep, runNotesStep } = await import('../../src/steps.js');
    const versionOutput = {
      ...createMockVersionOutput([{ packageName: '@scope/core', newVersion: '1.2.3' }]),
      strategy: 'async' as const,
    };
    vi.mocked(runVersionStep).mockResolvedValue(versionOutput as unknown as Awaited<ReturnType<typeof runVersionStep>>);
    vi.mocked(runNotesStep).mockResolvedValue({ packageNotes: {}, releaseNotes: {}, files: [] });

    // 'rando' (write, below admin) added bump:major; the authoritative manifest has no override.
    const forge = await mockForge({
      standingPR: openStandingPR(99, ['release', 'bump:major', 'area:ci']),
      pullRequests: { 99: { body: '', labels: [] } },
      actorPermissions: { rando: 'write' },
      comments: [{ id: 5, prNumber: 99, body: serializeManifest({ ...baseManifest, overrideLabels: [] }) }],
    });

    await runStandingPRUpdate({ projectDir: '/test', verbose: false, quiet: false, json: false });

    // The rogue bump:major is not honoured (no forced bump on the version run)…
    const writeCall = vi.mocked(runVersionStep).mock.calls[1]?.[0] as { bump?: string };
    expect(writeCall.bump).toBeUndefined();
    // …and it is removed from the PR, while non-release labels (area:ci) and the standing label survive.
    const lastSetLabels = forge.setLabelsCalls.at(-1)?.labels ?? [];
    expect(lastSetLabels).not.toContain('bump:major');
    expect(lastSetLabels).toContain('area:ci');
    expect(lastSetLabels).toContain('release');
    // The unauthorized labeller is told their label was rejected (idempotent notice).
    expect(forge.upsertedComments.some((c) => c.marker === '<!-- releasekit-label-denied -->')).toBe(true);
  });

  it('should restore an authorized label that an unauthorized actor removed (unlabeled) (#402)', async () => {
    await withAuthz();
    await asActionBy('unlabeled', 'rando');
    const { runVersionStep, runNotesStep } = await import('../../src/steps.js');
    const versionOutput = {
      ...createMockVersionOutput([{ packageName: '@scope/core', newVersion: '1.2.3' }]),
      strategy: 'async' as const,
    };
    vi.mocked(runVersionStep).mockResolvedValue(versionOutput as unknown as Awaited<ReturnType<typeof runVersionStep>>);
    vi.mocked(runNotesStep).mockResolvedValue({ packageNotes: {}, releaseNotes: {}, files: [] });

    // 'rando' (write, below admin) removed bump:major; the authoritative manifest still has it.
    const forge = await mockForge({
      standingPR: openStandingPR(99, ['release', 'area:ci']), // bump:major already removed by rando
      pullRequests: { 99: { body: '', labels: [] } },
      actorPermissions: { rando: 'write' },
      comments: [{ id: 5, prNumber: 99, body: serializeManifest({ ...baseManifest, overrideLabels: ['bump:major'] }) }],
    });

    await runStandingPRUpdate({ projectDir: '/test', verbose: false, quiet: false, json: false });

    // The authorized bump:major is RESTORED — honoured in the version run and re-applied to the PR.
    const writeCall = vi.mocked(runVersionStep).mock.calls[1]?.[0] as { bump?: string };
    expect(writeCall.bump).toBe('major');
    const lastSetLabels = forge.setLabelsCalls.at(-1)?.labels ?? [];
    expect(lastSetLabels).toContain('bump:major'); // restored from the manifest
    expect(lastSetLabels).toContain('area:ci'); // non-release label preserved
    expect(forge.upsertedComments.some((c) => c.marker === '<!-- releasekit-label-denied -->')).toBe(true);
  });

  it('should honour an authorized actor’s release label (#402)', async () => {
    await withAuthz();
    await asActionBy('labeled', 'admin-user');
    const { runVersionStep, runNotesStep } = await import('../../src/steps.js');
    const versionOutput = {
      ...createMockVersionOutput([{ packageName: '@scope/core', newVersion: '1.2.3' }]),
      strategy: 'async' as const,
    };
    vi.mocked(runVersionStep).mockResolvedValue(versionOutput as unknown as Awaited<ReturnType<typeof runVersionStep>>);
    vi.mocked(runNotesStep).mockResolvedValue({ packageNotes: {}, releaseNotes: {}, files: [] });

    await mockForge({
      standingPR: openStandingPR(99, ['release', 'bump:major']),
      pullRequests: { 99: { body: '', labels: [] } },
      actorPermissions: { 'admin-user': 'admin' },
    });

    await runStandingPRUpdate({ projectDir: '/test', verbose: false, quiet: false, json: false });

    const writeCall = vi.mocked(runVersionStep).mock.calls[1]?.[0] as { bump?: string };
    expect(writeCall.bump).toBe('major'); // authorized override honoured
  });

  // #526 — channel toggles (rk-pre/rk-grad) get the same manifest reconciliation as ad-hoc deselection.
  const channelWriteOutput = async () => {
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
  };

  it('should honour an authorized actor’s channel toggle (#526)', async () => {
    await withAuthzChannel();
    await asEditedBy('admin-user');
    await channelWriteOutput();
    const { runVersionStep } = await import('../../src/steps.js');

    const forge = await mockForge({
      standingPR: openStandingPR(99),
      pullRequests: { 99: { body: channelBody(true), labels: [] } }, // rk-pre ticked on @scope/b
      actorPermissions: { 'admin-user': 'admin' },
    });

    await runStandingPRUpdate({ projectDir: '/test', verbose: false, quiet: false, json: false });

    const writeCall = vi.mocked(runVersionStep).mock.calls[1]?.[0] as { prereleaseScope?: string[] };
    expect(writeCall.prereleaseScope).toEqual(['@scope/b']); // admin's prerelease toggle is applied
    expect(forge.upsertedComments.some((c) => c.marker === '<!-- releasekit-channel-denied -->')).toBe(false);
  });

  it('should ignore an unauthorized actor’s channel toggle (manifest stays authoritative) and post a notice (#526)', async () => {
    await withAuthzChannel();
    await asEditedBy('rando');
    await channelWriteOutput();
    const { runVersionStep } = await import('../../src/steps.js');

    // The body ticks rk-pre on @scope/b, but the authoritative manifest records no prerelease — the
    // unauthorized edit must be dropped and the (empty) manifest channel selection used instead.
    const forge = await mockForge({
      standingPR: openStandingPR(99),
      pullRequests: { 99: { body: channelBody(true), labels: [] } },
      actorPermissions: { rando: 'write' }, // below the 'admin' threshold
      comments: [{ id: 5, prNumber: 99, body: serializeManifest({ ...baseManifest, schemaVersion: 2 }) }],
    });

    await runStandingPRUpdate({ projectDir: '/test', verbose: false, quiet: false, json: false });

    const writeCall = vi.mocked(runVersionStep).mock.calls[1]?.[0] as { prereleaseScope?: string[] };
    expect(writeCall.prereleaseScope).toBeUndefined(); // rogue prerelease toggle not published
    expect(forge.upsertedComments.some((c) => c.marker === '<!-- releasekit-channel-denied -->')).toBe(true);
  });

  it('should re-apply the manifest’s approved channel for an unauthorized actor (#526)', async () => {
    await withAuthzChannel();
    await asEditedBy('rando');
    await channelWriteOutput();
    const { runVersionStep } = await import('../../src/steps.js');

    // The manifest approved @scope/b as a prerelease last run. An unauthorized editor unticked it in
    // the body — the write must still prerelease @scope/b (manifest wins), reverting the removal.
    const forge = await mockForge({
      standingPR: openStandingPR(99),
      pullRequests: { 99: { body: channelBody(false), labels: [] } }, // rk-pre unticked
      actorPermissions: { rando: 'write' },
      comments: [
        {
          id: 5,
          prNumber: 99,
          body: serializeManifest({ ...baseManifest, schemaVersion: 2, prereleased: ['@scope/b'] }),
        },
      ],
    });

    await runStandingPRUpdate({ projectDir: '/test', verbose: false, quiet: false, json: false });

    const writeCall = vi.mocked(runVersionStep).mock.calls[1]?.[0] as { prereleaseScope?: string[] };
    expect(writeCall.prereleaseScope).toEqual(['@scope/b']); // approved prerelease preserved
    expect(forge.upsertedComments.some((c) => c.marker === '<!-- releasekit-channel-denied -->')).toBe(true);
  });

  it('should not post a channel-denied notice when an unauthorized edit leaves the toggles unchanged (#526)', async () => {
    await withAuthzChannel();
    await asEditedBy('rando');
    await channelWriteOutput();
    const { runVersionStep } = await import('../../src/steps.js');

    // The body's rk-pre tick on @scope/b matches the manifest's approved prerelease — an unrelated edit
    // (e.g. to the notes region) must not misfire the notice just because the toggle is present.
    const forge = await mockForge({
      standingPR: openStandingPR(99),
      pullRequests: { 99: { body: channelBody(true), labels: [] } },
      actorPermissions: { rando: 'write' },
      comments: [
        {
          id: 5,
          prNumber: 99,
          body: serializeManifest({ ...baseManifest, schemaVersion: 2, prereleased: ['@scope/b'] }),
        },
      ],
    });

    await runStandingPRUpdate({ projectDir: '/test', verbose: false, quiet: false, json: false });

    const writeCall = vi.mocked(runVersionStep).mock.calls[1]?.[0] as { prereleaseScope?: string[] };
    expect(writeCall.prereleaseScope).toEqual(['@scope/b']); // unchanged, still applied
    expect(forge.upsertedComments.some((c) => c.marker === '<!-- releasekit-channel-denied -->')).toBe(false);
  });

  it('should leave channel toggles unreconciled when the feature is disabled (#526)', async () => {
    // authorization set, but channelToggle OFF — extractChannelSelection is never called, so a body
    // toggle can't drive the write regardless of actor. The gate is a no-op here.
    await withAuthz();
    await asEditedBy('rando');
    await channelWriteOutput();
    const { runVersionStep } = await import('../../src/steps.js');

    const forge = await mockForge({
      standingPR: openStandingPR(99),
      pullRequests: { 99: { body: channelBody(true), labels: [] } },
      actorPermissions: { rando: 'write' },
      comments: [{ id: 5, prNumber: 99, body: serializeManifest({ ...baseManifest, schemaVersion: 2 }) }],
    });

    await runStandingPRUpdate({ projectDir: '/test', verbose: false, quiet: false, json: false });

    const writeCall = vi.mocked(runVersionStep).mock.calls[1]?.[0] as { prereleaseScope?: string[] };
    expect(writeCall.prereleaseScope).toBeUndefined();
    expect(forge.upsertedComments.some((c) => c.marker === '<!-- releasekit-channel-denied -->')).toBe(false);
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
    // normal commit. Keying on the reset (resetTo recorded by resetReleaseBranch) keeps this correct
    // whether or not the first guard runs its HEAD-subject read — the bypass is supposed to skip it.
    vi.spyOn(fakeGit, 'log').mockImplementation(async (opts) => {
      if (opts.format === '%s') {
        return fakeGit.resetTo.length > 0 ? 'feat: something (#320)' : 'chore: release preparation';
      }
      return '';
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

  it('should co-locate a per-row changelog with the package row and add a flat deduped footer', async () => {
    const { runVersionStep, runNotesStep } = await import('../../src/steps.js');
    const versionOutput = {
      ...createMockVersionOutput([{ packageName: '@scope/core', newVersion: '1.2.3' }]),
      strategy: 'async' as const,
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

    const body = forge.createdPullRequests[0]?.body ?? '';
    // The single combined "### Changelog" blob and per-package version headers are gone.
    expect(body).not.toContain('### Changelog');
    expect(body).not.toContain('@scope/core — 1.2.2 → 1.2.3');
    // Per-row changelog: a collapsed pane co-located with the row, grouped by change type.
    const rowIdx = body.indexOf('- [x] `@scope/core` → 1.2.3');
    const perRowIdx = body.indexOf('<details><summary>Changelog (2 entries)</summary>');
    expect(rowIdx).toBeGreaterThanOrEqual(0);
    expect(perRowIdx).toBeGreaterThan(rowIdx);
    expect(body).toContain('#### Added');
    expect(body).toContain('Add new widget');
    expect(body).toContain('#### Fixed');
    expect(body).toContain('Fix broken export');
    // Combined footer: a single flat, de-duplicated block (default-on), below the selection region.
    expect(body).toContain('<details><summary>Show all changes (2 changes, de-duplicated)</summary>');
    expect(body.indexOf('Show all changes')).toBeGreaterThan(perRowIdx);
  });

  it('should de-duplicate a shared change across packages once in the combined footer', async () => {
    const { runVersionStep, runNotesStep } = await import('../../src/steps.js');
    // The same commit lands an identical entry in two packages — the footer collapses it to one line
    // with inline scope attribution, while each package keeps its own per-row changelog copy.
    const shared = { type: 'fix', description: 'Patch the shared serializer' };
    const versionOutput = {
      ...createMockVersionOutput([
        { packageName: '@scope/a', newVersion: '1.1.0' },
        { packageName: '@scope/b', newVersion: '1.1.0' },
      ]),
      strategy: 'async' as const,
      changelogs: [
        {
          packageName: '@scope/a',
          version: '1.1.0',
          previousVersion: '1.0.0',
          revisionRange: '',
          repoUrl: null,
          entries: [shared],
        },
        {
          packageName: '@scope/b',
          version: '1.1.0',
          previousVersion: '1.0.0',
          revisionRange: '',
          repoUrl: null,
          entries: [shared],
        },
      ],
    };
    vi.mocked(runVersionStep)
      .mockResolvedValueOnce(versionOutput as unknown as Awaited<ReturnType<typeof runVersionStep>>)
      .mockResolvedValueOnce(versionOutput as unknown as Awaited<ReturnType<typeof runVersionStep>>);
    vi.mocked(runNotesStep).mockResolvedValue({ packageNotes: {}, releaseNotes: {}, files: [] });

    const forge = await mockForge({ standingPR: null });

    await runStandingPRUpdate({ projectDir: '/test', verbose: false, quiet: false, json: false });

    const body = forge.createdPullRequests[0]?.body ?? '';
    const footerStart = body.indexOf('Show all changes');
    const footer = body.slice(footerStart);
    // One footer line for the shared change, attributed to both packages.
    const occurrences = footer.split('Patch the shared serializer').length - 1;
    expect(occurrences).toBe(1);
    expect(footer).toContain('_(a, b)_');
  });

  it('should omit the combined footer when ci.standingPr.combinedChangelogFooter is false', async () => {
    const { loadConfig } = await import('@releasekit/config');
    vi.mocked(loadConfig).mockReturnValueOnce({
      ci: { standingPr: { branch: 'release/next', deleteBranchOnMerge: true, combinedChangelogFooter: false } },
      git: { branch: 'main' },
      release: { ci: { skipPatterns: ['chore: release '] } },
    } as unknown as ReturnType<typeof loadConfig>);
    const { runVersionStep, runNotesStep } = await import('../../src/steps.js');
    const versionOutput = {
      ...createMockVersionOutput([{ packageName: '@scope/core', newVersion: '1.2.3' }]),
      strategy: 'async' as const,
      changelogs: [
        {
          packageName: '@scope/core',
          version: '1.2.3',
          previousVersion: '1.2.2',
          revisionRange: '',
          repoUrl: null,
          entries: [{ type: 'feat', description: 'Add new widget' }],
        },
      ],
    };
    vi.mocked(runVersionStep)
      .mockResolvedValueOnce(versionOutput as unknown as Awaited<ReturnType<typeof runVersionStep>>)
      .mockResolvedValueOnce(versionOutput as unknown as Awaited<ReturnType<typeof runVersionStep>>);
    vi.mocked(runNotesStep).mockResolvedValue({ packageNotes: {}, releaseNotes: {}, files: [] });

    const forge = await mockForge({ standingPR: null });

    await runStandingPRUpdate({ projectDir: '/test', verbose: false, quiet: false, json: false });

    const body = forge.createdPullRequests[0]?.body ?? '';
    // No footer at all (no shared entries to home), but the per-row changelog still rides with the row.
    expect(body).not.toContain('Show all changes');
    expect(body).not.toContain('Show project-wide changes');
    expect(body).toContain('<details><summary>Changelog (1 entry)</summary>');
  });

  // Build a mixed-channel async version output whose updates carry the #520 baseline/channel fields the
  // summary line and table render from.
  function mixedChannelOutput() {
    return {
      dryRun: false,
      strategy: 'async' as const,
      updates: [
        {
          packageName: '@scope/a',
          newVersion: '1.2.0',
          filePath: 'packages/a/package.json',
          channel: 'stable' as const,
          previousVersion: 'v1.1.0',
        },
        {
          packageName: '@scope/b',
          newVersion: '1.0.0-next.1',
          filePath: 'packages/b/package.json',
          channel: 'prerelease' as const,
          previousVersion: 'v1.0.0-next.0',
        },
      ],
      changelogs: [
        {
          packageName: '@scope/a',
          version: '1.2.0',
          previousVersion: 'v1.1.0',
          revisionRange: '',
          repoUrl: null,
          entries: [{ type: 'feat', description: 'A feature' }],
        },
        {
          packageName: '@scope/b',
          version: '1.0.0-next.1',
          previousVersion: 'v1.0.0-next.0',
          revisionRange: '',
          repoUrl: null,
          entries: [{ type: 'fix', description: 'B fix' }],
        },
      ],
      tags: ['@scope/a@v1.2.0', '@scope/b@v1.0.0-next.1'],
      commitMessage: 'chore: release 2 package(s)',
      sharedEntries: [],
    };
  }

  it('should render the #520 release summary line and omit the version-summary table by default', async () => {
    const { runVersionStep, runNotesStep } = await import('../../src/steps.js');
    const versionOutput = mixedChannelOutput();
    vi.mocked(runVersionStep)
      .mockResolvedValueOnce(versionOutput as unknown as Awaited<ReturnType<typeof runVersionStep>>)
      .mockResolvedValueOnce(versionOutput as unknown as Awaited<ReturnType<typeof runVersionStep>>);
    vi.mocked(runNotesStep).mockResolvedValue({ packageNotes: {}, releaseNotes: {}, files: [] });

    const forge = await mockForge({ standingPR: null });

    await runStandingPRUpdate({ projectDir: '/test', verbose: false, quiet: false, json: false });

    const body = forge.createdPullRequests[0]?.body ?? '';
    expect(body).toContain('**2 packages** will publish — 1 stable · 1 prerelease · 2 changes. No major bumps.');
    // The table is opt-in via ci.standingPr.summaryTable — off in the default config.
    expect(body).not.toContain('Version summary (');
  });

  it('should render the #520 version-summary table when ci.standingPr.summaryTable is true', async () => {
    const { loadConfig } = await import('@releasekit/config');
    vi.mocked(loadConfig).mockReturnValueOnce({
      ci: { standingPr: { branch: 'release/next', deleteBranchOnMerge: true, summaryTable: true } },
      git: { branch: 'main' },
      release: { ci: { skipPatterns: ['chore: release '] } },
    } as unknown as ReturnType<typeof loadConfig>);
    const { runVersionStep, runNotesStep } = await import('../../src/steps.js');
    const versionOutput = mixedChannelOutput();
    vi.mocked(runVersionStep)
      .mockResolvedValueOnce(versionOutput as unknown as Awaited<ReturnType<typeof runVersionStep>>)
      .mockResolvedValueOnce(versionOutput as unknown as Awaited<ReturnType<typeof runVersionStep>>);
    vi.mocked(runNotesStep).mockResolvedValue({ packageNotes: {}, releaseNotes: {}, files: [] });

    const forge = await mockForge({ standingPR: null });

    await runStandingPRUpdate({ projectDir: '/test', verbose: false, quiet: false, json: false });

    const body = forge.createdPullRequests[0]?.body ?? '';
    const tableIdx = body.indexOf('<details><summary>Version summary (2 packages)</summary>');
    expect(tableIdx).toBeGreaterThanOrEqual(0);
    expect(body).toContain('| Package | Current | Next | Bump | Tag |');
    expect(body).toContain('| `@scope/a` | 1.1.0 | 1.2.0 | minor | latest |');
    expect(body).toContain('| `@scope/b` | 1.0.0-next.0 | 1.0.0-next.1 | prerelease | next |');
    // The table sits above the interactive selection region (which it complements, never replaces).
    expect(tableIdx).toBeLessThan(body.indexOf('- [x] `@scope/a`'));
  });

  it('should always render the combined changelog in sync mode even when the footer is disabled', async () => {
    // Sync releases carry no per-row changelogs, so the footer is the only changelog surface — the
    // gate must not strip it, or merging the PR would publish with the changelog gone from the body.
    const { loadConfig } = await import('@releasekit/config');
    vi.mocked(loadConfig).mockReturnValueOnce({
      ci: { standingPr: { branch: 'release/next', deleteBranchOnMerge: true, combinedChangelogFooter: false } },
      git: { branch: 'main' },
      release: { ci: { skipPatterns: ['chore: release '] } },
    } as unknown as ReturnType<typeof loadConfig>);
    const { runVersionStep, runNotesStep } = await import('../../src/steps.js');
    const versionOutput = {
      ...createMockVersionOutput([{ packageName: '@scope/core', newVersion: '1.2.3' }]),
      strategy: 'sync' as const,
      changelogs: [
        {
          packageName: '@scope/core',
          version: '1.2.3',
          previousVersion: '1.2.2',
          revisionRange: '',
          repoUrl: null,
          entries: [{ type: 'feat', description: 'Sync-only feature' }],
        },
      ],
    };
    vi.mocked(runVersionStep)
      .mockResolvedValueOnce(versionOutput as unknown as Awaited<ReturnType<typeof runVersionStep>>)
      .mockResolvedValueOnce(versionOutput as unknown as Awaited<ReturnType<typeof runVersionStep>>);
    vi.mocked(runNotesStep).mockResolvedValue({ packageNotes: {}, releaseNotes: {}, files: [] });

    const forge = await mockForge({ standingPR: null });

    await runStandingPRUpdate({ projectDir: '/test', verbose: false, quiet: false, json: false });

    const body = forge.createdPullRequests[0]?.body ?? '';
    expect(body).toContain('Show all changes');
    expect(body).toContain('Sync-only feature');
  });

  it('should still surface project-wide shared entries when the footer is disabled in non-sync mode', async () => {
    // Shared (project-wide) entries have no per-row home, so disabling the footer must not drop them —
    // only the redundant per-package summary is suppressed.
    const { loadConfig } = await import('@releasekit/config');
    vi.mocked(loadConfig).mockReturnValueOnce({
      ci: { standingPr: { branch: 'release/next', deleteBranchOnMerge: true, combinedChangelogFooter: false } },
      git: { branch: 'main' },
      release: { ci: { skipPatterns: ['chore: release '] } },
    } as unknown as ReturnType<typeof loadConfig>);
    const { runVersionStep, runNotesStep } = await import('../../src/steps.js');
    const versionOutput = {
      ...createMockVersionOutput([{ packageName: '@scope/core', newVersion: '1.2.3' }]),
      strategy: 'async' as const,
      changelogs: [
        {
          packageName: '@scope/core',
          version: '1.2.3',
          previousVersion: '1.2.2',
          revisionRange: '',
          repoUrl: null,
          entries: [{ type: 'feat', description: 'Per-package change' }],
        },
      ],
      sharedEntries: [{ type: 'fix', description: 'Project-wide CI fix' }],
    };
    vi.mocked(runVersionStep)
      .mockResolvedValueOnce(versionOutput as unknown as Awaited<ReturnType<typeof runVersionStep>>)
      .mockResolvedValueOnce(versionOutput as unknown as Awaited<ReturnType<typeof runVersionStep>>);
    vi.mocked(runNotesStep).mockResolvedValue({ packageNotes: {}, releaseNotes: {}, files: [] });

    const forge = await mockForge({ standingPR: null });

    await runStandingPRUpdate({ projectDir: '/test', verbose: false, quiet: false, json: false });

    const body = forge.createdPullRequests[0]?.body ?? '';
    // The de-duplicated per-package summary is suppressed, but project-wide entries get their own block.
    expect(body).not.toContain('Show all changes');
    expect(body).toContain('Show project-wide changes (1 change)');
    expect(body).toContain('Project-wide CI fix');
    // The per-row changelog still carries the package's own change.
    expect(body).toContain('<details><summary>Changelog (1 entry)</summary>');
    expect(body).toContain('Per-package change');
  });

  it('should grey a held-back row’s changelog and exclude it from the combined footer', async () => {
    const { runVersionStep, runNotesStep } = await import('../../src/steps.js');
    const dryOutput = {
      ...createMockVersionOutput([
        { packageName: '@scope/a', newVersion: '1.1.0' },
        { packageName: '@scope/b', newVersion: '2.0.0' },
      ]),
      strategy: 'async' as const,
      changelogs: [
        {
          packageName: '@scope/a',
          version: '1.1.0',
          previousVersion: '1.0.0',
          revisionRange: '',
          repoUrl: null,
          entries: [{ type: 'feat', description: 'Ship A feature' }],
        },
        {
          packageName: '@scope/b',
          version: '2.0.0',
          previousVersion: '1.0.0',
          revisionRange: '',
          repoUrl: null,
          entries: [{ type: 'fix', description: 'Fix B bug' }],
        },
      ],
    };
    // The write run excludes the held-back package (@scope/b), mirroring the engine's `exclude`.
    const writeOutput = {
      ...createMockVersionOutput([{ packageName: '@scope/a', newVersion: '1.1.0' }]),
      strategy: 'async' as const,
      changelogs: [dryOutput.changelogs[0]],
    };
    vi.mocked(runVersionStep)
      .mockResolvedValueOnce(dryOutput as unknown as Awaited<ReturnType<typeof runVersionStep>>)
      .mockResolvedValueOnce(writeOutput as unknown as Awaited<ReturnType<typeof runVersionStep>>);
    vi.mocked(runNotesStep).mockResolvedValue({ packageNotes: {}, releaseNotes: {}, files: [] });

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

    const body = forge.updatedPullRequests[0]?.changes.body ?? '';
    // Held-back row's changelog is greyed and flagged, but still shown next to the unticked row.
    expect(body).toContain('<s>Changelog (1 entry)</s> — held back');
    // The footer reflects only what publishes — @scope/a's change is in, @scope/b's is not.
    const footer = body.slice(body.indexOf('Show all changes'));
    expect(footer).toContain('Ship A feature');
    expect(footer).not.toContain('Fix B bug');
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

    it('should drop the bump under release:graduate (graduation is bump-less, matching the SSOT)', async () => {
      const { runVersionStepMock } = await setupWithStandingPRLabels(['release', 'bump:major', 'release:graduate']);

      await runStandingPRUpdate({ projectDir: '/test', verbose: false, quiet: false, json: false });

      // release:graduate wins — bump is dropped (not leaked as 'major'), consistent with
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

  describe('per-package graduation (#486)', () => {
    // A mixed async standing PR: @scope/a stays on its stable line, @scope/b is a prerelease.
    const mixedOutput = (graduatedName?: string) => ({
      dryRun: false,
      strategy: 'async' as const,
      updates: [
        {
          packageName: '@scope/a',
          newVersion: graduatedName === '@scope/a' ? '1.0.0' : '1.0.1',
          filePath: 'packages/a/package.json',
          channel: 'stable' as const,
          action: graduatedName === '@scope/a' ? ('graduated' as const) : ('bumped' as const),
        },
        {
          packageName: '@scope/b',
          newVersion: graduatedName === '@scope/b' ? '2.0.0' : '2.0.0-next.2',
          filePath: 'packages/b/package.json',
          channel: graduatedName === '@scope/b' ? ('stable' as const) : ('prerelease' as const),
          action: graduatedName === '@scope/b' ? ('graduated' as const) : ('bumped' as const),
        },
      ],
      changelogs: [],
      tags: [],
      commitMessage: 'chore: release',
      sharedEntries: [],
    });

    async function setupGraduation(labels: string[], graduatedName?: string) {
      const { runVersionStep, runNotesStep } = await import('../../src/steps.js');
      const output = mixedOutput(graduatedName);
      vi.mocked(runVersionStep)
        .mockResolvedValueOnce(output as unknown as Awaited<ReturnType<typeof runVersionStep>>)
        .mockResolvedValueOnce(output as unknown as Awaited<ReturnType<typeof runVersionStep>>);
      vi.mocked(runNotesStep).mockResolvedValue({ packageNotes: {}, releaseNotes: {}, files: [] });
      const forge = await mockForge({ standingPR: openStandingPR(99, labels) });
      return { forge, runVersionStepMock: vi.mocked(runVersionStep) };
    }

    it('should pass a graduate:<package> label as the graduate set into both version runs', async () => {
      const { runVersionStepMock } = await setupGraduation(['release', 'graduate:@scope/b'], '@scope/b');

      await runStandingPRUpdate({ projectDir: '/test', verbose: false, quiet: false, json: false });

      expect(runVersionStepMock.mock.calls[0]?.[0]).toMatchObject({ graduate: ['@scope/b'] });
      expect(runVersionStepMock.mock.calls[1]?.[0]).toMatchObject({ graduate: ['@scope/b'] });
      // Per-package graduation is NOT the whole-batch graduate — `stable` stays unset.
      expect(runVersionStepMock.mock.calls[0]?.[0]?.stable).toBeUndefined();
    });

    it('should record the graduated package in the manifest', async () => {
      const { forge } = await setupGraduation(['release', 'graduate:@scope/b'], '@scope/b');

      await runStandingPRUpdate({ projectDir: '/test', verbose: false, quiet: false, json: false });

      const writes = [...forge.createdComments.map((c) => c.body), ...forge.updatedComments.map((c) => c.body)];
      const manifestWrite = writes.find((b) => b.includes(MANIFEST_MARKER));
      const manifest = parseManifest(manifestWrite as string);
      expect(manifest.graduated).toEqual(['@scope/b']);
    });

    it('should record the graduate:<package> label in the manifest overrideLabels (staleness guard)', async () => {
      const { forge } = await setupGraduation(['release', 'graduate:@scope/b'], '@scope/b');

      await runStandingPRUpdate({ projectDir: '/test', verbose: false, quiet: false, json: false });

      const writes = [...forge.createdComments.map((c) => c.body), ...forge.updatedComments.map((c) => c.body)];
      const manifest = parseManifest(writes.find((b) => b.includes(MANIFEST_MARKER)) as string);
      expect(manifest.overrideLabels).toContain('graduate:@scope/b');
    });

    it('should let the whole-batch release:graduate win over per-package graduate labels', async () => {
      const { runVersionStepMock } = await setupGraduation(['release', 'release:graduate', 'graduate:@scope/b']);

      await runStandingPRUpdate({ projectDir: '/test', verbose: false, quiet: false, json: false });

      expect(runVersionStepMock.mock.calls[0]?.[0]).toMatchObject({ stable: true });
      expect(runVersionStepMock.mock.calls[0]?.[0]?.graduate).toBeUndefined();
    });

    it('should create a graduate:<package> label for each prerelease package so it can be applied', async () => {
      const { forge } = await setupGraduation(['release']);

      await runStandingPRUpdate({ projectDir: '/test', verbose: false, quiet: false, json: false });

      // @scope/b is on a prerelease line → its graduate label is seeded; @scope/a is stable → no label.
      expect(forge.createdLabels.some((l) => l.name === 'graduate:@scope/b')).toBe(true);
      expect(forge.createdLabels.some((l) => l.name === 'graduate:@scope/a')).toBe(false);
    });

    it('should name the offending graduate label in the conflict when it meets channel:prerelease', async () => {
      const { forge } = await setupGraduation(['release', 'graduate:@scope/b', 'channel:prerelease'], '@scope/b');

      await runStandingPRUpdate({ projectDir: '/test', verbose: false, quiet: false, json: false });

      const lastStatus = forge.commitStatuses.at(-1);
      expect(lastStatus?.state).toBe('pending');
      // The specific stale graduate label is surfaced (not an opaque "release-type labels conflict")
      // so the maintainer knows exactly what to remove — and it survives the 140-char status truncation.
      expect(lastStatus?.description).toContain('graduate:@scope/b');
      expect(lastStatus?.description).toContain('channel:prerelease');
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

    setupGit();
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
    // The publish moved `main`, so feeder-PR previews are refreshed in-process (#459).
    const { refreshFeederPreviews } = await import('../../src/preview/refresh.js');
    expect(vi.mocked(refreshFeederPreviews)).toHaveBeenCalledWith(expect.objectContaining({ projectDir: '/test' }));
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

  const publishConfigWithAuthz = async (authorization: Record<string, unknown>) => {
    const { loadConfig } = await import('@releasekit/config');
    vi.mocked(loadConfig).mockReturnValue({
      ci: { standingPr: { branch: 'release/next', deleteBranchOnMerge: true, authorization } },
      git: { branch: 'main' },
    } as unknown as ReturnType<typeof loadConfig>);
  };

  const mergedByEvent = async (login: string) => {
    const { readFileSync } = await import('node:fs');
    vi.mocked(readFileSync).mockReturnValue(
      JSON.stringify({
        pull_request: { head: { ref: 'release/next' }, number: 42, merged: true, merged_by: { login } },
      }),
    );
  };

  it('should refuse to publish when the merger is not authorized (#403)', async () => {
    await publishConfigWithAuthz({ requiredPermission: 'admin', enforceMergeAuthor: true });
    await mergedByEvent('rando');
    await mockForge({
      comments: [{ id: 1, body: serializeManifest(baseManifest) }],
      actorPermissions: { rando: 'write' }, // below admin
    });

    await expect(
      runStandingPRPublish({ projectDir: '/test', verbose: false, quiet: false, json: false }),
    ).rejects.toThrow(/Refusing to publish/);

    const { runPublishStep } = await import('../../src/steps.js');
    expect(vi.mocked(runPublishStep)).not.toHaveBeenCalled();
  });

  it('should publish when the merger is authorized (#403)', async () => {
    await publishConfigWithAuthz({ requiredPermission: 'admin', enforceMergeAuthor: true });
    await mergedByEvent('admin-user');
    await mockForge({
      comments: [{ id: 1, body: serializeManifest(baseManifest) }],
      actorPermissions: { 'admin-user': 'admin' },
    });
    const { runNotesStep, runPublishStep } = await import('../../src/steps.js');
    vi.mocked(runNotesStep).mockResolvedValue({ packageNotes: {}, releaseNotes: {}, files: [] });
    vi.mocked(runPublishStep).mockResolvedValue({ publishSucceeded: true } as unknown as Awaited<
      ReturnType<typeof runPublishStep>
    >);

    const result = await runStandingPRPublish({ projectDir: '/test', verbose: false, quiet: false, json: false });

    expect(result).not.toBeNull();
    expect(vi.mocked(runPublishStep)).toHaveBeenCalled();
  });

  it('should not check the merger when enforceMergeAuthor is false (#403)', async () => {
    await publishConfigWithAuthz({ requiredPermission: 'admin', enforceMergeAuthor: false });
    await mergedByEvent('rando'); // unauthorized, but the check is disabled
    await mockForge({
      comments: [{ id: 1, body: serializeManifest(baseManifest) }],
      actorPermissions: { rando: 'write' },
    });
    const { runNotesStep, runPublishStep } = await import('../../src/steps.js');
    vi.mocked(runNotesStep).mockResolvedValue({ packageNotes: {}, releaseNotes: {}, files: [] });
    vi.mocked(runPublishStep).mockResolvedValue({ publishSucceeded: true } as unknown as Awaited<
      ReturnType<typeof runPublishStep>
    >);

    const result = await runStandingPRPublish({ projectDir: '/test', verbose: false, quiet: false, json: false });

    expect(result).not.toBeNull();
    expect(vi.mocked(runPublishStep)).toHaveBeenCalled();
  });

  it('should publish (fail open) when the merger permission check is unverifiable (#403)', async () => {
    await publishConfigWithAuthz({ requiredPermission: 'admin', enforceMergeAuthor: true });
    await mergedByEvent('someone');
    const forge = await mockForge({ comments: [{ id: 1, body: serializeManifest(baseManifest) }] });
    // A transient permission-check failure must not block the publish — the merge ruleset is primary.
    vi.spyOn(forge, 'getActorPermission').mockRejectedValue(Object.assign(new Error('500'), { status: 500 }));
    const { runNotesStep, runPublishStep } = await import('../../src/steps.js');
    vi.mocked(runNotesStep).mockResolvedValue({ packageNotes: {}, releaseNotes: {}, files: [] });
    vi.mocked(runPublishStep).mockResolvedValue({ publishSucceeded: true } as unknown as Awaited<
      ReturnType<typeof runPublishStep>
    >);

    const result = await runStandingPRPublish({ projectDir: '/test', verbose: false, quiet: false, json: false });

    expect(result).not.toBeNull();
    expect(vi.mocked(runPublishStep)).toHaveBeenCalled(); // failed open
  });

  it('should treat a Bot merger as authorized via merged_by.type, without a permission call (#403)', async () => {
    await publishConfigWithAuthz({ requiredPermission: 'admin', enforceMergeAuthor: true });
    const { readFileSync } = await import('node:fs');
    // A GitHub App whose login does NOT end in [bot] — recognised by type, not the login suffix.
    vi.mocked(readFileSync).mockReturnValue(
      JSON.stringify({
        pull_request: {
          head: { ref: 'release/next' },
          number: 42,
          merged: true,
          merged_by: { login: 'release-bot', type: 'Bot' },
        },
      }),
    );
    const forge = await mockForge({ comments: [{ id: 1, body: serializeManifest(baseManifest) }] });
    const permSpy = vi.spyOn(forge, 'getActorPermission');
    const { runNotesStep, runPublishStep } = await import('../../src/steps.js');
    vi.mocked(runNotesStep).mockResolvedValue({ packageNotes: {}, releaseNotes: {}, files: [] });
    vi.mocked(runPublishStep).mockResolvedValue({ publishSucceeded: true } as unknown as Awaited<
      ReturnType<typeof runPublishStep>
    >);

    const result = await runStandingPRPublish({ projectDir: '/test', verbose: false, quiet: false, json: false });

    expect(result).not.toBeNull();
    expect(vi.mocked(runPublishStep)).toHaveBeenCalled();
    expect(permSpy).not.toHaveBeenCalled(); // recognised as a bot by type — no permission lookup
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

    await runStandingPRPublish({ projectDir: '/test', verbose: false, quiet: false, json: false });

    const deleteCalls = branchDeletePushes();
    expect(deleteCalls).toHaveLength(1);
    expect(deleteCalls[0]?.ref).toBe(':release/next');
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

    await runStandingPRPublish({ projectDir: '/test', verbose: false, quiet: false, json: false });

    expect(branchDeletePushes()).toHaveLength(0);
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

    setupGit();
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

    setupGit();
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

    await runStandingPRMerge({ projectDir: '/test', verbose: false, quiet: false, json: false }, { publish: true });

    const deleteCalls = branchDeletePushes();
    expect(deleteCalls).toHaveLength(1);
    expect(deleteCalls[0]?.ref).toBe(':release/next');
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

    await runStandingPRMerge({ projectDir: '/test', verbose: false, quiet: false, json: false }, { publish: true });

    expect(branchDeletePushes()).toHaveLength(0);
  });

  it('should delete branch even when publish flag is false and deleteBranchOnMerge is true', async () => {
    await mockForge({ standingPR: openStandingPR(42) });

    await runStandingPRMerge({ projectDir: '/test', verbose: false, quiet: false, json: false }, { publish: false });

    const deleteCalls = branchDeletePushes();
    expect(deleteCalls).toHaveLength(1);
    expect(deleteCalls[0]?.ref).toBe(':release/next');
  });
});
