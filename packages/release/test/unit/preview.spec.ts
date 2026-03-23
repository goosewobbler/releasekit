import type { VersionOutput } from '@releasekit/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// --- Mocks ---

const mockLoadCIConfig = vi.fn();
const mockLoadConfig = vi.fn();

vi.mock('@releasekit/config', () => ({
  loadCIConfig: (...args: unknown[]) => mockLoadCIConfig(...args),
  loadConfig: (...args: unknown[]) => mockLoadConfig(...args),
}));

vi.mock('@releasekit/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@releasekit/core')>();
  return {
    ...actual,
    info: vi.fn(),
    success: vi.fn(),
    warn: vi.fn(),
    setLogLevel: vi.fn(),
    setQuietMode: vi.fn(),
    setJsonMode: vi.fn(),
  };
});

const mockRunRelease = vi.fn();

vi.mock('../../src/release.js', () => ({
  runRelease: (...args: unknown[]) => mockRunRelease(...args),
}));

const mockPostOrUpdateComment = vi.fn();
const mockCreateOctokit = vi.fn();
const mockFetchPRLabels = vi.fn();

vi.mock('../../src/preview-github.js', () => ({
  postOrUpdateComment: (...args: unknown[]) => mockPostOrUpdateComment(...args),
  createOctokit: (...args: unknown[]) => mockCreateOctokit(...args),
  fetchPRLabels: (...args: unknown[]) => mockFetchPRLabels(...args),
}));

const mockResolvePreviewContext = vi.fn();

vi.mock('../../src/preview-context.js', () => ({
  resolvePreviewContext: (...args: unknown[]) => mockResolvePreviewContext(...args),
}));

const mockDetectPrerelease = vi.fn();

vi.mock('../../src/preview-detect.js', () => ({
  detectPrerelease: (...args: unknown[]) => mockDetectPrerelease(...args),
}));

// --- Fixtures ---

