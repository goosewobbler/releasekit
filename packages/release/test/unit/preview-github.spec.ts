import { createFakeForge } from '@releasekit/forge';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  fetchPRLabels,
  findMergedPRsSinceLastRelease,
  findPreviewComment,
  findStandingPR,
  postOrUpdateComment,
} from '../../src/github.js';

vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(),
}));

describe('findMergedPRsSinceLastRelease', () => {
  afterEach(() => vi.clearAllMocks());

  function createPRLookupForge(prsByCommit: Record<string, number[]>) {
    const pullRequestsForCommit: Record<string, { number: number; mergedAt: string | null }[]> = {};
    for (const [sha, nums] of Object.entries(prsByCommit)) {
      pullRequestsForCommit[sha] = nums.map((n) => ({ number: n, mergedAt: '2024-01-01' }));
    }
    return createFakeForge({ pullRequestsForCommit });
  }

  it('should return PR numbers from merge commits since last tag', async () => {
    const { execFileSync } = await import('node:child_process');
    vi.mocked(execFileSync)
      .mockReturnValueOnce('v1.0.0\n') // git describe
      .mockReturnValueOnce('abc123\ndef456\n'); // git log

    const forge = createPRLookupForge({ abc123: [10], def456: [20] });
    const result = await findMergedPRsSinceLastRelease(forge, '/project');

    expect(result).toEqual(expect.arrayContaining([10, 20]));
    expect(result).toHaveLength(2);
  });

  it('should deduplicate PR numbers across merge commits', async () => {
    const { execFileSync } = await import('node:child_process');
    vi.mocked(execFileSync).mockReturnValueOnce('v1.0.0\n').mockReturnValueOnce('abc123\ndef456\n');

    const forge = createPRLookupForge({ abc123: [10], def456: [10] });
    const result = await findMergedPRsSinceLastRelease(forge, '/project');

    expect(result).toEqual([10]);
  });

  it('should fall back to last 50 merge commits when no tags exist', async () => {
    const { execFileSync } = await import('node:child_process');
    vi.mocked(execFileSync)
      .mockImplementationOnce(() => {
        throw new Error('no tags');
      }) // git describe fails
      .mockReturnValueOnce('abc123\n'); // git log with -50

    const forge = createPRLookupForge({ abc123: [99] });
    const result = await findMergedPRsSinceLastRelease(forge, '/project');

    expect(result).toEqual([99]);
    const calls = vi.mocked(execFileSync).mock.calls;
    expect(calls[1][1]).toContain('-50');
  });

  it('should return empty array when no merge commits in range', async () => {
    const { execFileSync } = await import('node:child_process');
    vi.mocked(execFileSync).mockReturnValueOnce('v1.0.0\n').mockReturnValueOnce('');

    const forge = createPRLookupForge({});
    const result = await findMergedPRsSinceLastRelease(forge, '/project');

    expect(result).toEqual([]);
  });

  it('should return empty array when git log throws', async () => {
    const { execFileSync } = await import('node:child_process');
    vi.mocked(execFileSync)
      .mockReturnValueOnce('v1.0.0\n')
      .mockImplementationOnce(() => {
        throw new Error('git error');
      });

    const forge = createPRLookupForge({});
    const result = await findMergedPRsSinceLastRelease(forge, '/project');

    expect(result).toEqual([]);
  });
});

describe('findPreviewComment', () => {
  it('should return comment ID when marker is found', async () => {
    const forge = createFakeForge({
      comments: [
        { id: 1, body: 'Some other comment' },
        { id: 2, body: '<!-- releasekit-preview -->\n## Release Preview' },
      ],
    });

    const result = await findPreviewComment(forge, 1);
    expect(result).toBe(2);
  });

  it('should return null when no marker comment exists', async () => {
    const forge = createFakeForge({
      comments: [
        { id: 1, body: 'Regular comment' },
        { id: 2, body: 'Another comment' },
      ],
    });

    const result = await findPreviewComment(forge, 1);
    expect(result).toBeNull();
  });

  it('should return null when no comments exist', async () => {
    const forge = createFakeForge({ comments: [] });

    const result = await findPreviewComment(forge, 1);
    expect(result).toBeNull();
  });
});

describe('postOrUpdateComment', () => {
  it('should create a new comment when none exists', async () => {
    const forge = createFakeForge({ comments: [] });
    const body = '<!-- releasekit-preview -->\n## Release Preview';

    await postOrUpdateComment(forge, 1, body);

    expect(forge.createdComments).toEqual([{ prNumber: 1, body }]);
    expect(forge.updatedComments).toEqual([]);
  });

  it('should update existing comment when marker is found', async () => {
    const forge = createFakeForge({ comments: [{ id: 42, body: '<!-- releasekit-preview -->\nOld content' }] });
    const body = '<!-- releasekit-preview -->\n## Release Preview (updated)';

    await postOrUpdateComment(forge, 1, body);

    expect(forge.updatedComments).toEqual([{ commentId: 42, body }]);
    expect(forge.createdComments).toEqual([]);
  });
});

describe('fetchPRLabels', () => {
  function forgeWithLabels(labels: string[]) {
    return createFakeForge({ issues: { 1: { body: '', title: '', labels, isPullRequest: true } } });
  }

  it('should return label names from PR', async () => {
    const forge = forgeWithLabels(['channel:stable', 'bug']);

    const labels = await fetchPRLabels(forge, 1);
    expect(labels).toEqual(['channel:stable', 'bug']);
  });

  it('should handle string labels', async () => {
    const forge = forgeWithLabels(['channel:stable', 'enhancement']);

    const labels = await fetchPRLabels(forge, 1);
    expect(labels).toEqual(['channel:stable', 'enhancement']);
  });

  it('should return empty array when no labels', async () => {
    const forge = forgeWithLabels([]);

    const labels = await fetchPRLabels(forge, 1);
    expect(labels).toEqual([]);
  });
});

describe('findStandingPR', () => {
  it('should return the PR number and URL when found', async () => {
    const forge = createFakeForge({
      standingPR: { number: 42, url: 'https://github.com/owner/repo/pull/42', labels: [] },
    });
    const result = await findStandingPR(forge, undefined);
    expect(result).toEqual({ number: 42, url: 'https://github.com/owner/repo/pull/42' });
  });

  it('should return null when no open standing PR found', async () => {
    const forge = createFakeForge({ standingPR: null });
    const result = await findStandingPR(forge, undefined);
    expect(result).toBeNull();
  });

  it('should use the configured branch from ciConfig', async () => {
    const forge = createFakeForge({ standingPR: null });
    const spy = vi.spyOn(forge, 'findStandingPR');
    await findStandingPR(forge, { standingPr: { branch: 'release/staging' } } as Parameters<typeof findStandingPR>[1]);
    expect(spy).toHaveBeenCalledWith('release/staging');
  });

  it('should default to release/next when ciConfig has no standingPr', async () => {
    const forge = createFakeForge({ standingPR: null });
    const spy = vi.spyOn(forge, 'findStandingPR');
    await findStandingPR(forge, undefined);
    expect(spy).toHaveBeenCalledWith('release/next');
  });

  it('should return null when API throws', async () => {
    const forge = createFakeForge({ standingPR: null });
    vi.spyOn(forge, 'findStandingPR').mockRejectedValue(new Error('API error'));
    const result = await findStandingPR(forge, undefined);
    expect(result).toBeNull();
  });
});
