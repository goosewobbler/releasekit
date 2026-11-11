import { info, type VersionOutput, warn } from '@releasekit/core';
import { createFakeForge, type FakeForge } from '@releasekit/forge';
import { FakeGit } from '@releasekit/git';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReleaseOptions } from '../../src/types.js';

const mockLoadReleaseKitConfig = vi.fn();
const mockLoadCIConfig = vi.fn();
const mockForgeFor = vi.fn();
const mockMarkFeederPreviewsStale = vi.fn();

vi.mock('../../src/preview/stale.js', () => ({
  markFeederPreviewsStale: (...args: unknown[]) => mockMarkFeederPreviewsStale(...args),
}));

vi.mock('@releasekit/config', () => ({
  loadConfig: (...args: unknown[]) => ({ ...mockLoadReleaseKitConfig(...args), ci: mockLoadCIConfig() }),
}));

// The git seam backs `getHeadCommitMessage` (the skip-pattern guard's HEAD-subject read).
let fakeGit: FakeGit;
let gitLogSpy: ReturnType<typeof vi.spyOn> | undefined;
function setGitSubject(subject: string) {
  fakeGit = new FakeGit({ commits: { '*': `${subject}\n` } });
  gitLogSpy = vi.spyOn(fakeGit, 'log');
}
vi.mock('@releasekit/git', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@releasekit/git')>();
  return { ...actual, createGitCli: () => fakeGit };
});

vi.mock('../../src/github.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/github.js')>()),
  forgeFor: (...args: unknown[]) => mockForgeFor(...args),
}));

const mockEnableJsonOutput = vi.fn();
const mockGetJsonData = vi.fn();
const mockFlushPendingWrites = vi.fn();
const mockVersionLoadConfig = vi.fn();
const mockVersionEngineRun = vi.fn();
const mockVersionEngineSetStrategy = vi.fn();
const mockVersionEngineGetWorkspacePackages = vi.fn();

const MockVersionEngine = vi.fn(function (this: Record<string, unknown>, config, runOptions) {
  this.config = config;
  this.runOptions = runOptions;
  this.run = mockVersionEngineRun;
  this.setStrategy = mockVersionEngineSetStrategy;
  this.getWorkspacePackages = mockVersionEngineGetWorkspacePackages;
});

Object.defineProperty(MockVersionEngine, 'lastCall', {
  get() {
    const calls = MockVersionEngine.mock.calls;
    return calls.length > 0 ? calls[calls.length - 1] : null;
  },
});

vi.mock('@releasekit/version', () => ({
  enableJsonOutput: (...args: unknown[]) => mockEnableJsonOutput(...args),
  flushPendingWrites: () => mockFlushPendingWrites(),
  getJsonData: () => mockGetJsonData(),
  loadConfig: (...args: unknown[]) => mockVersionLoadConfig(...args),
  VersionEngine: MockVersionEngine,
}));

const mockNotesRunPipeline = vi.fn();
const mockNotesLoadConfig = vi.fn();
const mockVersionOutputToChangelogInput = vi.fn();

vi.mock('@releasekit/notes', () => ({
  runPipeline: (...args: unknown[]) => mockNotesRunPipeline(...args),
  loadConfig: (...args: unknown[]) => mockNotesLoadConfig(...args),
  versionOutputToChangelogInput: (...args: unknown[]) => mockVersionOutputToChangelogInput(...args),
}));

const mockPublishRunPipeline = vi.fn();
const mockPublishLoadConfig = vi.fn();

vi.mock('@releasekit/publish', async (importOriginal) => {
  // Pull the real PipelineError through so release.ts's `instanceof PipelineError` check works.
  const actual = await importOriginal<typeof import('@releasekit/publish')>();
  return {
    PipelineError: actual.PipelineError,
    runPipeline: (...args: unknown[]) => mockPublishRunPipeline(...args),
    loadConfig: (...args: unknown[]) => mockPublishLoadConfig(...args),
  };
});

vi.mock('@releasekit/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@releasekit/core')>();
  return {
    ...actual,
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    success: vi.fn(),
    setLogLevel: vi.fn(),
    setQuietMode: vi.fn(),
    setJsonMode: vi.fn(),
  };
});

const defaultOptions: ReleaseOptions = {
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
  projectDir: '/test/project',
  target: '@test/package',
};

const versionOutputWithChanges: VersionOutput = {
  dryRun: false,
  updates: [{ packageName: 'test-pkg', newVersion: '1.1.0', filePath: 'package.json' }],
  changelogs: [
    {
      packageName: 'test-pkg',
      version: '1.1.0',
      previousVersion: '1.0.0',
      revisionRange: 'v1.0.0..HEAD',
      repoUrl: null,
      entries: [{ type: 'added', description: 'New feature' }],
    },
  ],
  commitMessage: 'chore: release 1.1.0',
  tags: ['v1.1.0'],
};

