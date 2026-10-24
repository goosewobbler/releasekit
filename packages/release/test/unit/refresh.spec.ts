import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeForge, type FakeForge, type OpenPullRequest } from '@releasekit/forge';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MARKER } from '../../src/github.js';

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

vi.mock('../../src/github.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/github.js')>()),
  forgeFor: (...args: unknown[]) => mockForgeFor(...args),
}));

const mockRunStandingPRUpdate = vi.fn();

vi.mock('../../src/standing-pr/standing-pr.js', () => ({
  runStandingPRUpdate: (...args: unknown[]) => mockRunStandingPRUpdate(...args),
}));

const STALE_MARKER = '<!-- releasekit-preview-stale -->';

function pr(number: number, overrides: Partial<OpenPullRequest> = {}): OpenPullRequest {
  return { number, headRef: `feat/pr-${number}`, draft: false, ...overrides };
}

function previewBody(number: number): string {
  return `${MARKER}\n\n<details>\n<summary>Release Preview for #${number}</summary>\n</details>`;
}

/** `previewsOn` lists PRs that already have a bot-authored preview comment, whose id is the PR number. */
function seedForge(openPullRequests: OpenPullRequest[], previewsOn = openPullRequests.map((p) => p.number)): FakeForge {
  return createFakeForge({
    openPullRequests,
    comments: previewsOn.map((n) => ({ id: n, prNumber: n, body: previewBody(n) })),
  });
}

function markedStale(forge: FakeForge): number[] {
  return forge.updatedComments.filter((c) => c.body.includes(STALE_MARKER)).map((c) => c.commentId);
}

const context = { owner: 'owner', repo: 'repo', token: 'tok', sha: null };

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

    const mod = await import('../../src/preview/refresh.js');
    runRefreshAfterRelease = mod.runRefreshAfterRelease;
  });

  describe('feeder-PR preview refresh', () => {
    it('should mark each eligible preview stale in place, keeping the marker first and the preview below', async () => {
      const forge = seedForge([pr(10), pr(11)]);
      mockForgeFor.mockReturnValue(forge);

      await runRefreshAfterRelease({ projectDir: '/p' });

      expect(forge.createdComments).toEqual([]);
      expect(markedStale(forge)).toEqual([10, 11]);
      const body = forge.comments.find((c) => c.id === 10)?.body ?? '';
      expect(body.startsWith(`${MARKER}\n`)).toBe(true);
      expect(body).toContain('> **Stale:**');
      expect(body.endsWith(previewBody(10).slice(MARKER.length))).toBe(true);
    });

    it('should skip draft PRs', async () => {
      const forge = seedForge([pr(10, { draft: true }), pr(11)]);
      mockForgeFor.mockReturnValue(forge);

      await runRefreshAfterRelease({ projectDir: '/p' });

      expect(markedStale(forge)).toEqual([11]);
    });

    it('should skip the standing PR by head ref', async () => {
      const forge = seedForge([pr(10, { headRef: 'release/next' }), pr(11)]);
      mockForgeFor.mockReturnValue(forge);

      await runRefreshAfterRelease({ projectDir: '/p' });

      expect(markedStale(forge)).toEqual([11]);
    });

    it('should skip PRs without an existing preview comment', async () => {
      const forge = seedForge([pr(10), pr(11)], [11]);
      mockForgeFor.mockReturnValue(forge);

      await runRefreshAfterRelease({ projectDir: '/p' });

      expect(markedStale(forge)).toEqual([11]);
      expect(forge.createdComments).toEqual([]);
    });

    it('should not edit a marker comment a human wrote', async () => {
      const forge = createFakeForge({
        openPullRequests: [pr(10)],
        comments: [{ id: 10, prNumber: 10, body: previewBody(10), user: { login: 'alice', type: 'User' } }],
      });
      mockForgeFor.mockReturnValue(forge);

      await runRefreshAfterRelease({ projectDir: '/p' });

      expect(forge.updatedComments).toEqual([]);
    });

    it('should leave a preview that is already marked stale untouched', async () => {
      const forge = seedForge([pr(10)]);
      mockForgeFor.mockReturnValue(forge);

      await runRefreshAfterRelease({ projectDir: '/p' });
      await runRefreshAfterRelease({ projectDir: '/p' });

      expect(forge.updatedComments).toHaveLength(1);
    });

    it('should cap the number of marked PRs at 50 and warn', async () => {
      const { warn } = await import('@releasekit/core');
      const forge = seedForge(Array.from({ length: 55 }, (_, i) => pr(i + 1)));
      const findComment = vi.spyOn(forge, 'findComment');
      mockForgeFor.mockReturnValue(forge);

      await runRefreshAfterRelease({ projectDir: '/p' });

      expect(markedStale(forge)).toHaveLength(50);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('More than 50'));
      // Probing stops one past the cap rather than checking every open PR's comments.
      expect(findComment).toHaveBeenCalledTimes(51);
    });

    it('should continue marking the remaining PRs when one update throws', async () => {
      const { warn } = await import('@releasekit/core');
      const forge = seedForge([pr(10), pr(11), pr(12)]);
      const update = forge.updateComment.bind(forge);
      vi.spyOn(forge, 'updateComment').mockImplementation(async (id, body) => {
        if (id === 11) {
          throw new Error('boom');
        }
        await update(id, body);
      });
      mockForgeFor.mockReturnValue(forge);

      await runRefreshAfterRelease({ projectDir: '/p' });

      expect(markedStale(forge)).toEqual([10, 12]);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('PR #11'));
    });

    it('should not throw when the entire feeder refresh fails', async () => {
      const forge = seedForge([pr(10)]);
      vi.spyOn(forge, 'listOpenPullRequests').mockRejectedValue(new Error('rate limited'));
      mockForgeFor.mockReturnValue(forge);

      await expect(runRefreshAfterRelease({ projectDir: '/p' })).resolves.toBeUndefined();
    });

    it('should skip the feeder refresh when refreshAfterRelease is off', async () => {
      mockLoadCIConfig.mockReturnValue({
        releaseStrategy: 'direct',
        prPreview: { enabled: true, refreshAfterRelease: false },
      });
      mockForgeFor.mockReturnValue(seedForge([pr(10)]));

      await runRefreshAfterRelease({ projectDir: '/p' });

      expect(mockForgeFor).not.toHaveBeenCalled();
    });

    it('should skip the feeder refresh when previews are disabled', async () => {
      mockLoadCIConfig.mockReturnValue({
        releaseStrategy: 'direct',
        prPreview: { enabled: false, refreshAfterRelease: true },
      });
      mockForgeFor.mockReturnValue(seedForge([pr(10)]));

      await runRefreshAfterRelease({ projectDir: '/p' });

      expect(mockForgeFor).not.toHaveBeenCalled();
    });

    it('should warn and skip the feeder refresh when no token is present', async () => {
      const { warn } = await import('@releasekit/core');
      mockGetGitHubContext.mockReturnValue({ ...context, token: null });

      await runRefreshAfterRelease({ projectDir: '/p' });

      expect(mockForgeFor).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('no GitHub token'));
    });
  });

  describe('standing-PR reconcile', () => {
    it('should not reconcile in direct mode', async () => {
      const forge = seedForge([pr(10)]);
      mockForgeFor.mockReturnValue(forge);

      await runRefreshAfterRelease({ projectDir: '/p' });

      expect(mockRunStandingPRUpdate).not.toHaveBeenCalled();
      expect(markedStale(forge)).toEqual([10]); // feeders are still marked
    });

    it('should reconcile the standing PR before marking previews in standing-pr mode', async () => {
      mockLoadCIConfig.mockReturnValue({
        releaseStrategy: 'standing-pr',
        prPreview: { enabled: true, refreshAfterRelease: true },
      });
      const forge = seedForge([pr(10)]);
      const update = vi.spyOn(forge, 'updateComment');
      mockForgeFor.mockReturnValue(forge);

      await runRefreshAfterRelease({ projectDir: '/p' });

      expect(mockRunStandingPRUpdate).toHaveBeenCalledWith(expect.objectContaining({ reconcile: true }));
      expect(mockRunStandingPRUpdate.mock.invocationCallOrder[0]).toBeLessThan(update.mock.invocationCallOrder[0]);
    });

    it('should propagate a reconcile failure and not mark previews', async () => {
      mockLoadCIConfig.mockReturnValue({
        releaseStrategy: 'standing-pr',
        prPreview: { enabled: true, refreshAfterRelease: true },
      });
      const forge = seedForge([pr(10)]);
      mockForgeFor.mockReturnValue(forge);
      mockRunStandingPRUpdate.mockRejectedValue(new Error('reconcile failed'));

      await expect(runRefreshAfterRelease({ projectDir: '/p' })).rejects.toThrow('reconcile failed');
      expect(forge.updatedComments).toEqual([]);
    });
  });
});

