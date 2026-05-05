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

vi.mock('../../src/github.js', () => ({
  MARKER: '<!-- releasekit-preview -->',
  postOrUpdateComment: (...args: unknown[]) => mockPostOrUpdateComment(...args),
  createOctokit: (...args: unknown[]) => mockCreateOctokit(...args),
  fetchPRLabels: (...args: unknown[]) => mockFetchPRLabels(...args),
}));

const mockResolvePreviewContext = vi.fn();

vi.mock('../../src/preview/context.js', () => ({
  resolvePreviewContext: (...args: unknown[]) => mockResolvePreviewContext(...args),
}));

const mockDetectPrerelease = vi.fn();

vi.mock('../../src/preview/detect.js', () => ({
  detectPrerelease: (...args: unknown[]) => mockDetectPrerelease(...args),
}));

const mockFetchStandingPRSnapshot = vi.fn();

vi.mock('../../src/standing-pr/standing-pr.js', () => ({
  fetchStandingPRSnapshot: (...args: unknown[]) => mockFetchStandingPRSnapshot(...args),
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
  let runPreview: typeof import('../../src/preview/preview.js').runPreview;

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
    mockFetchStandingPRSnapshot.mockResolvedValue(null);

    const mod = await import('../../src/preview/preview.js');
    runPreview = mod.runPreview;
  });

  describe('basic functionality', () => {
    it('should run release dry-run and post comment', async () => {
      await runPreview({ projectDir: '/test', dryRun: false, target: '@test/package' });

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

    it('should skip when CI config disables preview', async () => {
      mockLoadCIConfig.mockReturnValue({ prPreview: false });

      await runPreview({ projectDir: '/test', dryRun: false, target: '@test/package' });

      expect(mockRunRelease).not.toHaveBeenCalled();
      expect(mockPostOrUpdateComment).not.toHaveBeenCalled();
    });

    it('should run when CI config enables preview', async () => {
      mockLoadCIConfig.mockReturnValue({ prPreview: true, releaseTrigger: 'commit' });

      await runPreview({ projectDir: '/test', dryRun: false, target: '@test/package' });

      expect(mockRunRelease).toHaveBeenCalled();
    });

    it('should print to stdout in dry-run mode instead of posting', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      await runPreview({ projectDir: '/test', dryRun: true, target: '@test/package' });

      expect(consoleSpy).toHaveBeenCalled();
      const output = consoleSpy.mock.calls[0]?.[0] as string;
      expect(output).toContain('<!-- releasekit-preview -->');
      expect(mockPostOrUpdateComment).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it('should handle no releasable changes gracefully', async () => {
      mockRunRelease.mockResolvedValue(null);

      await runPreview({ projectDir: '/test', dryRun: false, target: '@test/package' });

      expect(mockPostOrUpdateComment).toHaveBeenCalledWith(
        expect.anything(),
        'owner',
        'repo',
        1,
        expect.stringContaining('No releasable changes detected'),
      );
    });

    it('should fall back to stdout when context resolution fails', async () => {
      mockResolvePreviewContext.mockRejectedValue(new Error('No context'));
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      await runPreview({ projectDir: '/test', dryRun: true });

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe('options', () => {
    it('should pass config and projectDir options through', async () => {
      await runPreview({ projectDir: '/test', config: '/custom/config.json', dryRun: false, target: '@test/package' });

      expect(mockLoadCIConfig).toHaveBeenCalledWith({ cwd: '/test', configPath: '/custom/config.json' });
    });

    it('should pass pr and repo flags to context resolution', async () => {
      await runPreview({ projectDir: '/test', dryRun: false, pr: '42', repo: 'org/lib', target: '@test/package' });

      expect(mockResolvePreviewContext).toHaveBeenCalledWith({ pr: '42', repo: 'org/lib' });
    });

    it('should auto-detect prerelease and pass to runRelease', async () => {
      mockDetectPrerelease.mockReturnValue({ isPrerelease: true, identifier: 'next' });

      await runPreview({ projectDir: '/test', dryRun: false, target: '@test/package' });

      expect(mockRunRelease).toHaveBeenCalledWith(expect.objectContaining({ prerelease: 'next' }));
    });

    it('should not set prerelease when versions are stable', async () => {
      mockDetectPrerelease.mockReturnValue({ isPrerelease: false });

      await runPreview({ projectDir: '/test', dryRun: false, target: '@test/package' });

      expect(mockRunRelease).toHaveBeenCalledWith(expect.objectContaining({ prerelease: undefined }));
    });
  });

  describe('CLI flags', () => {
    describe('--stable', () => {
      it('should override auto-detection', async () => {
        mockDetectPrerelease.mockReturnValue({ isPrerelease: true, identifier: 'next' });

        await runPreview({ projectDir: '/test', dryRun: false, stable: true, target: '@test/package' });

        expect(mockRunRelease).toHaveBeenCalledWith(expect.objectContaining({ prerelease: undefined }));
      });

      it('should take priority over prerelease PR label', async () => {
        mockFetchPRLabels.mockResolvedValue(['channel:prerelease']);
        mockDetectPrerelease.mockReturnValue({ isPrerelease: false });

        await runPreview({ projectDir: '/test', dryRun: false, stable: true, target: '@test/package' });

        expect(mockRunRelease).toHaveBeenCalledWith(expect.objectContaining({ prerelease: undefined }));
      });
    });

    describe('--prerelease', () => {
      it('should override auto-detection', async () => {
        mockDetectPrerelease.mockReturnValue({ isPrerelease: false });

        await runPreview({ projectDir: '/test', dryRun: false, prerelease: 'beta', target: '@test/package' });

        expect(mockRunRelease).toHaveBeenCalledWith(expect.objectContaining({ prerelease: 'beta' }));
      });

      it('should take priority over stable PR label', async () => {
        mockFetchPRLabels.mockResolvedValue(['channel:stable']);

        await runPreview({ projectDir: '/test', dryRun: false, prerelease: 'beta', target: '@test/package' });

        expect(mockRunRelease).toHaveBeenCalledWith(expect.objectContaining({ prerelease: 'beta' }));
      });
    });

    describe('--bump', () => {
      it('should be passed through to runRelease', async () => {
        await runPreview({ projectDir: '/test', dryRun: false, bump: 'patch', target: '@test/package' });

        expect(mockRunRelease).toHaveBeenCalledWith(expect.objectContaining({ bump: 'patch' }));
      });

      it('should override noBumpLabel in dry-run + label-trigger mode', async () => {
        mockLoadCIConfig.mockReturnValue({ releaseTrigger: 'label' });
        const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

        await runPreview({ projectDir: '/test', dryRun: true, bump: 'minor' });

        expect(mockRunRelease).toHaveBeenCalledWith(expect.objectContaining({ bump: 'minor' }));
        expect(consoleSpy).toHaveBeenCalled();

        consoleSpy.mockRestore();
      });
    });

    describe('--target', () => {
      it('should be replaced by scope labels', async () => {
        mockLoadCIConfig.mockReturnValue({
          releaseTrigger: 'commit',
          scopeLabels: {
            'scope:shared': '@wdio/native-*',
          },
        });
        mockFetchPRLabels.mockResolvedValue(['scope:shared']);

        await runPreview({ projectDir: '/test', dryRun: false, target: '@custom/pkg' });

        expect(mockRunRelease).toHaveBeenCalledWith(expect.objectContaining({ target: '@wdio/native-*' }));
      });
    });
  });

  describe('PR labels', () => {
    describe('commit trigger mode', () => {
      it('should force major bump when bump:major label is present', async () => {
        mockFetchPRLabels.mockResolvedValue(['bump:major']);

        await runPreview({ projectDir: '/test', dryRun: false, target: '@test/package' });

        expect(mockRunRelease).toHaveBeenCalledWith(expect.objectContaining({ bump: 'major' }));
        expect(mockPostOrUpdateComment).toHaveBeenCalledWith(
          expect.anything(),
          'owner',
          'repo',
          1,
          expect.stringContaining('labeled for a **major** release'),
        );
      });

      it('should ignore minor and patch labels in commit mode', async () => {
        mockLoadCIConfig.mockReturnValue({ releaseTrigger: 'commit' });
        mockFetchPRLabels.mockResolvedValue(['bump:major', 'bump:minor', 'bump:patch']);

        await runPreview({ projectDir: '/test', dryRun: false, target: '@test/package' });

        expect(mockRunRelease).toHaveBeenCalledWith(expect.objectContaining({ bump: 'major' }));
        expect(mockPostOrUpdateComment).toHaveBeenCalledWith(
          expect.anything(),
          'owner',
          'repo',
          1,
          expect.stringContaining('labeled for a **major** release'),
        );
      });

      it('should show skip banner when release:skip label is present', async () => {
        mockLoadCIConfig.mockReturnValue({ releaseTrigger: 'commit' });
        mockFetchPRLabels.mockResolvedValue(['release:skip']);

        await runPreview({ projectDir: '/test', dryRun: false, target: '@test/package' });

        expect(mockRunRelease).not.toHaveBeenCalled();
        expect(mockPostOrUpdateComment).toHaveBeenCalledWith(
          expect.anything(),
          'owner',
          'repo',
          1,
          expect.stringContaining('marked to skip release'),
        );
      });

      it('should prioritize skip over major label', async () => {
        mockLoadCIConfig.mockReturnValue({ releaseTrigger: 'commit' });
        mockFetchPRLabels.mockResolvedValue(['release:skip', 'bump:major']);

        await runPreview({ projectDir: '/test', dryRun: false, target: '@test/package' });

        expect(mockRunRelease).not.toHaveBeenCalled();
        expect(mockPostOrUpdateComment).toHaveBeenCalledWith(
          expect.anything(),
          'owner',
          'repo',
          1,
          expect.stringContaining('marked to skip release'),
        );
      });

      it('should compose major and prerelease labels', async () => {
        mockDetectPrerelease.mockReturnValue({ isPrerelease: false });
        mockFetchPRLabels.mockResolvedValue(['bump:major', 'channel:prerelease']);

        await runPreview({ projectDir: '/test', dryRun: false, target: '@test/package' });

        expect(mockRunRelease).toHaveBeenCalledWith(expect.objectContaining({ bump: 'major', prerelease: true }));
      });
    });

    describe('label trigger mode', () => {
      it('should post "no label" comment without running release analysis when no bump label present', async () => {
        mockLoadCIConfig.mockReturnValue({ releaseTrigger: 'label' });
        mockFetchPRLabels.mockResolvedValue([]);

        await runPreview({ projectDir: '/test', dryRun: false, target: '@test/package' });

        expect(mockRunRelease).not.toHaveBeenCalled();
        expect(mockPostOrUpdateComment).toHaveBeenCalledWith(
          expect.anything(),
          'owner',
          'repo',
          1,
          expect.stringContaining('No bump label detected'),
        );
      });

      it('should trigger patch preview when bump:patch label is present', async () => {
        mockLoadCIConfig.mockReturnValue({ releaseTrigger: 'label' });
        mockFetchPRLabels.mockResolvedValue(['bump:patch']);

        await runPreview({ projectDir: '/test', dryRun: false, target: '@test/package' });

        expect(mockRunRelease).toHaveBeenCalledWith(expect.objectContaining({ bump: 'patch' }));
      });

      it('should trigger minor preview when bump:minor label is present', async () => {
        mockLoadCIConfig.mockReturnValue({ releaseTrigger: 'label' });
        mockFetchPRLabels.mockResolvedValue(['bump:minor']);

        await runPreview({ projectDir: '/test', dryRun: false, target: '@test/package' });

        expect(mockRunRelease).toHaveBeenCalledWith(expect.objectContaining({ bump: 'minor' }));
      });

      it('should trigger major preview when bump:major label is present', async () => {
        mockLoadCIConfig.mockReturnValue({ releaseTrigger: 'label' });
        mockFetchPRLabels.mockResolvedValue(['bump:major']);

        await runPreview({ projectDir: '/test', dryRun: false, target: '@test/package' });

        expect(mockRunRelease).toHaveBeenCalledWith(expect.objectContaining({ bump: 'major' }));
      });

      it('should compose bump label and prerelease label', async () => {
        mockLoadCIConfig.mockReturnValue({ releaseTrigger: 'label' });
        mockDetectPrerelease.mockReturnValue({ isPrerelease: false });
        mockFetchPRLabels.mockResolvedValue(['bump:minor', 'channel:prerelease']);

        await runPreview({ projectDir: '/test', dryRun: false, target: '@test/package' });

        expect(mockRunRelease).toHaveBeenCalledWith(expect.objectContaining({ bump: 'minor', prerelease: true }));
      });

      it('should ignore skip label in label mode', async () => {
        mockLoadCIConfig.mockReturnValue({ releaseTrigger: 'label' });
        mockFetchPRLabels.mockResolvedValue(['release:skip', 'bump:minor']);

        await runPreview({ projectDir: '/test', dryRun: false, target: '@test/package' });

        expect(mockRunRelease).toHaveBeenCalledWith(expect.objectContaining({ bump: 'minor' }));
      });

      it('should print "no label" comment to stdout in dry-run mode', async () => {
        mockLoadCIConfig.mockReturnValue({ releaseTrigger: 'label' });
        const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

        await runPreview({ projectDir: '/test', dryRun: true });

        expect(mockRunRelease).not.toHaveBeenCalled();
        expect(mockPostOrUpdateComment).not.toHaveBeenCalled();
        expect(consoleSpy).toHaveBeenCalled();
        const output = consoleSpy.mock.calls[0]?.[0] as string;
        expect(output).toContain('<!-- releasekit-preview -->');
        expect(output).toContain('No bump label detected');

        consoleSpy.mockRestore();
      });

      it('should use custom label names', async () => {
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

        await runPreview({ projectDir: '/test', dryRun: false, target: '@test/package' });

        expect(mockRunRelease).toHaveBeenCalledWith(expect.objectContaining({ bump: 'minor' }));
      });
    });
  });

  describe('PR label conflicts', () => {
    describe('bump label conflicts', () => {
      it('should block release when multiple bump labels present in label mode', async () => {
        mockLoadCIConfig.mockReturnValue({ releaseTrigger: 'label' });
        mockFetchPRLabels.mockResolvedValue(['bump:patch', 'bump:major']);

        await runPreview({ projectDir: '/test', dryRun: false, target: '@test/package' });

        expect(mockRunRelease).not.toHaveBeenCalled();
        expect(mockPostOrUpdateComment).toHaveBeenCalledWith(
          expect.anything(),
          'owner',
          'repo',
          1,
          expect.stringContaining('Conflicting bump labels detected'),
        );
      });

      it('should block release when all three bump labels present in label mode', async () => {
        mockFetchPRLabels.mockResolvedValue(['bump:major', 'bump:minor', 'bump:patch']);
        mockLoadCIConfig.mockReturnValue({ releaseTrigger: 'label' });

        await runPreview({ projectDir: '/test', dryRun: false, target: '@test/package' });

        expect(mockRunRelease).not.toHaveBeenCalled();
        expect(mockPostOrUpdateComment).toHaveBeenCalledWith(
          expect.anything(),
          'owner',
          'repo',
          1,
          expect.stringContaining('Conflicting bump labels detected'),
        );
      });
    });

    describe('stable/prerelease conflicts', () => {
      it('should block release when channel:stable and channel:prerelease both present', async () => {
        mockFetchPRLabels.mockResolvedValue(['channel:stable', 'channel:prerelease', 'bump:minor']);
        mockLoadCIConfig.mockReturnValue({ releaseTrigger: 'label' });

        await runPreview({ projectDir: '/test', dryRun: false, target: '@test/package' });

        expect(mockRunRelease).not.toHaveBeenCalled();
        expect(mockPostOrUpdateComment).toHaveBeenCalledWith(
          expect.anything(),
          'owner',
          'repo',
          1,
          expect.stringContaining('Conflicting release type labels detected'),
        );
      });
    });
  });

  describe('stable/prerelease defaults', () => {
    describe('prerelease label', () => {
      it('should not trigger release when channel:prerelease label is present alone', async () => {
        mockFetchPRLabels.mockResolvedValue(['channel:prerelease']);
        mockLoadCIConfig.mockReturnValue({ releaseTrigger: 'label' });

        await runPreview({ projectDir: '/test', dryRun: false, target: '@test/package' });

        expect(mockRunRelease).not.toHaveBeenCalled();
        expect(mockPostOrUpdateComment).toHaveBeenCalledWith(
          expect.anything(),
          'owner',
          'repo',
          1,
          expect.stringContaining('No bump label detected'),
        );
      });

      it('should surface the gate reason in the banner when channel:prerelease + scope but no bump (honest preview)', async () => {
        // Reproduces the wdio-desktop-mobile #225 scenario: channel:prerelease + scope:tauri.
        // The OLD preview lied — it showed a version bump table because scope was present.
        // The NEW preview matches the gate's verdict: this PR will NOT trigger a release.
        mockLoadCIConfig.mockReturnValue({
          releaseTrigger: 'label',
          scopeLabels: { 'scope:tauri': '@wdio/tauri-*' },
        });
        mockFetchPRLabels.mockResolvedValue(['channel:prerelease', 'scope:tauri']);

        await runPreview({ projectDir: '/test', dryRun: false });

        // Critically: runRelease (which would compute the misleading version bump) is NOT called.
        expect(mockRunRelease).not.toHaveBeenCalled();

        const body = mockPostOrUpdateComment.mock.calls[0][4] as string;
        expect(body).toContain('No bump label detected');
        // The gate reason — surfaced via labelContext.gateReason — explains exactly why.
        expect(body).toContain('channel:prerelease');
        // No version bump table is rendered.
        expect(body).not.toContain('### Packages');
      });

      it('should use minor bump when prerelease and bump:minor labels present', async () => {
        mockFetchPRLabels.mockResolvedValue(['channel:prerelease', 'bump:minor']);
        mockLoadCIConfig.mockReturnValue({ releaseTrigger: 'label' });

        await runPreview({ projectDir: '/test', dryRun: false, target: '@test/package' });

        expect(mockRunRelease).toHaveBeenCalledWith(expect.objectContaining({ bump: 'minor', prerelease: true }));
      });
    });

    describe('stable label', () => {
      it('should graduate prerelease to stable when stable label is present', async () => {
        mockFetchPRLabels.mockResolvedValue(['channel:stable', 'bump:minor']);
        mockLoadCIConfig.mockReturnValue({ releaseTrigger: 'label' });
        mockDetectPrerelease.mockReturnValue({ isPrerelease: true, identifier: 'beta' });

        await runPreview({ projectDir: '/test', dryRun: false, target: '@test/package' });

        const callArgs = mockRunRelease.mock.calls[0][0];
        // Per gate semantics: channel:stable causes bump to be auto-detected from commits.
        // bump label magnitude is not propagated when graduation is the primary intent.
        expect(callArgs.bump).toBeUndefined();
        expect(callArgs.stable).toBe(true);
      });

      it('should run release analysis but not set bump when stable label present without bump label', async () => {
        mockFetchPRLabels.mockResolvedValue(['channel:stable']);
        mockLoadCIConfig.mockReturnValue({ releaseTrigger: 'label' });
        mockDetectPrerelease.mockReturnValue({ isPrerelease: true, identifier: 'beta' });

        await runPreview({ projectDir: '/test', dryRun: false, target: '@test/package' });

        expect(mockRunRelease).toHaveBeenCalled();
        const callArgs = mockRunRelease.mock.calls[0][0];
        expect(callArgs.bump).toBeUndefined();
        expect(callArgs.stable).toBe(true);
      });
    });
  });

  describe('scope labels', () => {
    it('should filter packages in commit mode when scope label present', async () => {
      mockLoadCIConfig.mockReturnValue({
        releaseTrigger: 'commit',
        scopeLabels: {
          'scope:shared': '@wdio/native-*',
          'scope:tauri': '@wdio/tauri-*',
        },
      });
      mockFetchPRLabels.mockResolvedValue(['scope:shared']);

      await runPreview({ projectDir: '/test', dryRun: false, target: '@test/package' });

      expect(mockRunRelease).toHaveBeenCalledWith(expect.objectContaining({ target: '@wdio/native-*' }));
      expect(mockPostOrUpdateComment).toHaveBeenCalledWith(
        expect.anything(),
        'owner',
        'repo',
        1,
        expect.stringContaining('**Scope:**'),
      );
    });

    it('should NOT trigger release for scope-only PR in label mode (matches gate)', async () => {
      mockLoadCIConfig.mockReturnValue({
        releaseTrigger: 'label',
        scopeLabels: {
          'scope:shared': '@wdio/native-*',
        },
      });
      mockFetchPRLabels.mockResolvedValue(['scope:shared']);

      await runPreview({ projectDir: '/test', dryRun: false, target: '@test/package' });

      // Per-PR evaluation: scope label alone is not a release trigger in label mode —
      // the gate would block, so the preview must show "won't release" too.
      expect(mockRunRelease).not.toHaveBeenCalled();
      expect(mockPostOrUpdateComment).toHaveBeenCalledWith(
        expect.anything(),
        'owner',
        'repo',
        1,
        expect.stringContaining('No bump label detected'),
      );
    });

    it('should combine multiple scope labels with OR logic', async () => {
      mockLoadCIConfig.mockReturnValue({
        releaseTrigger: 'commit',
        scopeLabels: {
          'scope:shared': '@wdio/native-*',
          'scope:tauri': '@wdio/tauri-*',
        },
      });
      mockFetchPRLabels.mockResolvedValue(['scope:shared', 'scope:tauri']);

      await runPreview({ projectDir: '/test', dryRun: false, target: '@test/package' });

      expect(mockRunRelease).toHaveBeenCalledWith(expect.objectContaining({ target: '@wdio/native-*, @wdio/tauri-*' }));
    });

    it('should combine scope label with release label', async () => {
      mockLoadCIConfig.mockReturnValue({
        releaseTrigger: 'label',
        scopeLabels: {
          'scope:shared': '@wdio/native-*',
        },
      });
      mockFetchPRLabels.mockResolvedValue(['scope:shared', 'bump:minor']);

      await runPreview({ projectDir: '/test', dryRun: false, target: '@test/package' });

      expect(mockRunRelease).toHaveBeenCalledWith(expect.objectContaining({ target: '@wdio/native-*', bump: 'minor' }));
    });

    it('should NOT release in label mode for scope-only PR — gate requires bump or stable label', async () => {
      // Aligned with gate semantics: in label trigger mode, scope alone does not trigger
      // a release. The user must add bump:* or channel:stable. Conventional-commits-driven
      // bumps are only supported in commit trigger mode.
      mockLoadCIConfig.mockReturnValue({
        releaseTrigger: 'label',
        scopeLabels: {
          'scope:shared': '@wdio/native-*',
        },
      });
      mockFetchPRLabels.mockResolvedValue(['scope:shared']);

      await runPreview({ projectDir: '/test', dryRun: false, target: '@test/package' });

      expect(mockRunRelease).not.toHaveBeenCalled();
    });

    it('should display scope in preview comment banner', async () => {
      mockLoadCIConfig.mockReturnValue({
        releaseTrigger: 'commit',
        scopeLabels: {
          'scope:shared': '@wdio/native-*',
        },
      });
      mockFetchPRLabels.mockResolvedValue(['scope:shared']);

      await runPreview({ projectDir: '/test', dryRun: false, target: '@test/package' });

      // Banner shows the LABEL NAME (what the author can recognise on the PR), not the
      // configured glob pattern. result.target still uses the pattern.
      expect(mockPostOrUpdateComment).toHaveBeenCalledWith(
        expect.anything(),
        'owner',
        'repo',
        1,
        expect.stringContaining('**Scope:** scope:shared'),
      );
    });

    it('should use custom scope label names from CI config', async () => {
      mockLoadCIConfig.mockReturnValue({
        releaseTrigger: 'commit',
        scopeLabels: {
          'shared-pkg': '@wdio/native-*',
        },
      });
      mockFetchPRLabels.mockResolvedValue(['shared-pkg']);

      await runPreview({ projectDir: '/test', dryRun: false, target: '@test/package' });

      expect(mockRunRelease).toHaveBeenCalledWith(expect.objectContaining({ target: '@wdio/native-*' }));
    });

    it('should use target when no scope label present', async () => {
      mockLoadCIConfig.mockReturnValue({
        releaseTrigger: 'commit',
        scopeLabels: {
          'scope:shared': '@wdio/native-*',
        },
      });
      mockFetchPRLabels.mockResolvedValue(['bug']);

      await runPreview({ projectDir: '/test', dryRun: false, target: '@test/package' });

      expect(mockRunRelease).toHaveBeenCalled();
      const callArgs = mockRunRelease.mock.calls[0][0];
      expect(callArgs.target).toBe('@test/package');
    });

    it('should throw when no scope label matched and no target provided (commit mode)', async () => {
      mockLoadCIConfig.mockReturnValue({
        releaseTrigger: 'commit',
        scopeLabels: {
          'scope:shared': '@wdio/native-*',
        },
      });
      mockFetchPRLabels.mockResolvedValue(['bug']);

      await expect(runPreview({ projectDir: '/test', dryRun: false })).rejects.toThrow('No scope specified');
    });

    it('should not throw in label mode with no labels when scopeLabels configured (no release will happen)', async () => {
      mockLoadCIConfig.mockReturnValue({
        releaseTrigger: 'label',
        scopeLabels: {
          'scope:shared': '@wdio/native-*',
          'scope:electron': '@wdio/electron-*',
        },
      });
      mockFetchPRLabels.mockResolvedValue([]);

      await expect(runPreview({ projectDir: '/test', dryRun: false })).resolves.toBeUndefined();
      expect(mockRunRelease).not.toHaveBeenCalled();
      expect(mockPostOrUpdateComment).toHaveBeenCalledWith(
        expect.anything(),
        'owner',
        'repo',
        1,
        expect.stringContaining('No bump label detected'),
      );
    });

    it('should throw in label mode when bump label present but no scope label and no target', async () => {
      mockLoadCIConfig.mockReturnValue({
        releaseTrigger: 'label',
        scopeLabels: {
          'scope:shared': '@wdio/native-*',
        },
      });
      mockFetchPRLabels.mockResolvedValue(['bump:patch']);

      await expect(runPreview({ projectDir: '/test', dryRun: false })).rejects.toThrow('No scope specified');
    });
  });

  describe('label fetching', () => {
    it('should skip in dry-run mode', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      await runPreview({ projectDir: '/test', dryRun: true });

      expect(mockFetchPRLabels).not.toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('should gracefully handle label fetch failure', async () => {
      mockFetchPRLabels.mockRejectedValue(new Error('API rate limit'));
      mockDetectPrerelease.mockReturnValue({ isPrerelease: false });

      await runPreview({ projectDir: '/test', dryRun: false, target: '@test/package' });

      expect(mockRunRelease).toHaveBeenCalled();
      expect(mockPostOrUpdateComment).toHaveBeenCalled();
    });
  });

  describe('standing PR snapshot', () => {
    function makeSnapshot() {
      return {
        number: 42,
        url: 'https://github.com/owner/repo/pull/42',
        openedAt: new Date().toISOString(),
        gateState: 'success' as const,
        manifest: {
          schemaVersion: 2 as const,
          versionOutput: {
            dryRun: false,
            updates: [{ packageName: 'queued-pkg', newVersion: '0.5.0', filePath: 'package.json' }],
            changelogs: [
              {
                packageName: 'queued-pkg',
                version: '0.5.0',
                previousVersion: '0.4.0',
                revisionRange: 'v0.4.0..HEAD',
                repoUrl: null,
                entries: [{ type: 'feat', description: 'queued change' }],
              },
            ],
            tags: [],
          },
          releaseNotes: {},
          notesFiles: [],
          createdAt: new Date().toISOString(),
          baseSha: 'abc',
          firstUpdatedAt: new Date().toISOString(),
        },
      };
    }

    it('should fetch the snapshot and thread it into the comment when strategy is standing-pr', async () => {
      mockLoadCIConfig.mockReturnValue({ releaseStrategy: 'standing-pr', releaseTrigger: 'commit' });
      mockFetchStandingPRSnapshot.mockResolvedValue(makeSnapshot());

      await runPreview({ projectDir: '/test', dryRun: false, target: '@test/package' });

      expect(mockFetchStandingPRSnapshot).toHaveBeenCalledTimes(1);
      const body = mockPostOrUpdateComment.mock.calls[0]?.[4] as string;
      expect(body).toContain('**Standing release PR:**');
      expect(body).toContain('[#42]');
      expect(body).toContain('### After merge — predicted release');
    });

    it('should render snapshot only (no merge table) when this PR has no releasable changes', async () => {
      mockLoadCIConfig.mockReturnValue({ releaseStrategy: 'standing-pr', releaseTrigger: 'commit' });
      mockFetchStandingPRSnapshot.mockResolvedValue(makeSnapshot());
      mockRunRelease.mockResolvedValue(null);

      await runPreview({ projectDir: '/test', dryRun: false, target: '@test/package' });

      const body = mockPostOrUpdateComment.mock.calls[0]?.[4] as string;
      expect(body).toContain('**Standing release PR:**');
      expect(body).not.toContain('### After merge');
    });

    it('should omit the snapshot when no standing PR is found', async () => {
      mockLoadCIConfig.mockReturnValue({ releaseStrategy: 'standing-pr', releaseTrigger: 'commit' });
      mockFetchStandingPRSnapshot.mockResolvedValue(null);

      await runPreview({ projectDir: '/test', dryRun: false, target: '@test/package' });

      const body = mockPostOrUpdateComment.mock.calls[0]?.[4] as string;
      expect(body).not.toContain('**Standing release PR:**');
    });

    it('should treat fetch failure as non-fatal (preview still posts)', async () => {
      mockLoadCIConfig.mockReturnValue({ releaseStrategy: 'standing-pr', releaseTrigger: 'commit' });
      mockFetchStandingPRSnapshot.mockRejectedValue(new Error('boom'));

      await runPreview({ projectDir: '/test', dryRun: false, target: '@test/package' });

      expect(mockPostOrUpdateComment).toHaveBeenCalled();
      const body = mockPostOrUpdateComment.mock.calls[0]?.[4] as string;
      expect(body).not.toContain('**Standing release PR:**');
    });

    it('should not fetch the snapshot when strategy is not standing-pr', async () => {
      mockLoadCIConfig.mockReturnValue({ releaseStrategy: 'direct', releaseTrigger: 'commit' });

      await runPreview({ projectDir: '/test', dryRun: false, target: '@test/package' });

      expect(mockFetchStandingPRSnapshot).not.toHaveBeenCalled();
    });
  });

  describe('label semantics in standing-pr mode', () => {
    function ciWithLabels(extras: Record<string, unknown> = {}) {
      return {
        releaseStrategy: 'standing-pr',
        releaseTrigger: 'label',
        labels: {
          stable: 'channel:stable',
          prerelease: 'channel:prerelease',
          skip: 'release:skip',
          immediate: 'release:immediate',
          major: 'bump:major',
          minor: 'bump:minor',
          patch: 'bump:patch',
        },
        ...extras,
      };
    }

    it('should NOT propagate bump label to runRelease in standing-pr advisory mode', async () => {
      mockLoadCIConfig.mockReturnValue(ciWithLabels());
      mockFetchPRLabels.mockResolvedValue(['bump:patch']);

      await runPreview({ projectDir: '/test', dryRun: false, target: '@test/package' });

      // runRelease should be called WITHOUT bump derived from the label
      expect(mockRunRelease).toHaveBeenCalled();
      const callArg = mockRunRelease.mock.calls[0]?.[0] as { bump?: string };
      expect(callArg?.bump).toBeUndefined();
    });

    it('should NOT throw "No scope specified" in standing-pr advisory mode', async () => {
      mockLoadCIConfig.mockReturnValue(ciWithLabels({ scopeLabels: { 'scope:foo': '@scope/foo' } }));
      mockFetchPRLabels.mockResolvedValue(['bump:patch']); // no scope label, no --target
      // Without the advisory bypass this would throw "No scope specified"
      await runPreview({ projectDir: '/test', dryRun: false });
      expect(mockPostOrUpdateComment).toHaveBeenCalled();
    });

    it('should propagate bump label to runRelease when release:immediate is also set', async () => {
      mockLoadCIConfig.mockReturnValue(ciWithLabels());
      mockFetchPRLabels.mockResolvedValue(['release:immediate', 'bump:minor']);

      await runPreview({ projectDir: '/test', dryRun: false, target: '@test/package' });

      const callArg = mockRunRelease.mock.calls[0]?.[0] as { bump?: string };
      expect(callArg?.bump).toBe('minor');
    });

    it('should skip standing-PR snapshot fetch when release:immediate is set', async () => {
      mockLoadCIConfig.mockReturnValue(ciWithLabels());
      mockFetchPRLabels.mockResolvedValue(['release:immediate', 'bump:patch']);

      await runPreview({ projectDir: '/test', dryRun: false, target: '@test/package' });

      expect(mockFetchStandingPRSnapshot).not.toHaveBeenCalled();
    });

    it('should still propagate bump label in direct strategy mode (no change)', async () => {
      mockLoadCIConfig.mockReturnValue({
        releaseStrategy: 'direct',
        releaseTrigger: 'label',
        labels: {
          stable: 'channel:stable',
          prerelease: 'channel:prerelease',
          skip: 'release:skip',
          immediate: 'release:immediate',
          major: 'bump:major',
          minor: 'bump:minor',
          patch: 'bump:patch',
        },
      });
      mockFetchPRLabels.mockResolvedValue(['bump:major']);

      await runPreview({ projectDir: '/test', dryRun: false, target: '@test/package' });

      const callArg = mockRunRelease.mock.calls[0]?.[0] as { bump?: string };
      expect(callArg?.bump).toBe('major');
    });
  });
});
