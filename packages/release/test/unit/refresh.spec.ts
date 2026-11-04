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
  return { number, headRef: `feat/pr-${number}`, baseRef: 'main', ...overrides };
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
      prPreview: { enabled: true, markStaleAfterRelease: true },
    });
    mockGetGitHubContext.mockReturnValue(context);
    mockRunStandingPRUpdate.mockResolvedValue({ action: 'noop' });
    vi.stubEnv('GITHUB_BASE_REF', '');
    vi.stubEnv('GITHUB_REF', 'refs/heads/main');

    const mod = await import('../../src/preview/refresh.js');
    runRefreshAfterRelease = mod.runRefreshAfterRelease;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('feeder-PR stale previews', () => {
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

    it('should skip PRs into a branch other than the pushed one', async () => {
      const forge = seedForge([pr(10, { baseRef: 'feat/a' }), pr(11)]);
      mockForgeFor.mockReturnValue(forge);

      await runRefreshAfterRelease({ projectDir: '/p' });

      expect(markedStale(forge)).toEqual([11]);
    });

    it("should take the released branch from a PR event's base ref", async () => {
      vi.stubEnv('GITHUB_BASE_REF', 'develop');
      vi.stubEnv('GITHUB_REF', 'refs/pull/5/merge');
      const forge = seedForge([pr(10), pr(11, { baseRef: 'develop' })]);
      mockForgeFor.mockReturnValue(forge);

      await runRefreshAfterRelease({ projectDir: '/p' });

      expect(markedStale(forge)).toEqual([11]);
    });

    it('should mark previews on every base branch when the released branch is unknown', async () => {
      vi.stubEnv('GITHUB_REF', 'refs/tags/v1.0.0');
      const forge = seedForge([pr(10, { baseRef: 'feat/a' }), pr(11)]);
      mockForgeFor.mockReturnValue(forge);

      await runRefreshAfterRelease({ projectDir: '/p' });

      expect(markedStale(forge)).toEqual([10, 11]);
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

    it('should still mark a preview whose changelog quotes the stale marker', async () => {
      const body = `${MARKER}\n\n<details>\n<summary>fix: handle ${STALE_MARKER} in bodies</summary>\n</details>`;
      const forge = createFakeForge({ openPullRequests: [pr(10)], comments: [{ id: 10, prNumber: 10, body }] });
      mockForgeFor.mockReturnValue(forge);

      await runRefreshAfterRelease({ projectDir: '/p' });

      expect(forge.comments.find((c) => c.id === 10)?.body).toContain('> **Stale:**');
    });

    it('should mark each preview before reading the next, so a preview re-posted meanwhile is kept', async () => {
      const forge = seedForge([pr(10), pr(11)]);
      const fresh = `${MARKER}\n\nfresh preview for #10`;
      const find = forge.findComment.bind(forge);
      vi.spyOn(forge, 'findComment').mockImplementation(async (prNumber, marker) => {
        if (prNumber === 11) {
          await forge.updateComment(10, fresh); // PR #10's preview workflow runs mid-sweep
        }
        return find(prNumber, marker);
      });
      mockForgeFor.mockReturnValue(forge);

      await runRefreshAfterRelease({ projectDir: '/p' });

      expect(forge.comments.find((c) => c.id === 10)?.body).toBe(fresh);
      expect(markedStale(forge)).toEqual([10, 11]);
    });

    it("should drop the preview body rather than exceed GitHub's comment length limit", async () => {
      const body = `${MARKER}\n\n${'x'.repeat(65_536 - MARKER.length - 2)}`;
      const forge = createFakeForge({ openPullRequests: [pr(10)], comments: [{ id: 10, prNumber: 10, body }] });
      mockForgeFor.mockReturnValue(forge);

      await runRefreshAfterRelease({ projectDir: '/p' });

      const marked = forge.comments.find((c) => c.id === 10)?.body ?? '';
      expect(marked.startsWith(`${MARKER}\n\n${STALE_MARKER}\n> **Stale:**`)).toBe(true);
      expect(marked).not.toContain('xxx');
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

    it('should count already-stale previews toward the cap, so a repeat run stays bounded', async () => {
      const forge = seedForge(Array.from({ length: 55 }, (_, i) => pr(i + 1)));
      mockForgeFor.mockReturnValue(forge);
      await runRefreshAfterRelease({ projectDir: '/p' });
      const findComment = vi.spyOn(forge, 'findComment');

      await runRefreshAfterRelease({ projectDir: '/p' });

      expect(findComment).toHaveBeenCalledTimes(51);
      expect(markedStale(forge)).toHaveLength(50);
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

    it('should not throw when the whole sweep fails', async () => {
      const forge = seedForge([pr(10)]);
      vi.spyOn(forge, 'listOpenPullRequests').mockRejectedValue(new Error('rate limited'));
      mockForgeFor.mockReturnValue(forge);

      await expect(runRefreshAfterRelease({ projectDir: '/p' })).resolves.toBeUndefined();
    });

    it('should not mark previews when markStaleAfterRelease is off', async () => {
      mockLoadCIConfig.mockReturnValue({
        releaseStrategy: 'direct',
        prPreview: { enabled: true, markStaleAfterRelease: false },
      });
      mockForgeFor.mockReturnValue(seedForge([pr(10)]));

      await runRefreshAfterRelease({ projectDir: '/p' });

      expect(mockForgeFor).not.toHaveBeenCalled();
    });

    it('should not mark previews when previews are disabled', async () => {
      mockLoadCIConfig.mockReturnValue({
        releaseStrategy: 'direct',
        prPreview: { enabled: false, markStaleAfterRelease: true },
      });
      mockForgeFor.mockReturnValue(seedForge([pr(10)]));

      await runRefreshAfterRelease({ projectDir: '/p' });

      expect(mockForgeFor).not.toHaveBeenCalled();
    });

    it('should warn and not mark previews when no token is present', async () => {
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
        prPreview: { enabled: true, markStaleAfterRelease: true },
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
        prPreview: { enabled: true, markStaleAfterRelease: true },
      });
      const forge = seedForge([pr(10)]);
      mockForgeFor.mockReturnValue(forge);
      mockRunStandingPRUpdate.mockRejectedValue(new Error('reconcile failed'));

      await expect(runRefreshAfterRelease({ projectDir: '/p' })).rejects.toThrow('reconcile failed');
      expect(forge.updatedComments).toEqual([]);
    });
  });
});

describe('markFeederPreviewsStale', () => {
  let dir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    dir = mkdtempSync(join(tmpdir(), 'rk-refresh-'));
    mockLoadCIConfig.mockReturnValue({
      releaseStrategy: 'standing-pr',
      prPreview: { enabled: true, markStaleAfterRelease: true },
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
    vi.stubEnv('GITHUB_BASE_REF', 'main');
    vi.stubEnv('GITHUB_REF', 'refs/heads/main');
    const forge = seedForge([pr(99, { headRef: 'release/next' }), pr(10)], [10]);
    mockForgeFor.mockReturnValue(forge);
    const { markFeederPreviewsStale } = await import('../../src/preview/refresh.js');

    await markFeederPreviewsStale({ projectDir: dir });

    expect(markedStale(forge)).toEqual([10]);
  });

  it('should never throw, so the orchestrator can call it without a guard', async () => {
    mockLoadCIConfig.mockImplementation(() => {
      throw new Error('config parse error');
    });
    const { markFeederPreviewsStale } = await import('../../src/preview/refresh.js');

    await expect(markFeederPreviewsStale({ projectDir: dir })).resolves.toBeUndefined();
  });
});
