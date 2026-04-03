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
  commitMessage: 'chore: release 1.1.0',
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

    mockLoadCIConfig.mockReturnValue({ releaseTrigger: 'commit' });
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
    mockLoadCIConfig.mockReturnValue({ prPreview: true, releaseTrigger: 'commit' });

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

  it('uses direct strategy messaging by default (no CI config)', async () => {
    mockLoadCIConfig.mockReturnValue({ releaseTrigger: 'commit' });

    await runPreview({ projectDir: '/test', dryRun: false });

    expect(mockPostOrUpdateComment).toHaveBeenCalledWith(
      expect.anything(),
      'owner',
      'repo',
      1,
      expect.stringContaining('This PR will trigger the following release when merged:'),
    );
  });

  it('uses direct strategy messaging when configured', async () => {
    mockLoadCIConfig.mockReturnValue({ releaseStrategy: 'direct', releaseTrigger: 'commit' });

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
    mockLoadCIConfig.mockReturnValue({ releaseStrategy: 'manual', releaseTrigger: 'commit' });

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
    mockLoadCIConfig.mockReturnValue({ releaseStrategy: 'scheduled', releaseTrigger: 'commit' });
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

  // --- PR label override tests (commit mode) ---

  it('applies stable label override from PR labels', async () => {
    mockDetectPrerelease.mockReturnValue({ isPrerelease: true, identifier: 'next' });
    mockFetchPRLabels.mockResolvedValue(['release:stable', 'bug']);

    await runPreview({ projectDir: '/test', dryRun: false });

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
      releaseTrigger: 'commit',
      labels: {
        stable: 'grad',
        prerelease: 'pre',
        skip: 'skip',
        major: 'major',
        minor: 'minor',
        patch: 'patch',
      },
    });
    mockDetectPrerelease.mockReturnValue({ isPrerelease: true, identifier: 'next' });
    mockFetchPRLabels.mockResolvedValue(['grad']);

    await runPreview({ projectDir: '/test', dryRun: false });

    expect(mockRunRelease).toHaveBeenCalledWith(expect.objectContaining({ prerelease: undefined }));
  });

  it('CLI --stable flag takes priority over prerelease PR label', async () => {
    mockFetchPRLabels.mockResolvedValue(['release:prerelease']);
    mockDetectPrerelease.mockReturnValue({ isPrerelease: false });

    await runPreview({ projectDir: '/test', dryRun: false, stable: true });

    expect(mockRunRelease).toHaveBeenCalledWith(expect.objectContaining({ prerelease: undefined }));
  });

  it('CLI --prerelease flag takes priority over stable PR label', async () => {
    mockFetchPRLabels.mockResolvedValue(['release:stable']);

    await runPreview({ projectDir: '/test', dryRun: false, prerelease: 'beta' });

    expect(mockRunRelease).toHaveBeenCalledWith(expect.objectContaining({ prerelease: 'beta' }));
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

    expect(mockRunRelease).toHaveBeenCalled();
    expect(mockPostOrUpdateComment).toHaveBeenCalled();
  });

  // --- Commit mode: skip and major labels ---

  it('skip label shows skip banner in commit mode', async () => {
    mockLoadCIConfig.mockReturnValue({ releaseTrigger: 'commit' });
    mockFetchPRLabels.mockResolvedValue(['release:skip']);

    await runPreview({ projectDir: '/test', dryRun: false });

    // Still runs dry-run to show what would release
    expect(mockRunRelease).toHaveBeenCalled();
    expect(mockPostOrUpdateComment).toHaveBeenCalledWith(
      expect.anything(),
      'owner',
      'repo',
      1,
      expect.stringContaining('marked to skip release'),
    );
  });

  it('major label forces major bump in commit mode', async () => {
    mockFetchPRLabels.mockResolvedValue(['release:major']);

    await runPreview({ projectDir: '/test', dryRun: false });

    expect(mockRunRelease).toHaveBeenCalledWith(expect.objectContaining({ bump: 'major' }));
    expect(mockPostOrUpdateComment).toHaveBeenCalledWith(
      expect.anything(),
      'owner',
      'repo',
      1,
      expect.stringContaining('labeled for a **major** release'),
    );
  });

  it('skip label takes priority over major label in commit mode', async () => {
    mockLoadCIConfig.mockReturnValue({ releaseTrigger: 'commit' });
    mockFetchPRLabels.mockResolvedValue(['release:skip', 'release:major']);

    await runPreview({ projectDir: '/test', dryRun: false });

    expect(mockRunRelease).toHaveBeenCalledWith(expect.objectContaining({ bump: undefined }));
    expect(mockPostOrUpdateComment).toHaveBeenCalledWith(
      expect.anything(),
      'owner',
      'repo',
      1,
      expect.stringContaining('marked to skip release'),
    );
  });

  it('major and prerelease labels compose in commit mode', async () => {
    mockDetectPrerelease.mockReturnValue({ isPrerelease: false });
    mockFetchPRLabels.mockResolvedValue(['release:major', 'release:prerelease']);

    await runPreview({ projectDir: '/test', dryRun: false });

    expect(mockRunRelease).toHaveBeenCalledWith(expect.objectContaining({ bump: 'major', prerelease: true }));
  });

  // --- Label trigger mode ---

  it('posts "no label" comment without running release analysis when no bump label in label mode', async () => {
    mockLoadCIConfig.mockReturnValue({ releaseTrigger: 'label' });
    mockFetchPRLabels.mockResolvedValue([]);

    await runPreview({ projectDir: '/test', dryRun: false });

    expect(mockRunRelease).not.toHaveBeenCalled();
    expect(mockPostOrUpdateComment).toHaveBeenCalledWith(
      expect.anything(),
      'owner',
      'repo',
      1,
      expect.stringContaining('No release label detected'),
    );
  });

  it('release:patch label triggers patch preview in label mode', async () => {
    mockLoadCIConfig.mockReturnValue({ releaseTrigger: 'label' });
    mockFetchPRLabels.mockResolvedValue(['release:patch']);

    await runPreview({ projectDir: '/test', dryRun: false });

    expect(mockRunRelease).toHaveBeenCalledWith(expect.objectContaining({ bump: 'patch' }));
  });

  it('release:minor label triggers minor preview in label mode', async () => {
    mockLoadCIConfig.mockReturnValue({ releaseTrigger: 'label' });
    mockFetchPRLabels.mockResolvedValue(['release:minor']);

    await runPreview({ projectDir: '/test', dryRun: false });

    expect(mockRunRelease).toHaveBeenCalledWith(expect.objectContaining({ bump: 'minor' }));
  });

  it('release:major label triggers major preview in label mode', async () => {
    mockLoadCIConfig.mockReturnValue({ releaseTrigger: 'label' });
    mockFetchPRLabels.mockResolvedValue(['release:major']);

    await runPreview({ projectDir: '/test', dryRun: false });

    expect(mockRunRelease).toHaveBeenCalledWith(expect.objectContaining({ bump: 'major' }));
  });

  it('highest bump label wins when multiple present in label mode', async () => {
    mockLoadCIConfig.mockReturnValue({ releaseTrigger: 'label' });
    mockFetchPRLabels.mockResolvedValue(['release:patch', 'release:major']);

    await runPreview({ projectDir: '/test', dryRun: false });

    expect(mockRunRelease).toHaveBeenCalledWith(expect.objectContaining({ bump: 'major' }));
  });

  it('bump label and prerelease label compose in label mode', async () => {
    mockLoadCIConfig.mockReturnValue({ releaseTrigger: 'label' });
    mockDetectPrerelease.mockReturnValue({ isPrerelease: false });
    mockFetchPRLabels.mockResolvedValue(['release:minor', 'release:prerelease']);

    await runPreview({ projectDir: '/test', dryRun: false });

    expect(mockRunRelease).toHaveBeenCalledWith(expect.objectContaining({ bump: 'minor', prerelease: true }));
  });

  it('skip label is ignored in label mode', async () => {
    mockLoadCIConfig.mockReturnValue({ releaseTrigger: 'label' });
    mockFetchPRLabels.mockResolvedValue(['release:skip', 'release:minor']);

    await runPreview({ projectDir: '/test', dryRun: false });

    // skip is irrelevant — minor label triggers the release
    expect(mockRunRelease).toHaveBeenCalledWith(expect.objectContaining({ bump: 'minor' }));
  });

  it('prints "no label" comment to stdout in dry-run mode with label trigger', async () => {
    mockLoadCIConfig.mockReturnValue({ releaseTrigger: 'label' });
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await runPreview({ projectDir: '/test', dryRun: true });

    expect(mockRunRelease).not.toHaveBeenCalled();
    expect(mockPostOrUpdateComment).not.toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalled();
    const output = consoleSpy.mock.calls[0]?.[0] as string;
    expect(output).toContain('<!-- releasekit-preview -->');
    expect(output).toContain('No release label detected');

    consoleSpy.mockRestore();
  });

  it('uses custom label names in label mode', async () => {
    mockLoadCIConfig.mockReturnValue({
      releaseTrigger: 'label',
      labels: {
        stable: 'grad',
        prerelease: 'pre',
        skip: 'skip',
        major: 'bump:major',
        minor: 'bump:minor',
        patch: 'bump:patch',
      },
    });
    mockFetchPRLabels.mockResolvedValue(['bump:minor']);

    await runPreview({ projectDir: '/test', dryRun: false });

    expect(mockRunRelease).toHaveBeenCalledWith(expect.objectContaining({ bump: 'minor' }));
  });

  it('CLI --bump flag is passed through to runRelease', async () => {
    await runPreview({ projectDir: '/test', dryRun: false, bump: 'patch' });

    expect(mockRunRelease).toHaveBeenCalledWith(expect.objectContaining({ bump: 'patch' }));
  });

  it('--bump overrides noBumpLabel in dry-run + label-trigger mode', async () => {
    mockLoadCIConfig.mockReturnValue({ releaseTrigger: 'label' });
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await runPreview({ projectDir: '/test', dryRun: true, bump: 'minor' });

    // Version analysis should run because --bump was explicitly supplied
    expect(mockRunRelease).toHaveBeenCalledWith(expect.objectContaining({ bump: 'minor' }));
    expect(consoleSpy).toHaveBeenCalled();

    consoleSpy.mockRestore();
  });

  // --- Scope label tests ---

  it('applies scope label to filter packages in commit mode', async () => {
    mockLoadCIConfig.mockReturnValue({
      releaseTrigger: 'commit',
      scopeLabels: {
        'scope:shared': '@wdio/native-*',
        'scope:tauri': '@wdio/tauri-*',
      },
    });
    mockFetchPRLabels.mockResolvedValue(['scope:shared']);

    await runPreview({ projectDir: '/test', dryRun: false });

    expect(mockRunRelease).toHaveBeenCalledWith(expect.objectContaining({ target: '@wdio/native-*' }));
    expect(mockPostOrUpdateComment).toHaveBeenCalledWith(
      expect.anything(),
      'owner',
      'repo',
      1,
      expect.stringContaining('**Scope:**'),
    );
  });

  it('applies scope label in label mode without requiring release label', async () => {
    mockLoadCIConfig.mockReturnValue({
      releaseTrigger: 'label',
      scopeLabels: {
        'scope:shared': '@wdio/native-*',
      },
    });
    mockFetchPRLabels.mockResolvedValue(['scope:shared']);

    await runPreview({ projectDir: '/test', dryRun: false });

    // Should run release analysis because scope label is present (even without release label)
    expect(mockRunRelease).toHaveBeenCalled();
    expect(mockRunRelease).toHaveBeenCalledWith(expect.objectContaining({ target: '@wdio/native-*' }));
  });

  it('combines multiple scope labels with OR logic', async () => {
    mockLoadCIConfig.mockReturnValue({
      releaseTrigger: 'commit',
      scopeLabels: {
        'scope:shared': '@wdio/native-*',
        'scope:tauri': '@wdio/tauri-*',
      },
    });
    mockFetchPRLabels.mockResolvedValue(['scope:shared', 'scope:tauri']);

    await runPreview({ projectDir: '/test', dryRun: false });

    // Should include both patterns
    expect(mockRunRelease).toHaveBeenCalledWith(expect.objectContaining({ target: '@wdio/native-*, @wdio/tauri-*' }));
  });

  it('combines scope label with release label', async () => {
    mockLoadCIConfig.mockReturnValue({
      releaseTrigger: 'label',
      scopeLabels: {
        'scope:shared': '@wdio/native-*',
      },
    });
    mockFetchPRLabels.mockResolvedValue(['scope:shared', 'release:minor']);

    await runPreview({ projectDir: '/test', dryRun: false });

    expect(mockRunRelease).toHaveBeenCalledWith(expect.objectContaining({ target: '@wdio/native-*', bump: 'minor' }));
  });

  it('scope label without release label uses conventional commits in label mode', async () => {
    mockLoadCIConfig.mockReturnValue({
      releaseTrigger: 'label',
      scopeLabels: {
        'scope:shared': '@wdio/native-*',
      },
    });
    mockFetchPRLabels.mockResolvedValue(['scope:shared']);

    await runPreview({ projectDir: '/test', dryRun: false });

    // Should run release analysis but not set bump (let conventional commits decide)
    expect(mockRunRelease).toHaveBeenCalled();
    expect(mockRunRelease).toHaveBeenCalledWith(expect.objectContaining({ target: '@wdio/native-*', bump: undefined }));
  });

  it('CLI --target flag is replaced by scope labels', async () => {
    mockLoadCIConfig.mockReturnValue({
      releaseTrigger: 'commit',
      scopeLabels: {
        'scope:shared': '@wdio/native-*',
      },
    });
    mockFetchPRLabels.mockResolvedValue(['scope:shared']);

    await runPreview({ projectDir: '/test', dryRun: false, target: '@custom/pkg' });

    // Scope labels replace CLI target
    expect(mockRunRelease).toHaveBeenCalledWith(expect.objectContaining({ target: '@wdio/native-*' }));
  });

  it('displays scope in preview comment banner', async () => {
    mockLoadCIConfig.mockReturnValue({
      releaseTrigger: 'commit',
      scopeLabels: {
        'scope:shared': '@wdio/native-*',
      },
    });
    mockFetchPRLabels.mockResolvedValue(['scope:shared']);

    await runPreview({ projectDir: '/test', dryRun: false });

    expect(mockPostOrUpdateComment).toHaveBeenCalledWith(
      expect.anything(),
      'owner',
      'repo',
      1,
      expect.stringContaining('**Scope:** @wdio/native-*'),
    );
  });

  it('uses custom scope label names from CI config', async () => {
    mockLoadCIConfig.mockReturnValue({
      releaseTrigger: 'commit',
      scopeLabels: {
        'shared-pkg': '@wdio/native-*',
      },
    });
    mockFetchPRLabels.mockResolvedValue(['shared-pkg']);

    await runPreview({ projectDir: '/test', dryRun: false });

    expect(mockRunRelease).toHaveBeenCalledWith(expect.objectContaining({ target: '@wdio/native-*' }));
  });

  it('no scope label runs all packages', async () => {
    mockLoadCIConfig.mockReturnValue({
      releaseTrigger: 'commit',
      scopeLabels: {
        'scope:shared': '@wdio/native-*',
      },
    });
    mockFetchPRLabels.mockResolvedValue(['bug']);

    await runPreview({ projectDir: '/test', dryRun: false });

    // When no scope label present, target should not be set to a scope pattern
    expect(mockRunRelease).toHaveBeenCalled();
    const callArgs = mockRunRelease.mock.calls[0][0];
    // Target should be undefined or not contain scope patterns
    expect(callArgs.target).toBeUndefined();
  });
});
