import type { VersionOutput } from '@releasekit/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReleaseOptions } from '../../src/types.js';

// --- Mocks ---

const mockLoadReleaseKitConfig = vi.fn();
const mockLoadCIConfig = vi.fn();
const mockCreateOctokit = vi.fn();
const mockFindMergedPRsForCommit = vi.fn();
const mockFetchPRLabels = vi.fn();

vi.mock('@releasekit/config', () => ({
  loadConfig: (...args: unknown[]) => mockLoadReleaseKitConfig(...args),
  loadCIConfig: (...args: unknown[]) => mockLoadCIConfig(...args),
}));

vi.mock('node:child_process', () => ({
  execSync: vi.fn().mockReturnValue('feat: some feature\n'),
}));

vi.mock('../../src/preview-github.js', () => ({
  createOctokit: (...args: unknown[]) => mockCreateOctokit(...args),
  findMergedPRsForCommit: (...args: unknown[]) => mockFindMergedPRsForCommit(...args),
  fetchPRLabels: (...args: unknown[]) => mockFetchPRLabels(...args),
}));

const mockEnableJsonOutput = vi.fn();
const mockGetJsonData = vi.fn();
const mockFlushPendingWrites = vi.fn();
const mockVersionLoadConfig = vi.fn();
const mockVersionEngineRun = vi.fn();
const mockVersionEngineSetStrategy = vi.fn();
const mockVersionEngineGetWorkspacePackages = vi.fn();