const versionOutputNoChanges: VersionOutput = {
  dryRun: false,
  updates: [],
  changelogs: [],
  tags: [],
};

const mockNotesConfig = { changelog: { mode: 'packages' as const } };
const mockPublishConfig = {
  npm: { enabled: true },
  git: { push: true, pushMethod: 'auto', remote: 'origin', branch: undefined },
};
const mockPublishOutput = {
  dryRun: false,
  git: { committed: true, tags: ['v1.1.0'], pushed: true, branch: 'main' },
  npm: [{ packageName: 'test-pkg', version: '1.1.0', registry: 'npm', success: true, skipped: false }],
  cargo: [],
  verification: [],
  githubReleases: [],
};

describe('runRelease', () => {
  let runRelease: typeof import('../../src/release.js').runRelease;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Default HEAD subject is a non-release commit so the skip-pattern guard passes.
    setGitSubject('feat: some feature');

    // The failure-report resolve path reads the forge's comments; a plain stub keeps it quiet.
    mockForgeFor.mockReturnValue({ findComment: vi.fn().mockResolvedValue(null) });
    mockLoadReleaseKitConfig.mockReturnValue({});
    mockLoadCIConfig.mockReturnValue(undefined);
    mockVersionLoadConfig.mockReturnValue({ preset: 'conventionalcommits' });
    mockVersionEngineGetWorkspacePackages.mockResolvedValue({
      packages: [{ packageJson: { name: 'test-pkg' }, dir: '/test/project' }],
      root: '/test/project',
    });
    mockVersionEngineRun.mockResolvedValue(undefined);
    mockGetJsonData.mockReturnValue(versionOutputWithChanges);
    mockFlushPendingWrites.mockReturnValue([]);
    mockNotesLoadConfig.mockReturnValue(mockNotesConfig);
    mockVersionOutputToChangelogInput.mockReturnValue({ source: 'version', packages: [] });
    mockNotesRunPipeline.mockResolvedValue({
      packageNotes: { 'test-pkg': '## [1.1.0] - 2026-01-01\n\n### Added\n\n- New feature\n' },
      files: [],
    });
    mockPublishLoadConfig.mockReturnValue(mockPublishConfig);
    mockPublishRunPipeline.mockResolvedValue(mockPublishOutput);

    const mod = await import('../../src/release.js');
    runRelease = mod.runRelease;
  });

  it('should run all three steps by default', async () => {
    const result = await runRelease(defaultOptions);

    expect(mockEnableJsonOutput).toHaveBeenCalled();
    expect(mockVersionEngineRun).toHaveBeenCalled();
    expect(mockNotesRunPipeline).toHaveBeenCalled();
    expect(mockPublishRunPipeline).toHaveBeenCalled();
    expect(result).not.toBeNull();
    expect(result?.notesGenerated).toBe(true);
    expect(result?.publishOutput).toEqual(mockPublishOutput);
  });

  it('should set versionOutput.dryRun to false for a real run', async () => {
    const result = await runRelease(defaultOptions);

    expect(result?.versionOutput.dryRun).toBe(false);
  });

  it('should set versionOutput.dryRun to true when dryRun option is true', async () => {
    const result = await runRelease({ ...defaultOptions, dryRun: true });

    expect(result?.versionOutput.dryRun).toBe(true);
  });

  it('should return null when no releasable changes', async () => {
    mockGetJsonData.mockReturnValue(versionOutputNoChanges);

    const result = await runRelease(defaultOptions);

    expect(result).toBeNull();
    expect(mockNotesRunPipeline).not.toHaveBeenCalled();
    expect(mockPublishRunPipeline).not.toHaveBeenCalled();
  });

  describe('deferred writes (flushPendingWrites)', () => {
    it('should flush pending writes for a real run after guards pass', async () => {
      await runRelease(defaultOptions);

      expect(mockFlushPendingWrites).toHaveBeenCalledOnce();
    });

    it('should stage every flushed file in the release commit, with the notes files', async () => {
      mockFlushPendingWrites.mockReturnValue(['/test/project/package.json', '/test/project/Cargo.toml']);
      mockNotesRunPipeline.mockResolvedValue({ packageNotes: {}, files: ['/test/project/CHANGELOG.md'] });

      await runRelease(defaultOptions);

      const publishOptions = vi.mocked(mockPublishRunPipeline).mock.calls[0]?.[2] as { additionalFiles?: string[] };
      expect(publishOptions.additionalFiles).toEqual([
        '/test/project/package.json',
        '/test/project/Cargo.toml',
        '/test/project/CHANGELOG.md',
      ]);
    });

    it('should not flush when dryRun is true', async () => {
      await runRelease({ ...defaultOptions, dryRun: true });

      expect(mockFlushPendingWrites).not.toHaveBeenCalled();
    });

    it('should not flush when there are no releasable changes', async () => {
      mockGetJsonData.mockReturnValue(versionOutputNoChanges);

      await runRelease(defaultOptions);

      expect(mockFlushPendingWrites).not.toHaveBeenCalled();
    });

    it('should not flush when updates < minChanges', async () => {
      mockLoadReleaseKitConfig.mockReturnValue({ release: { ci: { minChanges: 2 } } });

      await runRelease(defaultOptions);

      expect(mockFlushPendingWrites).not.toHaveBeenCalled();
    });
  });

  it('should skip notes when --skip-notes', async () => {
    const result = await runRelease({ ...defaultOptions, skipNotes: true });

    expect(mockNotesRunPipeline).not.toHaveBeenCalled();
    expect(mockPublishRunPipeline).toHaveBeenCalled();
    expect(result?.notesGenerated).toBe(false);
  });

  it('should skip publish when --skip-publish', async () => {
    const result = await runRelease({ ...defaultOptions, skipPublish: true });

    expect(mockNotesRunPipeline).toHaveBeenCalled();
    expect(mockPublishRunPipeline).not.toHaveBeenCalled();
    expect(result?.publishOutput).toBeUndefined();
  });

  it('should skip both notes and publish', async () => {
    const result = await runRelease({ ...defaultOptions, skipNotes: true, skipPublish: true });

    expect(mockNotesRunPipeline).not.toHaveBeenCalled();
    expect(mockPublishRunPipeline).not.toHaveBeenCalled();
    expect(result?.notesGenerated).toBe(false);
    expect(result?.publishOutput).toBeUndefined();
  });

  it('should pass dryRun to enableJsonOutput', async () => {
    await runRelease({ ...defaultOptions, dryRun: true });

    expect(mockEnableJsonOutput).toHaveBeenCalledWith(true);
  });

  it('should pass dryRun to VersionEngine', async () => {
    await runRelease({ ...defaultOptions, dryRun: true });

    const runOptions = MockVersionEngine.mock.calls[0]?.[1];
    expect(runOptions.dryRun).toBe(true);
  });

  it('should pass sync to VersionEngine', async () => {
    await runRelease({ ...defaultOptions, sync: true });

    const runOptions = MockVersionEngine.mock.calls[0]?.[1];
    expect(runOptions.sync).toBe(true);
    expect(mockVersionEngineSetStrategy).toHaveBeenCalledWith('sync');
  });

  it('should pass bump type to VersionEngine', async () => {
    await runRelease({ ...defaultOptions, bump: 'major' });

    const runOptions = MockVersionEngine.mock.calls[0]?.[1];
    expect(runOptions.bump).toBe('major');
  });

  it('should pass prerelease identifier to VersionEngine', async () => {
    await runRelease({ ...defaultOptions, prerelease: 'beta' });

    const runOptions = MockVersionEngine.mock.calls[0]?.[1];
    expect(runOptions.prerelease).toBe('beta');
  });

  it('should pass prerelease: true to VersionEngine when no identifier given', async () => {
    await runRelease({ ...defaultOptions, prerelease: true });

    const runOptions = MockVersionEngine.mock.calls[0]?.[1];
    expect(runOptions.prerelease).toBe(true);
  });

  it('should pass stable to VersionEngine', async () => {
    await runRelease({ ...defaultOptions, stable: true });

    const runOptions = MockVersionEngine.mock.calls[0]?.[1];
    expect(runOptions.stable).toBe(true);
  });

  it('should pass target packages to VersionEngine', async () => {
    await runRelease({ ...defaultOptions, target: '@scope/a, @scope/b' });

    const runOptions = MockVersionEngine.mock.calls[0]?.[1];
    expect(runOptions.targets).toEqual(['@scope/a', '@scope/b']);
  });

  it('should pass combined runOptions to VersionEngine', async () => {
    await runRelease({
      ...defaultOptions,
      bump: 'minor',
      prerelease: 'beta',
      stable: true,
      sync: true,
      dryRun: true,
      target: '@scope/pkg-a',
    });

    const runOptions = MockVersionEngine.mock.calls[0]?.[1];
    expect(runOptions).toEqual({
      bump: 'minor',
      prerelease: 'beta',
      stable: true,
      sync: true,
      dryRun: true,
      targets: ['@scope/pkg-a'],
    });
  });

  it('should use single strategy for one package', async () => {
    mockVersionEngineGetWorkspacePackages.mockResolvedValue({
      packages: [{ packageJson: { name: 'solo-pkg' }, dir: '/test' }],
      root: '/test',
    });

    await runRelease(defaultOptions);

    expect(mockVersionEngineSetStrategy).toHaveBeenCalledWith('single');
  });

  it('should use async strategy for multiple packages', async () => {
    mockVersionEngineGetWorkspacePackages.mockResolvedValue({
      packages: [
        { packageJson: { name: 'pkg-a' }, dir: '/test/a' },
        { packageJson: { name: 'pkg-b' }, dir: '/test/b' },
      ],
      root: '/test',
    });

    await runRelease(defaultOptions);

    expect(mockVersionEngineSetStrategy).toHaveBeenCalledWith('async');
  });

  it('should throw when no packages found', async () => {
    mockVersionEngineGetWorkspacePackages.mockResolvedValue({
      packages: [],
      root: '/test',
    });

    await expect(runRelease(defaultOptions)).rejects.toThrow('No packages found in workspace');
  });

  it('should set branch on publish config when --branch is provided', async () => {
    await runRelease({ ...defaultOptions, branch: 'develop' });

    expect(mockPublishRunPipeline).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ git: expect.objectContaining({ branch: 'develop' }) }),
      expect.anything(),
    );
  });

  it('should not override publish config branch when --branch is not set', async () => {
    mockPublishLoadConfig.mockReturnValue({
      ...mockPublishConfig,
      git: { ...mockPublishConfig.git, branch: 'custom-branch' },
    });

    await runRelease(defaultOptions);

    expect(mockPublishRunPipeline).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ git: expect.objectContaining({ branch: 'custom-branch' }) }),
      expect.anything(),
    );
  });

  it('should pass skipGit to publish options', async () => {
    await runRelease({ ...defaultOptions, skipGit: true });

    expect(mockPublishRunPipeline).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ skipGit: true }),
    );
  });

  it('should pass skipGithubRelease to publish options', async () => {
    await runRelease({ ...defaultOptions, skipGithubRelease: true });

    expect(mockPublishRunPipeline).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ skipGithubRelease: true }),
    );
  });

  it('should pass skipVerification to publish options', async () => {
    await runRelease({ ...defaultOptions, skipVerification: true });

    expect(mockPublishRunPipeline).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ skipVerification: true }),
    );
  });

  it('should pass dryRun to notes pipeline', async () => {
    await runRelease({ ...defaultOptions, dryRun: true });

    expect(mockNotesRunPipeline).toHaveBeenCalledWith(expect.anything(), expect.anything(), true, expect.anything());
  });

  it('should pass version output to notes directly', async () => {
    await runRelease(defaultOptions);

    expect(mockVersionOutputToChangelogInput).toHaveBeenCalledWith(versionOutputWithChanges);
  });

  it('should pass version output to publish pipeline', async () => {
    await runRelease(defaultOptions);

    expect(mockPublishRunPipeline).toHaveBeenCalledWith(versionOutputWithChanges, expect.anything(), expect.anything());
  });

  it('should return version output in result', async () => {
    const result = await runRelease(defaultOptions);

    expect(result?.versionOutput).toEqual(versionOutputWithChanges);
  });

  it('should return packageNotes from the notes step', async () => {
    const result = await runRelease(defaultOptions);

    expect(result?.packageNotes).toEqual({ 'test-pkg': '## [1.1.0] - 2026-01-01\n\n### Added\n\n- New feature\n' });
  });

  it('should return releaseNotes from the notes step when LLM generates them', async () => {
    mockNotesRunPipeline.mockResolvedValueOnce({
      packageNotes: { 'test-pkg': '## [1.1.0] - 2026-01-01\n\n### Added\n\n- New feature\n' },
      releaseNotes: { 'test-pkg': '## Release Notes\n\nThis is the release notes content generated by LLM.' },
      files: [],
    });

    const result = await runRelease(defaultOptions);

    expect(result?.releaseNotes).toEqual({
      'test-pkg': '## Release Notes\n\nThis is the release notes content generated by LLM.',
    });
  });

  it('should not include packageNotes or releaseNotes when notes step is skipped', async () => {
    const result = await runRelease({ ...defaultOptions, skipNotes: true });

    expect(result?.packageNotes).toBeUndefined();
    expect(result?.releaseNotes).toBeUndefined();
  });

  it('should log a friendly error and rethrow when config load fails', async () => {
    const { error: mockError } = await import('@releasekit/core');
    const configErr = new Error('Zod validation: steps must have at least 1 item');
    mockLoadReleaseKitConfig.mockImplementation(() => {
      throw configErr;
    });

    await expect(runRelease(defaultOptions)).rejects.toThrow(configErr);
    expect(mockError).toHaveBeenCalledWith(expect.stringContaining('Failed to load release config'));
  });

  it('should propagate version step errors', async () => {
    mockVersionEngineRun.mockRejectedValue(new Error('git not found'));

    await expect(runRelease(defaultOptions)).rejects.toThrow('git not found');
  });

  it('should propagate notes step errors', async () => {
    mockNotesRunPipeline.mockRejectedValue(new Error('template error'));

    await expect(runRelease(defaultOptions)).rejects.toThrow('template error');
  });

  it('should propagate publish step errors', async () => {
    mockPublishRunPipeline.mockRejectedValue(new Error('npm auth failed'));

    await expect(runRelease(defaultOptions)).rejects.toThrow('npm auth failed');
  });

  describe('release config: skipPatterns', () => {
    it('should return null when HEAD commit matches a skip pattern', async () => {
      setGitSubject('chore(deps): bump some-dep from 1.0.0 to 2.0.0');
      mockLoadReleaseKitConfig.mockReturnValue({ release: { ci: { skipPatterns: ['chore(deps):'] } } });

      const result = await runRelease(defaultOptions);

      expect(result).toBeNull();
      expect(mockVersionEngineRun).not.toHaveBeenCalled();
    });

    it('should continue when HEAD commit does not match any skip pattern', async () => {
      setGitSubject('feat: add new feature');
      mockLoadReleaseKitConfig.mockReturnValue({ release: { ci: { skipPatterns: ['chore(deps):'] } } });

      const result = await runRelease(defaultOptions);

      expect(result).not.toBeNull();
      expect(mockVersionEngineRun).toHaveBeenCalled();
    });

    it('should continue when skipPatterns is empty', async () => {
      mockLoadReleaseKitConfig.mockReturnValue({ release: { ci: { skipPatterns: [] } } });

      const result = await runRelease(defaultOptions);

      expect(result).not.toBeNull();
    });

    it('should continue when git log fails', async () => {
      // getHeadCommitMessage swallows a git failure and returns null → the guard is skipped.
      setGitSubject('feat: ignored');
      vi.spyOn(fakeGit, 'log').mockRejectedValue(new Error('not a git repo'));
      mockLoadReleaseKitConfig.mockReturnValue({ release: { ci: { skipPatterns: ['chore(deps):'] } } });

      const result = await runRelease(defaultOptions);

      expect(result).not.toBeNull();
    });

    it('should pass projectDir as cwd to git log', async () => {
      mockLoadReleaseKitConfig.mockReturnValue({ release: { ci: { skipPatterns: ['chore(deps):'] } } });

      await runRelease({ ...defaultOptions, projectDir: '/custom/project' });

      expect(gitLogSpy).toHaveBeenCalledWith(expect.objectContaining({ format: '%s', cwd: '/custom/project' }));
    });
  });

  describe('release config: steps', () => {
    it('should skip notes when steps omits "notes"', async () => {
      mockLoadReleaseKitConfig.mockReturnValue({ release: { steps: ['publish'] } });

      const result = await runRelease(defaultOptions);

      expect(mockNotesRunPipeline).not.toHaveBeenCalled();
      expect(mockPublishRunPipeline).toHaveBeenCalled();
      expect(result?.notesGenerated).toBe(false);
    });

    it('should skip publish when steps omits "publish"', async () => {
      mockLoadReleaseKitConfig.mockReturnValue({ release: { steps: ['notes'] } });

      await runRelease(defaultOptions);

      expect(mockNotesRunPipeline).toHaveBeenCalled();
      expect(mockPublishRunPipeline).not.toHaveBeenCalled();
    });

    it('should not override CLI --skip-notes with steps config', async () => {
      mockLoadReleaseKitConfig.mockReturnValue({ release: { steps: ['notes', 'publish'] } });

      const result = await runRelease({ ...defaultOptions, skipNotes: true });

      expect(mockNotesRunPipeline).not.toHaveBeenCalled();
      expect(result?.notesGenerated).toBe(false);
    });
  });

  describe('release config: ci overrides beat steps (CLI > ci > steps)', () => {
    it('should disable notes when ci.notes: false even if steps includes "notes"', async () => {
      mockLoadReleaseKitConfig.mockReturnValue({ release: { steps: ['notes', 'publish'], ci: { notes: false } } });

      const result = await runRelease(defaultOptions);

      expect(mockNotesRunPipeline).not.toHaveBeenCalled();
      expect(result?.notesGenerated).toBe(false);
    });
  });

  describe('release config: ci overrides', () => {
    it('should skip notes when ci.notes is false', async () => {
      mockLoadReleaseKitConfig.mockReturnValue({ release: { ci: { notes: false } } });

      const result = await runRelease(defaultOptions);

      expect(mockNotesRunPipeline).not.toHaveBeenCalled();
      expect(result?.notesGenerated).toBe(false);
    });

    it('should skip github release when ci.githubRelease is false', async () => {
      mockLoadReleaseKitConfig.mockReturnValue({ release: { ci: { githubRelease: false } } });

      await runRelease(defaultOptions);

      expect(mockPublishRunPipeline).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.objectContaining({ skipGithubRelease: true }),
      );
    });

    it('should return null when updates < minChanges', async () => {
      mockLoadReleaseKitConfig.mockReturnValue({ release: { ci: { minChanges: 2 } } });
      // versionOutputWithChanges has 1 update

      const result = await runRelease(defaultOptions);

      expect(result).toBeNull();
      expect(mockNotesRunPipeline).not.toHaveBeenCalled();
    });

    it('should continue when updates >= minChanges', async () => {
      mockLoadReleaseKitConfig.mockReturnValue({ release: { ci: { minChanges: 1 } } });

      const result = await runRelease(defaultOptions);

      expect(result).not.toBeNull();
    });
  });

  describe("the gate's decision on the PRs merged since the last release", () => {
    const noTarget: ReleaseOptions = { ...defaultOptions, target: undefined };
    let forge: FakeForge;

    /** Newest first, as `git log` lists them. */
    function merge(...prs: Array<{ number: number; labels: string[]; headRef?: string }>): void {
      fakeGit = new FakeGit({
        nearestTag: 'v1.0.0',
        commits: { 'v1.0.0..HEAD': prs.map((pr) => `sha-${pr.number}\n`).join(''), '*': 'feat: some feature\n' },
      });
      forge = createFakeForge({
        pullRequestsForCommit: Object.fromEntries(
          prs.map((pr) => [`sha-${pr.number}`, [{ number: pr.number, mergedAt: '2026-01-01T00:00:00Z' }]]),
        ),
        issues: Object.fromEntries(
          prs.map((pr) => [pr.number, { body: '', title: '', labels: pr.labels, isPullRequest: true }]),
        ),
        pullRequests: Object.fromEntries(
          prs.flatMap((pr) =>
            pr.headRef ? ([[pr.number, { body: '', labels: pr.labels, headRef: pr.headRef }]] as const) : [],
          ),
        ),
      });
      mockForgeFor.mockReturnValue(forge);
    }

    function versionRunOptions(): {
      bump?: string;
      stable?: boolean;
      prerelease?: string | boolean;
      targets: string[];
    } {
      return MockVersionEngine.mock.calls[0]?.[1];
    }

    async function gate() {
      const { runGate } = await import('../../src/gate/gate.js');
      return runGate({ projectDir: '/test/project', notify: false });
    }

    beforeEach(() => {
      vi.stubEnv('GITHUB_REPOSITORY', 'owner/repo');
      vi.stubEnv('GITHUB_SHA', 'sha-123');
      vi.stubEnv('GITHUB_TOKEN', 'test-token');
      vi.stubEnv('GITHUB_EVENT_NAME', 'push');
    });

    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it('should release from commits without a GitHub context', async () => {
      vi.stubEnv('GITHUB_SHA', undefined);
      merge({ number: 123, labels: ['documentation'] });
      const lookup = vi.spyOn(forge, 'listPullRequestsForCommit');

      const result = await runRelease(noTarget);

      expect(result).not.toBeNull();
      expect(lookup).not.toHaveBeenCalled();
    });

    it('should release from commits on a workflow_dispatch run', async () => {
      vi.stubEnv('GITHUB_EVENT_NAME', 'workflow_dispatch');
      merge({ number: 123, labels: ['documentation'] });
      const lookup = vi.spyOn(forge, 'listPullRequestsForCommit');

      const result = await runRelease(noTarget);

      expect(result).not.toBeNull();
      expect(lookup).not.toHaveBeenCalled();
    });

    it('should release from commits when no PR merged since the last release', async () => {
      merge();

      const result = await runRelease(noTarget);

      expect(result).not.toBeNull();
      expect(versionRunOptions().bump).toBeUndefined();
    });

    it.each([false, true])(
      'should release every changed package for a merged PR with no scope label (dryRun: %s)',
      async (dryRun) => {
        mockLoadCIConfig.mockReturnValue({ releaseTrigger: 'commit' });
        merge({ number: 123, labels: [] });

        const result = await runRelease({ ...noTarget, dryRun });

        expect(result).not.toBeNull();
        expect(versionRunOptions().targets).toEqual([]);
        expect(mockPublishRunPipeline).toHaveBeenCalled();
      },
    );

    it('should release only the scope of a merged PR with a scope label', async () => {
      mockLoadCIConfig.mockReturnValue({ releaseTrigger: 'commit', scopeLabels: { 'scope:core': '@test/core' } });
      merge({ number: 123, labels: ['scope:core'] });

      await runRelease(noTarget);

      expect(versionRunOptions().targets).toEqual(['@test/core']);
    });

    describe('label trigger', () => {
      it('should release with the bump of a bump:minor label', async () => {
        merge({ number: 123, labels: ['bump:minor'] });

        const result = await runRelease(noTarget);

        expect(result).not.toBeNull();
        expect(versionRunOptions()).toMatchObject({ bump: 'minor', stable: false });
      });

      it('should graduate to stable on a release:graduate label', async () => {
        merge({ number: 123, labels: ['release:graduate'] });

        const result = await runRelease(noTarget);

        expect(result).not.toBeNull();
        expect(versionRunOptions()).toMatchObject({ bump: undefined, stable: true });
      });

      it('should not release, and say why, when the merged PR has no release labels', async () => {
        merge({ number: 123, labels: ['documentation'] });

        const result = await runRelease(noTarget);

        expect(result).toBeNull();
        expect(mockVersionEngineRun).not.toHaveBeenCalled();
        expect(info).toHaveBeenCalledWith(expect.stringContaining('No release labels found'));
      });

      it('should not release when the merged PR has conflicting bump labels', async () => {
        merge({ number: 123, labels: ['bump:major', 'bump:minor'] });

        const result = await runRelease(noTarget);

        expect(result).toBeNull();
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('Release blocked'));
      });
    });

    describe('commit trigger', () => {
      beforeEach(() => {
        mockLoadCIConfig.mockReturnValue({ releaseTrigger: 'commit' });
      });

      it('should release an unlabelled merge with the bump its commits give', async () => {
        merge({ number: 123, labels: [] });

        const result = await runRelease(noTarget);

        expect(result).not.toBeNull();
        expect(versionRunOptions().bump).toBeUndefined();
      });

      it('should not release a merge labelled release:skip', async () => {
        merge({ number: 123, labels: ['release:skip'] });

        const result = await runRelease(noTarget);

        expect(result).toBeNull();
        expect(mockVersionEngineRun).not.toHaveBeenCalled();
      });

      it('should graduate to stable on a release:graduate label', async () => {
        merge({ number: 123, labels: ['release:graduate'] });

        const verdict = await gate();
        await runRelease(noTarget);

        expect(verdict.stable).toBe(true);
        expect(versionRunOptions()).toMatchObject({ stable: true });
      });
    });

    describe('standing-pr strategy', () => {
      it.each([
        { trigger: 'label', labels: ['release:immediate'], bump: undefined },
        { trigger: 'commit', labels: ['release:immediate'], bump: undefined },
        { trigger: 'label', labels: ['release:immediate', 'bump:major'], bump: 'major' },
        { trigger: 'commit', labels: ['release:immediate', 'bump:major'], bump: 'major' },
      ])(
        'should release $labels in $trigger mode with bump $bump, as the gate decides',
        async ({ trigger, labels, bump }) => {
          mockLoadCIConfig.mockReturnValue({ releaseStrategy: 'standing-pr', releaseTrigger: trigger });
          merge({ number: 123, labels });

          const verdict = await gate();
          const result = await runRelease(noTarget);

          expect(verdict.shouldRelease).toBe(true);
          expect(verdict.bump).toBe(bump);
          expect(result).not.toBeNull();
          expect(versionRunOptions().bump).toBe(bump);
        },
      );

      it('should not release an immediate PR labelled release:skip in commit mode, as the gate decides', async () => {
        mockLoadCIConfig.mockReturnValue({ releaseStrategy: 'standing-pr', releaseTrigger: 'commit' });
        merge({ number: 123, labels: ['release:immediate', 'release:skip'] });

        const verdict = await gate();
        const result = await runRelease(noTarget);

        expect(verdict.shouldRelease).toBe(false);
        expect(result).toBeNull();
      });

      it.each([
        { trigger: 'label', labels: ['bump:major'] },
        { trigger: 'commit', labels: [] },
      ])(
        'should not release a feeder PR without release:immediate in $trigger mode, as the gate decides',
        async ({ trigger, labels }) => {
          mockLoadCIConfig.mockReturnValue({ releaseStrategy: 'standing-pr', releaseTrigger: trigger });
          merge({ number: 123, labels });

          const verdict = await gate();
          const result = await runRelease(noTarget);

          expect(verdict.shouldRelease).toBe(false);
          expect(result).toBeNull();
        },
      );
    });

    describe('CLI flags', () => {
      beforeEach(() => {
        mockLoadCIConfig.mockReturnValue({ scopeLabels: { 'scope:core': '@test/core' } });
      });

      it('should let --bump and --target override the bump and scope labels', async () => {
        merge({ number: 123, labels: ['bump:minor', 'scope:core'] });

        await runRelease({ ...noTarget, bump: 'patch', target: '@test/other' });

        expect(versionRunOptions()).toMatchObject({ bump: 'patch', targets: ['@test/other'] });
      });

      it('should let --stable replace the bump label', async () => {
        merge({ number: 123, labels: ['bump:minor'] });

        await runRelease({ ...noTarget, stable: true });

        expect(versionRunOptions()).toMatchObject({ bump: undefined, stable: true });
      });

      it('should let --prerelease replace the graduate label', async () => {
        merge({ number: 123, labels: ['release:graduate'] });

        await runRelease({ ...noTarget, prerelease: 'beta' });

        expect(versionRunOptions()).toMatchObject({ prerelease: 'beta', stable: undefined });
      });
    });

    it('should warn naming pull-requests: read, and release from commits, when the PR lookup fails', async () => {
      merge({ number: 123, labels: ['documentation'] });
      vi.spyOn(forge, 'listPullRequestsForCommit').mockRejectedValue(
        new Error('Resource not accessible by integration'),
      );

      const result = await runRelease(noTarget);
      const verdict = await gate();

      expect(warn).toHaveBeenCalledWith(expect.stringContaining('`pull-requests: read`'));
      expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('No merged PRs'));
      expect(result).not.toBeNull();
      expect(verdict).toMatchObject({ shouldRelease: false, reason: expect.stringContaining('`pull-requests: read`') });
    });

    describe('standing-pr: a merged PR carrying the immediate label', () => {
      function mergedStandingPR(headRef: string, standingPr?: { branch: string }) {
        mockLoadCIConfig.mockReturnValue({ releaseStrategy: 'standing-pr', standingPr });
        merge({ number: 42, labels: ['release:immediate', 'bump:minor'], headRef });
      }

      it('should fail rather than re-release the standing PR', async () => {
        mergedStandingPR('release/next');

        await expect(runRelease(noTarget)).rejects.toThrow('PR #42 is the standing release PR');
        expect(mockVersionEngineRun).not.toHaveBeenCalled();
        expect(mockPublishRunPipeline).not.toHaveBeenCalled();
      });

      it('should recognise the standing PR by ci.standingPr.branch', async () => {
        mergedStandingPR('releases/queue', { branch: 'releases/queue' });

        await expect(runRelease(noTarget)).rejects.toThrow('PR #42 is the standing release PR');
        expect(mockPublishRunPipeline).not.toHaveBeenCalled();
      });

      it('should still release a feeder PR', async () => {
        mergedStandingPR('fix/urgent');

        const result = await runRelease(noTarget);

        expect(result).not.toBeNull();
        expect(mockPublishRunPipeline).toHaveBeenCalled();
      });
    });
  });

  describe('feeder-preview stale marking', () => {
    it('should mark feeder previews stale in-process after a successful release', async () => {
      const ciConfig = { prPreview: { enabled: true, markStaleAfterRelease: true } };
      mockLoadCIConfig.mockReturnValue(ciConfig);
      await runRelease(defaultOptions);
      expect(mockMarkFeederPreviewsStale).toHaveBeenCalledWith({ ciConfig, branch: 'main' });
    });

    it('should not mark feeder previews stale when the release branch was not pushed', async () => {
      mockPublishRunPipeline.mockResolvedValue({
        ...mockPublishOutput,
        git: { ...mockPublishOutput.git, branch: undefined },
      });
      await runRelease(defaultOptions);
      expect(mockMarkFeederPreviewsStale).not.toHaveBeenCalled();
    });

    it('should not mark feeder previews stale on a dry run', async () => {
      await runRelease({ ...defaultOptions, dryRun: true });
      expect(mockMarkFeederPreviewsStale).not.toHaveBeenCalled();
    });

    it('should not mark feeder previews stale when publish is skipped', async () => {
      await runRelease({ ...defaultOptions, skipPublish: true });
      expect(mockMarkFeederPreviewsStale).not.toHaveBeenCalled();
    });
  });

  describe('editedNotes (manual-mode draft dispatch)', () => {
    it('should merge editedNotes over generated notes before publish (edited wins per package)', async () => {
      await runRelease({ ...defaultOptions, editedNotes: { 'test-pkg': '- edited by human' } });

      // runPublishStep forwards releaseNotes as the 3rd positional to the publish pipeline.
      const publishOptions = vi.mocked(mockPublishRunPipeline).mock.calls[0]?.[2] as {
        releaseNotes?: Record<string, string>;
      };
      expect(publishOptions.releaseNotes).toMatchObject({ 'test-pkg': '- edited by human' });
    });
  });
});
