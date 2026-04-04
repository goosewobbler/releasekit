import { describe, expect, it, vi } from 'vitest';
import { fetchPRLabels, findPreviewComment, postOrUpdateComment } from '../../src/preview-github.js';

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
