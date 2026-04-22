import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  fetchPRLabels,
  findMergedPRsSinceLastRelease,
  findPreviewComment,
  postOrUpdateComment,
} from '../../src/preview-github.js';

vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
}));

function createMockOctokit(comments: { id: number; body: string }[] = []) {
  const listComments = vi.fn();
  const createComment = vi.fn().mockResolvedValue({});
  const updateComment = vi.fn().mockResolvedValue({});
  const getIssue = vi.fn().mockResolvedValue({ data: { labels: [] } });

  const paginate = {
    iterator: vi.fn().mockReturnValue({
      async *[Symbol.asyncIterator]() {
        yield { data: comments };
      },
    }),
  };

  return {
    octokit: {
      paginate,
      rest: {
        issues: {
          listComments,
          createComment,
          updateComment,
          get: getIssue,
        },
      },
    } as unknown as Parameters<typeof findPreviewComment>[0],
    mocks: { listComments, createComment, updateComment, getIssue, paginate },
  };
}

describe('findMergedPRsSinceLastRelease', () => {
  afterEach(() => vi.clearAllMocks());

  function createPRLookupOctokit(prsByCommit: Record<string, number[]>) {
    return {
      rest: {
        repos: {
          listPullRequestsAssociatedWithCommit: vi.fn().mockImplementation(({ commit_sha }) => ({
            data: (prsByCommit[commit_sha] ?? []).map((n) => ({ number: n, merged_at: '2024-01-01' })),
          })),
        },
      },
    } as unknown as Parameters<typeof findMergedPRsSinceLastRelease>[0];
  }

  it('should return PR numbers from merge commits since last tag', async () => {
    const { execSync } = await import('node:child_process');
    vi.mocked(execSync)
      .mockReturnValueOnce('v1.0.0\n') // git describe
      .mockReturnValueOnce('abc123\ndef456\n'); // git log merges

    const octokit = createPRLookupOctokit({ abc123: [10], def456: [20] });
    const result = await findMergedPRsSinceLastRelease(octokit, 'owner', 'repo', '/project');

    expect(result).toEqual(expect.arrayContaining([10, 20]));
    expect(result).toHaveLength(2);
  });

  it('should deduplicate PR numbers across merge commits', async () => {
    const { execSync } = await import('node:child_process');
    vi.mocked(execSync).mockReturnValueOnce('v1.0.0\n').mockReturnValueOnce('abc123\ndef456\n');

    const octokit = createPRLookupOctokit({ abc123: [10], def456: [10] });
    const result = await findMergedPRsSinceLastRelease(octokit, 'owner', 'repo', '/project');

    expect(result).toEqual([10]);
  });

  it('should fall back to last 50 merge commits when no tags exist', async () => {
    const { execSync } = await import('node:child_process');
    vi.mocked(execSync)
      .mockImplementationOnce(() => {
        throw new Error('no tags');
      }) // git describe fails
      .mockReturnValueOnce('abc123\n'); // git log with -50

    const octokit = createPRLookupOctokit({ abc123: [99] });
    const result = await findMergedPRsSinceLastRelease(octokit, 'owner', 'repo', '/project');

    expect(result).toEqual([99]);
    const calls = vi.mocked(execSync).mock.calls;
    expect(calls[1][0]).toContain('-50');
  });

  it('should return empty array when no merge commits in range', async () => {
    const { execSync } = await import('node:child_process');
    vi.mocked(execSync).mockReturnValueOnce('v1.0.0\n').mockReturnValueOnce('');

    const octokit = createPRLookupOctokit({});
    const result = await findMergedPRsSinceLastRelease(octokit, 'owner', 'repo', '/project');

    expect(result).toEqual([]);
  });

  it('should return empty array when git log throws', async () => {
    const { execSync } = await import('node:child_process');
    vi.mocked(execSync)
      .mockReturnValueOnce('v1.0.0\n')
      .mockImplementationOnce(() => {
        throw new Error('git error');
      });

    const octokit = createPRLookupOctokit({});
    const result = await findMergedPRsSinceLastRelease(octokit, 'owner', 'repo', '/project');

    expect(result).toEqual([]);
  });
});

describe('findPreviewComment', () => {
  it('should return comment ID when marker is found', async () => {
    const { octokit } = createMockOctokit([
      { id: 1, body: 'Some other comment' },
      { id: 2, body: '<!-- releasekit-preview -->\n## Release Preview' },
    ]);

    const result = await findPreviewComment(octokit, 'owner', 'repo', 1);
    expect(result).toBe(2);
  });

  it('should return null when no marker comment exists', async () => {
    const { octokit } = createMockOctokit([
      { id: 1, body: 'Regular comment' },
      { id: 2, body: 'Another comment' },
    ]);

    const result = await findPreviewComment(octokit, 'owner', 'repo', 1);
    expect(result).toBeNull();
  });

  it('should return null when no comments exist', async () => {
    const { octokit } = createMockOctokit([]);

    const result = await findPreviewComment(octokit, 'owner', 'repo', 1);
    expect(result).toBeNull();
  });
});

describe('postOrUpdateComment', () => {
  it('should create a new comment when none exists', async () => {
    const { octokit, mocks } = createMockOctokit([]);
    const body = '<!-- releasekit-preview -->\n## Release Preview';

    await postOrUpdateComment(octokit, 'owner', 'repo', 1, body);

    expect(mocks.createComment).toHaveBeenCalledWith({
      owner: 'owner',
      repo: 'repo',
      issue_number: 1,
      body,
    });
    expect(mocks.updateComment).not.toHaveBeenCalled();
  });

  it('should update existing comment when marker is found', async () => {
    const { octokit, mocks } = createMockOctokit([{ id: 42, body: '<!-- releasekit-preview -->\nOld content' }]);
    const body = '<!-- releasekit-preview -->\n## Release Preview (updated)';

    await postOrUpdateComment(octokit, 'owner', 'repo', 1, body);

    expect(mocks.updateComment).toHaveBeenCalledWith({
      owner: 'owner',
      repo: 'repo',
      comment_id: 42,
      body,
    });
    expect(mocks.createComment).not.toHaveBeenCalled();
  });
});

describe('fetchPRLabels', () => {
  it('should return label names from PR', async () => {
    const { octokit, mocks } = createMockOctokit();
    mocks.getIssue.mockResolvedValue({
      data: { labels: [{ name: 'release:stable' }, { name: 'bug' }] },
    });

    const labels = await fetchPRLabels(octokit, 'owner', 'repo', 1);
    expect(labels).toEqual(['release:stable', 'bug']);
  });

  it('should handle string labels', async () => {
    const { octokit, mocks } = createMockOctokit();
    mocks.getIssue.mockResolvedValue({
      data: { labels: ['release:stable', 'enhancement'] },
    });

    const labels = await fetchPRLabels(octokit, 'owner', 'repo', 1);
    expect(labels).toEqual(['release:stable', 'enhancement']);
  });

  it('should return empty array when no labels', async () => {
    const { octokit, mocks } = createMockOctokit();
    mocks.getIssue.mockResolvedValue({ data: { labels: [] } });

    const labels = await fetchPRLabels(octokit, 'owner', 'repo', 1);
    expect(labels).toEqual([]);
  });
});
