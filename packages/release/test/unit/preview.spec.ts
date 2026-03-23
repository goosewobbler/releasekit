import type { VersionOutput } from '@releasekit/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// --- Mocks ---

const mockLoadCIConfig = vi.fn();

vi.mock('@releasekit/config', () => ({
  loadCIConfig: (...args: unknown[]) => mockLoadCIConfig(...args),
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

vi.mock('../../src/preview-github.js', () => ({
  postOrUpdateComment: (...args: unknown[]) => mockPostOrUpdateComment(...args),
  createOctokit: (...args: unknown[]) => mockCreateOctokit(...args),
}));

const mockResolvePreviewContext = vi.fn();

vi.mock('../../src/preview-context.js', () => ({
  resolvePreviewContext: (...args: unknown[]) => mockResolvePreviewContext(...args),
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
    mockRunRelease.mockResolvedValue({
      versionOutput: versionOutputWithChanges,
      notesGenerated: false,
    });
    mockResolvePreviewContext.mockReturnValue(defaultContext);
    mockCreateOctokit.mockReturnValue({});
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
});
