import type { VersionOutput } from '@releasekit/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReleaseOptions } from '../../src/types.js';

// --- Mocks ---

const mockEnableJsonOutput = vi.fn();
const mockGetJsonData = vi.fn();
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
  getJsonData: () => mockGetJsonData(),
  loadConfig: (...args: unknown[]) => mockVersionLoadConfig(...args),
  VersionEngine: MockVersionEngine,
}));

const mockNotesRunPipeline = vi.fn();
const mockNotesLoadConfig = vi.fn();
const mockNotesGetDefaultConfig = vi.fn();
const mockParsePackageVersioner = vi.fn();

vi.mock('@releasekit/notes', () => ({
  runPipeline: (...args: unknown[]) => mockNotesRunPipeline(...args),
  loadConfig: (...args: unknown[]) => mockNotesLoadConfig(...args),
  getDefaultConfig: () => mockNotesGetDefaultConfig(),
  parsePackageVersioner: (...args: unknown[]) => mockParsePackageVersioner(...args),
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
    info: vi.fn(),
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
  commitMessage: 'chore(release): 1.1.0',
  tags: ['v1.1.0'],
};

const versionOutputNoChanges: VersionOutput = {
  dryRun: false,
  updates: [],
  changelogs: [],
  tags: [],
};

const mockNotesConfig = { output: [{ format: 'markdown' as const, file: 'CHANGELOG.md' }] };
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
    mockVersionLoadConfig.mockReturnValue({ preset: 'conventional-commits' });
    mockVersionEngineGetWorkspacePackages.mockResolvedValue({
      packages: [{ packageJson: { name: 'test-pkg' }, dir: '/test/project' }],
      root: '/test/project',
    });
    mockVersionEngineRun.mockResolvedValue(undefined);
    mockGetJsonData.mockReturnValue(versionOutputWithChanges);
    mockNotesLoadConfig.mockReturnValue(mockNotesConfig);
    mockNotesGetDefaultConfig.mockReturnValue({ output: [{ format: 'markdown', file: 'CHANGELOG.md' }] });
    mockParsePackageVersioner.mockReturnValue({ source: 'package-versioner', packages: [] });
    mockNotesRunPipeline.mockResolvedValue({ packageNotes: {}, files: [] });
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

  it('should return null when no releasable changes', async () => {
    mockGetJsonData.mockReturnValue(versionOutputNoChanges);

    const result = await runRelease(defaultOptions);

    expect(result).toBeNull();
    expect(mockNotesRunPipeline).not.toHaveBeenCalled();
    expect(mockPublishRunPipeline).not.toHaveBeenCalled();
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

  it('should use default notes output when config has none', async () => {
    mockNotesLoadConfig.mockReturnValue({ output: [] });

    await runRelease(defaultOptions);

    expect(mockNotesGetDefaultConfig).toHaveBeenCalled();
  });

  it('should pass version output to notes as JSON', async () => {
    await runRelease(defaultOptions);

    expect(mockParsePackageVersioner).toHaveBeenCalledWith(JSON.stringify(versionOutputWithChanges));
  });

  it('should pass version output to publish pipeline', async () => {
    await runRelease(defaultOptions);

    expect(mockPublishRunPipeline).toHaveBeenCalledWith(versionOutputWithChanges, expect.anything(), expect.anything());
  });

  it('should return version output in result', async () => {
    const result = await runRelease(defaultOptions);

    expect(result?.versionOutput).toEqual(versionOutputWithChanges);
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
});
