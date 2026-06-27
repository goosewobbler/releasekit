import type { OpenPullRequest } from '@releasekit/forge';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// --- Mocks ---

const mockLoadCIConfig = vi.fn();

vi.mock('@releasekit/config', () => ({
  loadCIConfig: (...args: unknown[]) => mockLoadCIConfig(...args),
}));

vi.mock('@releasekit/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@releasekit/core')>();
  return { ...actual, info: vi.fn(), warn: vi.fn() };
});

const mockGetGitHubContext = vi.fn();

vi.mock('../../src/git.js', () => ({
  getGitHubContext: (...args: unknown[]) => mockGetGitHubContext(...args),
}));

const mockForgeFor = vi.fn();

vi.mock('../../src/github.js', () => ({
  MARKER: '<!-- releasekit-preview -->',
  forgeFor: (...args: unknown[]) => mockForgeFor(...args),
}));

const mockRunStandingPRUpdate = vi.fn();

vi.mock('../../src/standing-pr/standing-pr.js', () => ({
  runStandingPRUpdate: (...args: unknown[]) => mockRunStandingPRUpdate(...args),
}));

const mockRunPreview = vi.fn();

vi.mock('../../src/preview/preview.js', () => ({
  runPreview: (...args: unknown[]) => mockRunPreview(...args),
}));

// --- Helpers ---

function pr(number: number, overrides: Partial<OpenPullRequest> = {}): OpenPullRequest {
  return { number, headRef: `feat/pr-${number}`, draft: false, baseSha: `sha-${number}`, ...overrides };
}

/** A minimal fake forge: `commentsOn` lists PR numbers that already have a preview comment. */
function fakeForge(openPullRequests: OpenPullRequest[], commentsOn: number[] = openPullRequests.map((p) => p.number)) {
  const present = new Set(commentsOn);
  return {
    listOpenPullRequests: vi.fn().mockResolvedValue(openPullRequests),
    findComment: vi.fn(async (prNumber: number, marker: string) =>
      present.has(prNumber) ? { id: prNumber, body: `${marker}\nbody` } : null,
    ),
  };
}

const context = { owner: 'owner', repo: 'repo', token: 'tok', sha: null };

// --- Tests ---