const versionOutputWithChanges: VersionOutput = {
  dryRun: true,
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

const defaultContext = {
  prNumber: 1,
  owner: 'owner',
  repo: 'repo',
  token: 'test-token',
};

// --- Tests ---

describe('runPreview', () => {
  let runPreview: typeof import('../../src/preview.js').runPreview;

  beforeEach(async () => {
    vi.clearAllMocks();

    mockLoadCIConfig.mockReturnValue(undefined);
    mockLoadConfig.mockReturnValue({});
    mockDetectPrerelease.mockReturnValue({ isPrerelease: false });
    mockRunRelease.mockResolvedValue({
      versionOutput: versionOutputWithChanges,
      notesGenerated: false,
    });
    mockResolvePreviewContext.mockReturnValue(defaultContext);
    mockCreateOctokit.mockReturnValue({});
    mockFetchPRLabels.mockResolvedValue([]);
    mockPostOrUpdateComment.mockResolvedValue(undefined);

    const mod = await import('../../src/preview.js');
    runPreview = mod.runPreview;
  });

  it('runs release dry-run and posts comment', async () => {
    await runPreview({ projectDir: '/test', dryRun: false });

    expect(mockRunRelease).toHaveBeenCalledWith(
      expect.objectContaining({
        dryRun: true,
        skipNotes: true,
        skipPublish: true,
        skipGit: true,
        quiet: true,
      }),
    );
    expect(mockPostOrUpdateComment).toHaveBeenCalled();
  });

  it('skips when CI config disables preview', async () => {
    mockLoadCIConfig.mockReturnValue({ prPreview: false });

    await runPreview({ projectDir: '/test', dryRun: false });

    expect(mockRunRelease).not.toHaveBeenCalled();
    expect(mockPostOrUpdateComment).not.toHaveBeenCalled();
  });

  it('runs when CI config enables preview', async () => {
    mockLoadCIConfig.mockReturnValue({ prPreview: true });

    await runPreview({ projectDir: '/test', dryRun: false });

    expect(mockRunRelease).toHaveBeenCalled();
  });

  it('prints to stdout in dry-run mode instead of posting', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await runPreview({ projectDir: '/test', dryRun: true });

    expect(consoleSpy).toHaveBeenCalled();
    const output = consoleSpy.mock.calls[0]?.[0] as string;
    expect(output).toContain('<!-- releasekit-preview -->');
    expect(mockPostOrUpdateComment).not.toHaveBeenCalled();

    consoleSpy.mockRestore();
  });

  it('handles no releasable changes gracefully', async () => {
    mockRunRelease.mockResolvedValue(null);

    await runPreview({ projectDir: '/test', dryRun: false });

    expect(mockPostOrUpdateComment).toHaveBeenCalledWith(
      expect.anything(),
      'owner',
      'repo',
      1,
      expect.stringContaining('No releasable changes detected'),
    );
  });

  it('falls back to stdout when context resolution fails', async () => {
    mockResolvePreviewContext.mockImplementation(() => {
      throw new Error('No GITHUB_TOKEN');
    });
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await runPreview({ projectDir: '/test', dryRun: false });

    expect(consoleSpy).toHaveBeenCalled();
    expect(mockPostOrUpdateComment).not.toHaveBeenCalled();

    consoleSpy.mockRestore();
  });

  it('passes config and projectDir options through', async () => {
    await runPreview({
      config: '/custom/config.json',
      projectDir: '/my/project',
      dryRun: false,
    });

    expect(mockLoadCIConfig).toHaveBeenCalledWith({
      cwd: '/my/project',
      configPath: '/custom/config.json',
    });
    expect(mockRunRelease).toHaveBeenCalledWith(
      expect.objectContaining({
        config: '/custom/config.json',
        projectDir: '/my/project',
      }),
    );
  });

  it('passes pr and repo flags to context resolution', async () => {
    await runPreview({ projectDir: '/test', dryRun: false, pr: '42', repo: 'org/lib' });

    expect(mockResolvePreviewContext).toHaveBeenCalledWith({ pr: '42', repo: 'org/lib' });
  });

  // --- Prerelease detection tests ---

  it('auto-detects prerelease and passes to runRelease', async () => {
    mockDetectPrerelease.mockReturnValue({ isPrerelease: true, identifier: 'next' });

    await runPreview({ projectDir: '/test', dryRun: false });

    expect(mockRunRelease).toHaveBeenCalledWith(expect.objectContaining({ prerelease: 'next' }));
  });

  it('does not set prerelease when versions are stable', async () => {
    mockDetectPrerelease.mockReturnValue({ isPrerelease: false });

    await runPreview({ projectDir: '/test', dryRun: false });

    expect(mockRunRelease).toHaveBeenCalledWith(expect.objectContaining({ prerelease: undefined }));
  });

  it('--stable flag overrides auto-detection', async () => {
    mockDetectPrerelease.mockReturnValue({ isPrerelease: true, identifier: 'next' });

    await runPreview({ projectDir: '/test', dryRun: false, stable: true });

    expect(mockRunRelease).toHaveBeenCalledWith(expect.objectContaining({ prerelease: undefined }));
  });

  it('--prerelease flag overrides auto-detection', async () => {
    mockDetectPrerelease.mockReturnValue({ isPrerelease: false });

    await runPreview({ projectDir: '/test', dryRun: false, prerelease: 'beta' });

    expect(mockRunRelease).toHaveBeenCalledWith(expect.objectContaining({ prerelease: 'beta' }));
  });

  it('passes package paths from config to detectPrerelease', async () => {
    mockLoadConfig.mockReturnValue({ version: { packages: ['packages/a', 'packages/b'] } });

    await runPreview({ projectDir: '/test', dryRun: false });

    expect(mockDetectPrerelease).toHaveBeenCalledWith(['packages/a', 'packages/b'], '/test');
  });

  it('defaults to empty package paths when no version config', async () => {
    mockLoadConfig.mockReturnValue({});

    await runPreview({ projectDir: '/test', dryRun: false });

    expect(mockDetectPrerelease).toHaveBeenCalledWith([], '/test');
  });

  // --- Release strategy tests ---

  it('uses manual strategy messaging by default (no CI config)', async () => {
    mockLoadCIConfig.mockReturnValue(undefined);

    await runPreview({ projectDir: '/test', dryRun: false });

    expect(mockPostOrUpdateComment).toHaveBeenCalledWith(
      expect.anything(),
      'owner',
      'repo',
      1,
      expect.stringContaining('If released, this PR would include:'),
    );
  });

  it('uses direct strategy messaging when configured', async () => {
    mockLoadCIConfig.mockReturnValue({ releaseStrategy: 'direct' });

    await runPreview({ projectDir: '/test', dryRun: false });

    expect(mockPostOrUpdateComment).toHaveBeenCalledWith(
      expect.anything(),
      'owner',
      'repo',
      1,
      expect.stringContaining('This PR will trigger the following release when merged:'),
    );
  });

  it('uses manual strategy messaging when explicitly configured', async () => {
    mockLoadCIConfig.mockReturnValue({ releaseStrategy: 'manual' });

    await runPreview({ projectDir: '/test', dryRun: false });

    expect(mockPostOrUpdateComment).toHaveBeenCalledWith(
      expect.anything(),
      'owner',
      'repo',
      1,
      expect.stringContaining('If released, this PR would include:'),
    );
  });

  it('uses scheduled strategy no-changes message', async () => {
    mockLoadCIConfig.mockReturnValue({ releaseStrategy: 'scheduled' });
    mockRunRelease.mockResolvedValue(null);

    await runPreview({ projectDir: '/test', dryRun: false });

    expect(mockPostOrUpdateComment).toHaveBeenCalledWith(
      expect.anything(),
      'owner',
      'repo',
      1,
      expect.stringContaining('will not be included in the next scheduled release'),
    );
  });

  // --- PR label override tests ---

  it('applies stable label override from PR labels', async () => {
    mockDetectPrerelease.mockReturnValue({ isPrerelease: true, identifier: 'next' });
    mockFetchPRLabels.mockResolvedValue(['release:stable', 'bug']);

    await runPreview({ projectDir: '/test', dryRun: false });

    // stable label means no prerelease flag
    expect(mockRunRelease).toHaveBeenCalledWith(expect.objectContaining({ prerelease: undefined }));
  });

  it('applies prerelease label override from PR labels', async () => {
    mockDetectPrerelease.mockReturnValue({ isPrerelease: false });
    mockFetchPRLabels.mockResolvedValue(['release:prerelease']);

    await runPreview({ projectDir: '/test', dryRun: false });

    expect(mockRunRelease).toHaveBeenCalledWith(expect.objectContaining({ prerelease: true }));
  });

  it('uses custom label names from CI config', async () => {
    mockLoadCIConfig.mockReturnValue({
      labels: { stable: 'grad', prerelease: 'pre', skip: 'skip', major: 'major' },
    });
    mockDetectPrerelease.mockReturnValue({ isPrerelease: true, identifier: 'next' });
    mockFetchPRLabels.mockResolvedValue(['grad']);

    await runPreview({ projectDir: '/test', dryRun: false });

    expect(mockRunRelease).toHaveBeenCalledWith(expect.objectContaining({ prerelease: undefined }));
  });

  it('CLI --stable flag takes priority over PR labels', async () => {
    mockFetchPRLabels.mockResolvedValue(['release:prerelease']);
    mockDetectPrerelease.mockReturnValue({ isPrerelease: false });

    await runPreview({ projectDir: '/test', dryRun: false, stable: true });

    expect(mockRunRelease).toHaveBeenCalledWith(expect.objectContaining({ prerelease: undefined }));
    // Should not even fetch labels when CLI flag is set
    expect(mockFetchPRLabels).not.toHaveBeenCalled();
  });

  it('CLI --prerelease flag takes priority over PR labels', async () => {
    mockFetchPRLabels.mockResolvedValue(['release:stable']);

    await runPreview({ projectDir: '/test', dryRun: false, prerelease: 'beta' });

    expect(mockRunRelease).toHaveBeenCalledWith(expect.objectContaining({ prerelease: 'beta' }));
    expect(mockFetchPRLabels).not.toHaveBeenCalled();
  });

  it('skips label fetch in dry-run mode', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await runPreview({ projectDir: '/test', dryRun: true });

    expect(mockFetchPRLabels).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it('gracefully handles label fetch failure', async () => {
    mockFetchPRLabels.mockRejectedValue(new Error('API rate limit'));
    mockDetectPrerelease.mockReturnValue({ isPrerelease: false });

    await runPreview({ projectDir: '/test', dryRun: false });

    // Should still complete successfully
    expect(mockRunRelease).toHaveBeenCalled();
    expect(mockPostOrUpdateComment).toHaveBeenCalled();
  });
});