const MockVersionEngine = vi.fn(function (this: Record<string, unknown>) {
  this.run = mockVersionEngineRun;
  this.setStrategy = mockVersionEngineSetStrategy;
  this.getWorkspacePackages = mockVersionEngineGetWorkspacePackages;
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
const mockParseVersionOutput = vi.fn();

vi.mock('@releasekit/notes', () => ({
  runPipeline: (...args: unknown[]) => mockNotesRunPipeline(...args),
  loadConfig: (...args: unknown[]) => mockNotesLoadConfig(...args),
  parseVersionOutput: (...args: unknown[]) => mockParseVersionOutput(...args),
}));

const mockPublishRunPipeline = vi.fn();
const mockPublishLoadConfig = vi.fn();

vi.mock('@releasekit/publish', () => ({
  runPipeline: (...args: unknown[]) => mockPublishRunPipeline(...args),
  loadConfig: (...args: unknown[]) => mockPublishLoadConfig(...args),
}));

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

// --- Fixtures ---

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
  git: { committed: true, tags: ['v1.1.0'], pushed: true },
  npm: [{ packageName: 'test-pkg', version: '1.1.0', registry: 'npm', success: true, skipped: false }],
  cargo: [],
  verification: [],
  githubReleases: [],
};

// --- Tests ---

describe('runRelease', () => {
  let runRelease: typeof import('../../src/release.js').runRelease;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Default mock setup
    mockCreateOctokit.mockReturnValue({});
    mockFindMergedPRsForCommit.mockResolvedValue([]);
    mockFetchPRLabels.mockResolvedValue([]);
    mockLoadReleaseKitConfig.mockReturnValue({});
    mockVersionLoadConfig.mockReturnValue({ preset: 'conventional-commits' });
    mockVersionEngineGetWorkspacePackages.mockResolvedValue({
      packages: [{ packageJson: { name: 'test-pkg' }, dir: '/test/project' }],
      root: '/test/project',
    });
    mockVersionEngineRun.mockResolvedValue(undefined);
    mockGetJsonData.mockReturnValue(versionOutputWithChanges);
    mockNotesLoadConfig.mockReturnValue(mockNotesConfig);
    mockParseVersionOutput.mockReturnValue({ source: 'version', packages: [] });
    mockNotesRunPipeline.mockResolvedValue({
      packageNotes: { 'test-pkg': '## [1.1.0] - 2026-01-01\n\n### Added\n- New feature\n' },
      files: [],
    });
    mockPublishLoadConfig.mockReturnValue(mockPublishConfig);
    mockPublishRunPipeline.mockResolvedValue(mockPublishOutput);

    // Dynamic import to get fresh module
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

  it('should set dryRun on version config', async () => {
    await runRelease({ ...defaultOptions, dryRun: true });

    const config = mockVersionLoadConfig.mock.results[0]?.value;
    expect(config.dryRun).toBe(true);
  });

  it('should set sync on version config', async () => {
    await runRelease({ ...defaultOptions, sync: true });

    const config = mockVersionLoadConfig.mock.results[0]?.value;
    expect(config.sync).toBe(true);
    expect(mockVersionEngineSetStrategy).toHaveBeenCalledWith('sync');
  });

  it('should set bump type on version config', async () => {
    await runRelease({ ...defaultOptions, bump: 'major' });

    const config = mockVersionLoadConfig.mock.results[0]?.value;
    expect(config.type).toBe('major');
  });

  it('should set prerelease identifier on version config', async () => {
    await runRelease({ ...defaultOptions, prerelease: 'beta' });

    const config = mockVersionLoadConfig.mock.results[0]?.value;
    expect(config.prereleaseIdentifier).toBe('beta');
    expect(config.isPrerelease).toBe(true);
  });

  it('should default prerelease identifier to "next"', async () => {
    await runRelease({ ...defaultOptions, prerelease: true });

    const config = mockVersionLoadConfig.mock.results[0]?.value;
    expect(config.prereleaseIdentifier).toBe('next');
  });

  it('should set target packages on version config', async () => {
    await runRelease({ ...defaultOptions, target: '@scope/a, @scope/b' });

    const config = mockVersionLoadConfig.mock.results[0]?.value;
    expect(config.packages).toEqual(['@scope/a', '@scope/b']);
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

    expect(mockNotesRunPipeline).toHaveBeenCalledWith(expect.anything(), expect.anything(), true);
  });

  it('should pass version output to notes as JSON', async () => {
    await runRelease(defaultOptions);

    expect(mockParseVersionOutput).toHaveBeenCalledWith(JSON.stringify(versionOutputWithChanges));
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

    expect(result?.packageNotes).toEqual({ 'test-pkg': '## [1.1.0] - 2026-01-01\n\n### Added\n- New feature\n' });
  });

  it('should return releaseNotes from the notes step when LLM generates them', async () => {
    mockNotesRunPipeline.mockResolvedValueOnce({
      packageNotes: { 'test-pkg': '## [1.1.0] - 2026-01-01\n\n### Added\n- New feature\n' },
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
      const { execSync } = await import('node:child_process');
      vi.mocked(execSync).mockReturnValue('chore(deps): bump some-dep from 1.0.0 to 2.0.0\n' as never);
      mockLoadReleaseKitConfig.mockReturnValue({ release: { ci: { skipPatterns: ['chore(deps):'] } } });

      const result = await runRelease(defaultOptions);

      expect(result).toBeNull();
      expect(mockVersionEngineRun).not.toHaveBeenCalled();
    });

    it('should continue when HEAD commit does not match any skip pattern', async () => {
      const { execSync } = await import('node:child_process');
      vi.mocked(execSync).mockReturnValue('feat: add new feature\n' as never);
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
      const { execSync } = await import('node:child_process');
      vi.mocked(execSync).mockImplementation(() => {
        throw new Error('not a git repo');
      });
      mockLoadReleaseKitConfig.mockReturnValue({ release: { ci: { skipPatterns: ['chore(deps):'] } } });

      const result = await runRelease(defaultOptions);

      expect(result).not.toBeNull();
    });

    it('should pass projectDir as cwd to git log', async () => {
      const { execSync } = await import('node:child_process');
      mockLoadReleaseKitConfig.mockReturnValue({ release: { ci: { skipPatterns: ['chore(deps):'] } } });

      await runRelease({ ...defaultOptions, projectDir: '/custom/project' });

      expect(execSync).toHaveBeenCalledWith(
        'git log -1 --pretty=%s',
        expect.objectContaining({ cwd: '/custom/project' }),
      );
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

  // --- Scope label tests ---

  describe('scope labels', () => {
    const originalEnv = { ...process.env };

    beforeEach(async () => {
      vi.clearAllMocks();

      mockLoadReleaseKitConfig.mockReturnValue({});
      mockVersionLoadConfig.mockReturnValue({ preset: 'conventional-commits' });
      mockVersionEngineGetWorkspacePackages.mockResolvedValue({
        packages: [{ packageJson: { name: 'test-pkg' }, dir: '/test/project' }],
        root: '/test/project',
      });
      mockVersionEngineRun.mockResolvedValue(undefined);
      mockGetJsonData.mockReturnValue(versionOutputWithChanges);
      mockNotesLoadConfig.mockReturnValue(mockNotesConfig);
      mockParseVersionOutput.mockReturnValue({ source: 'version', packages: [] });
      mockNotesRunPipeline.mockResolvedValue({
        packageNotes: { 'test-pkg': '## [1.1.0] - 2026-01-01\n\n### Added\n- New feature\n' },
        files: [],
      });

      process.env.GITHUB_REPOSITORY = 'owner/repo';
      process.env.GITHUB_SHA = 'abc123';
      process.env.GITHUB_TOKEN = 'test-token';
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it('should skip scope labels when no GitHub context', async () => {
      delete process.env.GITHUB_REPOSITORY;
      delete process.env.GITHUB_SHA;
      delete process.env.GITHUB_TOKEN;

      mockLoadCIConfig.mockReturnValue({
        scopeLabels: {
          'scope:shared': '@wdio/native-*',
        },
      });

      const { runRelease } = await import('../../src/release.js');
      const result = await runRelease(defaultOptions);

      expect(mockFindMergedPRsForCommit).not.toHaveBeenCalled();
      expect(result).not.toBeNull();
    });

    it('should not block release when no scopeLabels configured and no conflicts', async () => {
      mockLoadCIConfig.mockReturnValue({});
      mockFindMergedPRsForCommit.mockResolvedValue([123]);
      mockFetchPRLabels.mockResolvedValue(['release:minor']);

      const { runRelease } = await import('../../src/release.js');
      const result = await runRelease(defaultOptions);

      expect(mockFindMergedPRsForCommit).toHaveBeenCalled();
      expect(result).not.toBeNull();
    });

    it('should block release when prerelease + stable conflict detected', async () => {
      mockLoadCIConfig.mockReturnValue({
        scopeLabels: {
          'scope:shared': '@wdio/native-*',
        },
      });
      mockFindMergedPRsForCommit.mockResolvedValue([123]);
      mockFetchPRLabels.mockResolvedValue(['scope:shared', 'release:stable', 'release:prerelease']);

      const { runRelease } = await import('../../src/release.js');
      const result = await runRelease(defaultOptions);

      expect(result).toBeNull();
    });

    it('should block release when multiple bump labels conflict detected in label mode', async () => {
      mockLoadCIConfig.mockReturnValue({
        releaseTrigger: 'label',
        scopeLabels: {
          'scope:shared': '@wdio/native-*',
        },
      });
      mockFindMergedPRsForCommit.mockResolvedValue([123]);
      mockFetchPRLabels.mockResolvedValue(['scope:shared', 'release:major', 'release:minor']);

      const { runRelease } = await import('../../src/release.js');
      const result = await runRelease(defaultOptions);

      expect(result).toBeNull();
    });

    it('should NOT block release when multiple bump labels in commit mode (uses major)', async () => {
      mockLoadCIConfig.mockReturnValue({
        releaseTrigger: 'commit',
      });
      mockFindMergedPRsForCommit.mockResolvedValue([123]);
      mockFetchPRLabels.mockResolvedValue(['release:major', 'release:minor']);

      const { runRelease } = await import('../../src/release.js');
      const result = await runRelease(defaultOptions);

      expect(result).not.toBeNull();
    });
  });
});