describe('runRefreshAfterRelease', () => {
  let runRefreshAfterRelease: typeof import('../../src/preview/refresh.js').runRefreshAfterRelease;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockLoadCIConfig.mockReturnValue({
      releaseStrategy: 'direct',
      prPreview: { enabled: true, refreshAfterRelease: true },
    });
    mockGetGitHubContext.mockReturnValue(context);
    mockRunStandingPRUpdate.mockResolvedValue({ action: 'noop' });
    mockRunPreview.mockResolvedValue(undefined);

    const mod = await import('../../src/preview/refresh.js');
    runRefreshAfterRelease = mod.runRefreshAfterRelease;
  });

  describe('feeder-PR preview refresh', () => {
    it('should refresh eligible PRs, passing each PR base SHA', async () => {
      mockForgeFor.mockReturnValue(fakeForge([pr(10), pr(11)]));

      await runRefreshAfterRelease({ projectDir: '/p' });

      expect(mockRunPreview).toHaveBeenCalledTimes(2);
      expect(mockRunPreview).toHaveBeenCalledWith(
        expect.objectContaining({ pr: '10', repo: 'owner/repo', baseSha: 'sha-10' }),
      );
      expect(mockRunPreview).toHaveBeenCalledWith(
        expect.objectContaining({ pr: '11', repo: 'owner/repo', baseSha: 'sha-11' }),
      );
    });

    it('should skip draft PRs', async () => {
      mockForgeFor.mockReturnValue(fakeForge([pr(10, { draft: true }), pr(11)]));

      await runRefreshAfterRelease({ projectDir: '/p' });

      expect(mockRunPreview).toHaveBeenCalledTimes(1);
      expect(mockRunPreview).toHaveBeenCalledWith(expect.objectContaining({ pr: '11' }));
    });

    it('should skip the standing PR by head ref', async () => {
      mockForgeFor.mockReturnValue(fakeForge([pr(10, { headRef: 'release/next' }), pr(11)]));

      await runRefreshAfterRelease({ projectDir: '/p' });

      expect(mockRunPreview).toHaveBeenCalledTimes(1);
      expect(mockRunPreview).toHaveBeenCalledWith(expect.objectContaining({ pr: '11' }));
    });

    it('should skip PRs without an existing preview comment', async () => {
      mockForgeFor.mockReturnValue(fakeForge([pr(10), pr(11)], [11]));

      await runRefreshAfterRelease({ projectDir: '/p' });

      expect(mockRunPreview).toHaveBeenCalledTimes(1);
      expect(mockRunPreview).toHaveBeenCalledWith(expect.objectContaining({ pr: '11' }));
    });

    it('should cap the number of refreshed PRs at 50 and warn', async () => {
      const { warn } = await import('@releasekit/core');
      const many = Array.from({ length: 55 }, (_, i) => pr(i + 1));
      const forge = fakeForge(many);
      mockForgeFor.mockReturnValue(forge);

      await runRefreshAfterRelease({ projectDir: '/p' });

      expect(mockRunPreview).toHaveBeenCalledTimes(50);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('More than 50'));
      // Probing stops one past the cap rather than checking every open PR's comments.
      expect(forge.findComment).toHaveBeenCalledTimes(51);
    });

    it('should continue refreshing remaining PRs when one runPreview throws', async () => {
      mockForgeFor.mockReturnValue(fakeForge([pr(10), pr(11), pr(12)]));
      mockRunPreview.mockImplementation(async (opts: { pr: string }) => {
        if (opts.pr === '11') throw new Error('boom');
      });

      await runRefreshAfterRelease({ projectDir: '/p' });

      expect(mockRunPreview).toHaveBeenCalledTimes(3);
    });

    it('should not throw when the entire feeder refresh fails', async () => {
      mockForgeFor.mockReturnValue({
        listOpenPullRequests: vi.fn().mockRejectedValue(new Error('rate limited')),
        findComment: vi.fn(),
      });

      await expect(runRefreshAfterRelease({ projectDir: '/p' })).resolves.toBeUndefined();
    });

    it('should skip the feeder refresh when refreshAfterRelease is off', async () => {
      mockLoadCIConfig.mockReturnValue({
        releaseStrategy: 'direct',
        prPreview: { enabled: true, refreshAfterRelease: false },
      });
      const forge = fakeForge([pr(10)]);
      mockForgeFor.mockReturnValue(forge);

      await runRefreshAfterRelease({ projectDir: '/p' });

      expect(forge.listOpenPullRequests).not.toHaveBeenCalled();
      expect(mockRunPreview).not.toHaveBeenCalled();
    });

    it('should skip the feeder refresh when previews are disabled', async () => {
      mockLoadCIConfig.mockReturnValue({
        releaseStrategy: 'direct',
        prPreview: { enabled: false, refreshAfterRelease: true },
      });
      const forge = fakeForge([pr(10)]);
      mockForgeFor.mockReturnValue(forge);

      await runRefreshAfterRelease({ projectDir: '/p' });

      expect(forge.listOpenPullRequests).not.toHaveBeenCalled();
    });

    it('should warn and skip the feeder refresh when no token is present', async () => {
      mockGetGitHubContext.mockReturnValue({ ...context, token: null });

      await runRefreshAfterRelease({ projectDir: '/p' });

      expect(mockForgeFor).not.toHaveBeenCalled();
      expect(mockRunPreview).not.toHaveBeenCalled();
    });
  });

  describe('standing-PR reconcile', () => {
    it('should not reconcile in direct mode', async () => {
      mockForgeFor.mockReturnValue(fakeForge([pr(10)]));

      await runRefreshAfterRelease({ projectDir: '/p' });

      expect(mockRunStandingPRUpdate).not.toHaveBeenCalled();
      expect(mockRunPreview).toHaveBeenCalledTimes(1); // feeders still refresh
    });

    it('should reconcile the standing PR before refreshing previews in standing-pr mode', async () => {
      mockLoadCIConfig.mockReturnValue({
        releaseStrategy: 'standing-pr',
        prPreview: { enabled: true, refreshAfterRelease: true },
      });
      mockForgeFor.mockReturnValue(fakeForge([pr(10)]));

      await runRefreshAfterRelease({ projectDir: '/p' });

      expect(mockRunStandingPRUpdate).toHaveBeenCalledWith(expect.objectContaining({ reconcile: true }));
      expect(mockRunStandingPRUpdate.mock.invocationCallOrder[0]).toBeLessThan(
        mockRunPreview.mock.invocationCallOrder[0],
      );
    });

    it('should propagate a reconcile failure and not refresh previews', async () => {
      mockLoadCIConfig.mockReturnValue({
        releaseStrategy: 'standing-pr',
        prPreview: { enabled: true, refreshAfterRelease: true },
      });
      mockForgeFor.mockReturnValue(fakeForge([pr(10)]));
      mockRunStandingPRUpdate.mockRejectedValue(new Error('reconcile failed'));

      await expect(runRefreshAfterRelease({ projectDir: '/p' })).rejects.toThrow('reconcile failed');
      expect(mockRunPreview).not.toHaveBeenCalled();
    });
  });

  describe('refreshFeederPreviews (direct)', () => {
    it('should refresh eligible feeder PRs when called directly', async () => {
      mockForgeFor.mockReturnValue(fakeForge([pr(10)]));
      const { refreshFeederPreviews } = await import('../../src/preview/refresh.js');

      await refreshFeederPreviews({ projectDir: '/p' });

      expect(mockRunPreview).toHaveBeenCalledWith(expect.objectContaining({ pr: '10' }));
    });

    it('should never throw, so the orchestrator can call it without a guard', async () => {
      mockLoadCIConfig.mockImplementation(() => {
        throw new Error('config parse error');
      });
      const { refreshFeederPreviews } = await import('../../src/preview/refresh.js');

      await expect(refreshFeederPreviews({ projectDir: '/p' })).resolves.toBeUndefined();
    });
  });
});
