import type { CIConfig } from '@releasekit/config';
import { createFakeForge, type FakeForge, type OpenPullRequest } from '@releasekit/forge';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MARKER } from '../../src/github.js';
import { markFeederPreviewsStale } from '../../src/preview/stale.js';

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

const STALE_LINE = '<!-- releasekit-preview-stale -->';

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
  return forge.updatedComments.filter((c) => c.body.includes(STALE_LINE)).map((c) => c.commentId);
}

function bodyOf(forge: FakeForge, id: number): string {
  return forge.comments.find((c) => c.id === id)?.body ?? '';
}

function ciConfig(overrides: Partial<CIConfig> = {}): CIConfig {
  return {
    releaseStrategy: 'direct',
    prPreview: { enabled: true, markStaleAfterRelease: true },
    ...overrides,
  } as CIConfig;
}

const options = { ciConfig: ciConfig(), branch: 'main' };

describe('markFeederPreviewsStale', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetGitHubContext.mockReturnValue({ owner: 'owner', repo: 'repo', token: 'tok', sha: null });
  });

  it('should mark each preview stale in place, with the preview kept below', async () => {
    const forge = seedForge([pr(10), pr(11)]);
    mockForgeFor.mockReturnValue(forge);

    await markFeederPreviewsStale(options);

    expect(forge.createdComments).toEqual([]);
    expect(markedStale(forge)).toEqual([10, 11]);
    expect(bodyOf(forge, 10).startsWith(`${MARKER}\n\n${STALE_LINE}\n> **Stale:**`)).toBe(true);
    expect(bodyOf(forge, 10).endsWith(previewBody(10).slice(MARKER.length))).toBe(true);
  });

  it('should skip PRs into a branch the release did not move', async () => {
    const forge = seedForge([pr(10, { baseRef: 'feat/a' }), pr(11)]);
    mockForgeFor.mockReturnValue(forge);

    await markFeederPreviewsStale(options);

    expect(markedStale(forge)).toEqual([11]);
  });

  it('should skip the standing PR by head ref', async () => {
    const forge = seedForge([pr(10, { headRef: 'release/next' }), pr(11)]);
    mockForgeFor.mockReturnValue(forge);

    await markFeederPreviewsStale(options);

    expect(markedStale(forge)).toEqual([11]);
  });

  it('should skip PRs without an existing preview comment', async () => {
    const forge = seedForge([pr(10), pr(11)], [11]);
    mockForgeFor.mockReturnValue(forge);

    await markFeederPreviewsStale(options);

    expect(markedStale(forge)).toEqual([11]);
    expect(forge.createdComments).toEqual([]);
  });

  it('should not edit a marker comment a human wrote', async () => {
    const forge = createFakeForge({
      openPullRequests: [pr(10)],
      comments: [{ id: 10, prNumber: 10, body: previewBody(10), user: { login: 'alice', type: 'User' } }],
    });
    mockForgeFor.mockReturnValue(forge);

    await markFeederPreviewsStale(options);

    expect(forge.updatedComments).toEqual([]);
  });

  it('should leave a preview already marked stale untouched', async () => {
    const forge = seedForge([pr(10)]);
    mockForgeFor.mockReturnValue(forge);

    await markFeederPreviewsStale(options);
    await markFeederPreviewsStale(options);

    expect(forge.updatedComments).toHaveLength(1);
  });

  it('should still mark a preview whose changelog quotes the stale marker line', async () => {
    const body = `${MARKER}\n\n<details>\n<summary>fix: handle ${STALE_LINE} in bodies</summary>\n</details>`;
    const forge = createFakeForge({ openPullRequests: [pr(10)], comments: [{ id: 10, prNumber: 10, body }] });
    mockForgeFor.mockReturnValue(forge);

    await markFeederPreviewsStale(options);

    expect(bodyOf(forge, 10).startsWith(`${MARKER}\n\n${STALE_LINE}`)).toBe(true);
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

    await markFeederPreviewsStale(options);

    expect(bodyOf(forge, 10)).toBe(fresh);
    expect(markedStale(forge)).toEqual([10, 11]);
  });

  it("should drop the preview body rather than exceed GitHub's comment length limit", async () => {
    const body = `${MARKER}\n\n${'x'.repeat(65_536 - MARKER.length - 2)}`;
    const forge = createFakeForge({ openPullRequests: [pr(10)], comments: [{ id: 10, prNumber: 10, body }] });
    mockForgeFor.mockReturnValue(forge);

    await markFeederPreviewsStale(options);

    expect(bodyOf(forge, 10).startsWith(`${MARKER}\n\n${STALE_LINE}\n> **Stale:**`)).toBe(true);
    expect(bodyOf(forge, 10)).not.toContain('xxx');
  });

  it('should check only the 50 most recently updated PRs into the branch, and warn', async () => {
    const { warn } = await import('@releasekit/core');
    const forge = seedForge(Array.from({ length: 55 }, (_, i) => pr(i + 1)));
    const findComment = vi.spyOn(forge, 'findComment');
    mockForgeFor.mockReturnValue(forge);

    await markFeederPreviewsStale(options);

    expect(markedStale(forge)).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
    expect(findComment).toHaveBeenCalledTimes(50);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('More than 50'));
  });

  it('should still warn when the standing PR is among the most recently updated', async () => {
    const { warn } = await import('@releasekit/core');
    const forge = seedForge([pr(99, { headRef: 'release/next' }), ...Array.from({ length: 51 }, (_, i) => pr(i + 1))]);
    mockForgeFor.mockReturnValue(forge);

    await markFeederPreviewsStale(options);

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('More than 50'));
  });

  it('should count PRs without a preview toward the cap', async () => {
    const forge = seedForge(
      Array.from({ length: 60 }, (_, i) => pr(i + 1)),
      [55],
    );
    const findComment = vi.spyOn(forge, 'findComment');
    mockForgeFor.mockReturnValue(forge);

    await markFeederPreviewsStale(options);

    expect(findComment).toHaveBeenCalledTimes(50);
    expect(markedStale(forge)).toEqual([]);
  });

  it('should keep going when reading or updating one PR fails', async () => {
    const { warn } = await import('@releasekit/core');
    const forge = seedForge([pr(10), pr(11), pr(12)]);
    const find = forge.findComment.bind(forge);
    vi.spyOn(forge, 'findComment').mockImplementation(async (prNumber, marker) => {
      if (prNumber === 10) {
        throw new Error('secondary rate limit');
      }
      return find(prNumber, marker);
    });
    const update = forge.updateComment.bind(forge);
    vi.spyOn(forge, 'updateComment').mockImplementation(async (id, body) => {
      if (id === 11) {
        throw new Error('boom');
      }
      await update(id, body);
    });
    mockForgeFor.mockReturnValue(forge);

    await markFeederPreviewsStale(options);

    expect(markedStale(forge)).toEqual([12]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('PR #10'));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('PR #11'));
  });

  it('should stop at the first refused edit, with one warning', async () => {
    const { warn } = await import('@releasekit/core');
    const forge = seedForge([pr(10), pr(11), pr(12)]);
    const update = vi
      .spyOn(forge, 'updateComment')
      .mockRejectedValue(Object.assign(new Error('Resource not accessible by integration'), { status: 403 }));
    mockForgeFor.mockReturnValue(forge);

    await markFeederPreviewsStale(options);

    expect(update).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('pull-requests: write'));
  });

  it("should stop at a secondary rate limit without blaming the token's permissions", async () => {
    const { warn } = await import('@releasekit/core');
    const forge = seedForge([pr(10), pr(11)]);
    const update = vi
      .spyOn(forge, 'updateComment')
      .mockRejectedValue(Object.assign(new Error('You have exceeded a secondary rate limit'), { status: 403 }));
    mockForgeFor.mockReturnValue(forge);

    await markFeederPreviewsStale(options);

    expect(update).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('secondary rate limit'));
    expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('pull-requests: write'));
  });

  it('should recognise a stale mark after a web-UI edit turned its line endings into CRLF', async () => {
    const body = `${MARKER}\r\n\r\n${STALE_LINE}\r\n> **Stale:** notice\r\n\r\nedited preview`;
    const forge = createFakeForge({ openPullRequests: [pr(10)], comments: [{ id: 10, prNumber: 10, body }] });
    mockForgeFor.mockReturnValue(forge);

    await markFeederPreviewsStale(options);

    expect(forge.updatedComments).toEqual([]);
  });

  it('should not throw when listing open PRs fails', async () => {
    const forge = seedForge([pr(10)]);
    vi.spyOn(forge, 'listOpenPullRequests').mockRejectedValue(new Error('rate limited'));
    mockForgeFor.mockReturnValue(forge);

    await expect(markFeederPreviewsStale(options)).resolves.toBeUndefined();
  });

  it('should never throw, so the orchestrator can call it without a guard', async () => {
    mockForgeFor.mockImplementation(() => {
      throw new Error('bad repository slug');
    });

    await expect(markFeederPreviewsStale(options)).resolves.toBeUndefined();
  });

  it('should do nothing when markStaleAfterRelease is off', async () => {
    await markFeederPreviewsStale({
      branch: 'main',
      ciConfig: ciConfig({ prPreview: { enabled: true, markStaleAfterRelease: false } }),
    });

    expect(mockForgeFor).not.toHaveBeenCalled();
  });

  it('should do nothing when previews are disabled', async () => {
    await markFeederPreviewsStale({
      branch: 'main',
      ciConfig: ciConfig({ prPreview: { enabled: false, markStaleAfterRelease: true } }),
    });

    expect(mockForgeFor).not.toHaveBeenCalled();
  });

  it('should warn and do nothing when no token is present', async () => {
    const { warn } = await import('@releasekit/core');
    mockGetGitHubContext.mockReturnValue({ owner: 'owner', repo: 'repo', token: null, sha: null });

    await markFeederPreviewsStale(options);

    expect(mockForgeFor).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('no GitHub token'));
  });
});