describe('refreshFeederPreviews', () => {
  let dir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    dir = mkdtempSync(join(tmpdir(), 'rk-refresh-'));
    mockLoadCIConfig.mockReturnValue({
      releaseStrategy: 'standing-pr',
      prPreview: { enabled: true, refreshAfterRelease: true },
    });
    mockGetGitHubContext.mockReturnValue(context);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(dir, { recursive: true, force: true });
  });

  it("should mark a feeder PR's preview stale inside a standing-PR publish job", async () => {
    const eventPath = join(dir, 'event.json');
    writeFileSync(
      eventPath,
      JSON.stringify({
        action: 'closed',
        pull_request: { number: 99, merged: true, head: { ref: 'release/next' }, base: { ref: 'main' } },
      }),
    );
    vi.stubEnv('GITHUB_EVENT_NAME', 'pull_request');
    vi.stubEnv('GITHUB_EVENT_PATH', eventPath);
    const forge = seedForge([pr(99, { headRef: 'release/next' }), pr(10)], [10]);
    mockForgeFor.mockReturnValue(forge);
    const { refreshFeederPreviews } = await import('../../src/preview/refresh.js');

    await refreshFeederPreviews({ projectDir: dir });

    expect(markedStale(forge)).toEqual([10]);
  });

  it('should never throw, so the orchestrator can call it without a guard', async () => {
    mockLoadCIConfig.mockImplementation(() => {
      throw new Error('config parse error');
    });
    const { refreshFeederPreviews } = await import('../../src/preview/refresh.js');

    await expect(refreshFeederPreviews({ projectDir: dir })).resolves.toBeUndefined();
  });
});
