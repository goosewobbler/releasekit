import type { Octokit } from '@octokit/rest';
import { describe, expect, it, vi } from 'vitest';
import { forgeErrorStatus } from '../../src/errors.js';
import { createGitHubForge, GitHubForge } from '../../src/github.js';

/** A hand-built Octokit stand-in exposing only the surface GitHubForge touches. */
function makeOctokit() {
  const fns = {
    listPullRequestsAssociatedWithCommit: vi.fn(),
    createCommitStatus: vi.fn().mockResolvedValue({}),
    listReleases: vi.fn(),
    createRelease: vi.fn(),
    updateRelease: vi.fn(),
    getReleaseByTag: vi.fn(),
    getCollaboratorPermissionLevel: vi.fn(),
    pullsList: vi.fn(),
    pullsGet: vi.fn(),
    pullsCreate: vi.fn(),
    pullsUpdate: vi.fn().mockResolvedValue({}),
    pullsMerge: vi.fn().mockResolvedValue({}),
    issuesGet: vi.fn(),
    createComment: vi.fn().mockResolvedValue({}),
    updateComment: vi.fn().mockResolvedValue({}),
    createLabel: vi.fn().mockResolvedValue({}),
    setLabels: vi.fn().mockResolvedValue({}),
    iterator: vi.fn(),
  };
  const octokit = {
    rest: {
      repos: {
        listPullRequestsAssociatedWithCommit: fns.listPullRequestsAssociatedWithCommit,
        createCommitStatus: fns.createCommitStatus,
        listReleases: fns.listReleases,
        createRelease: fns.createRelease,
        updateRelease: fns.updateRelease,
        getReleaseByTag: fns.getReleaseByTag,
        getCollaboratorPermissionLevel: fns.getCollaboratorPermissionLevel,
      },
      pulls: {
        list: fns.pullsList,
        get: fns.pullsGet,
        create: fns.pullsCreate,
        update: fns.pullsUpdate,
        merge: fns.pullsMerge,
      },
      issues: {
        get: fns.issuesGet,
        createComment: fns.createComment,
        updateComment: fns.updateComment,
        listComments: { __ref: 'listComments' },
        listLabelsForRepo: { __ref: 'listLabelsForRepo' },
        createLabel: fns.createLabel,
        setLabels: fns.setLabels,
      },
    },
    paginate: { iterator: fns.iterator },
  } as unknown as Octokit;
  return { octokit, fns };
}

/** Build an async-iterable matching octokit.paginate.iterator's contract over the given pages. */
function pages<T>(...batches: T[][]) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const data of batches) yield { data };
    },
  };
}

const labelError = (code: string) =>
  Object.assign(new Error('422'), { status: 422, response: { data: { errors: [{ code }] } } });

describe('GitHubForge', () => {
  describe('createLabel idempotency', () => {
    it('should report a label as created on success', async () => {
      const { octokit, fns } = makeOctokit();
      fns.createLabel.mockResolvedValue({});
      const forge = new GitHubForge(octokit, 'o', 'r');
      expect(await forge.createLabel({ name: 'a', color: 'fff', description: 'd' })).toBe('created');
      expect(fns.createLabel).toHaveBeenCalledWith({
        owner: 'o',
        repo: 'r',
        name: 'a',
        color: 'fff',
        description: 'd',
      });
    });

    it('should treat an already_exists 422 as exists, not an error', async () => {
      const { octokit, fns } = makeOctokit();
      fns.createLabel.mockRejectedValue(labelError('already_exists'));
      const forge = new GitHubForge(octokit, 'o', 'r');
      expect(await forge.createLabel({ name: 'a', color: 'fff', description: 'd' })).toBe('exists');
    });

    it('should rethrow a 422 that is not already_exists (validation failure)', async () => {
      const { octokit, fns } = makeOctokit();
      fns.createLabel.mockRejectedValue(labelError('invalid'));
      const forge = new GitHubForge(octokit, 'o', 'r');
      await expect(forge.createLabel({ name: 'a', color: 'fff', description: 'd' })).rejects.toThrow();
    });

    it('should rethrow a non-422 createLabel error (auth / rate limit)', async () => {
      const { octokit, fns } = makeOctokit();
      fns.createLabel.mockRejectedValue(Object.assign(new Error('403'), { status: 403 }));
      const forge = new GitHubForge(octokit, 'o', 'r');
      await expect(forge.createLabel({ name: 'a', color: 'fff', description: 'd' })).rejects.toThrow();
    });
  });

  describe('getReleaseByTag', () => {
    it('should map a found release', async () => {
      const { octokit, fns } = makeOctokit();
      fns.getReleaseByTag.mockResolvedValue({ data: { id: 7, html_url: 'u', tag_name: 'v1' } });
      expect(await new GitHubForge(octokit, 'o', 'r').getReleaseByTag('v1')).toEqual({
        id: 7,
        url: 'u',
        tagName: 'v1',
      });
    });

    it('should return null when the release is not found (throws)', async () => {
      const { octokit, fns } = makeOctokit();
      fns.getReleaseByTag.mockRejectedValue(Object.assign(new Error('404'), { status: 404 }));
      expect(await new GitHubForge(octokit, 'o', 'r').getReleaseByTag('v1')).toBeNull();
    });
  });

  describe('findStandingPR', () => {
    it('should map the open PR, drop empty label names, and query the head branch', async () => {
      const { octokit, fns } = makeOctokit();
      fns.pullsList.mockResolvedValue({
        data: [{ number: 5, html_url: 'u', labels: ['a', { name: 'b' }, { name: '' }, { name: null }] }],
      });
      const forge = new GitHubForge(octokit, 'o', 'r');
      expect(await forge.findStandingPR('release/next')).toEqual({ number: 5, url: 'u', labels: ['a', 'b'] });
      expect(fns.pullsList).toHaveBeenCalledWith(
        expect.objectContaining({ owner: 'o', repo: 'r', head: 'o:release/next', state: 'open', per_page: 1 }),
      );
    });

    it('should return null when there is no open standing PR', async () => {
      const { octokit, fns } = makeOctokit();
      fns.pullsList.mockResolvedValue({ data: [] });
      expect(await new GitHubForge(octokit, 'o', 'r').findStandingPR('b')).toBeNull();
    });
  });

  describe('marker comments', () => {
    it('should return the first comment whose body starts with the marker', async () => {
      const { octokit, fns } = makeOctokit();
      fns.iterator.mockReturnValue(
        pages([
          { id: 1, body: 'nope' },
          { id: 2, body: 'MARK hello' },
        ]),
      );
      expect(await new GitHubForge(octokit, 'o', 'r').findComment(9, 'MARK')).toEqual({ id: 2, body: 'MARK hello' });
    });

    it('should update the existing marker comment on upsert (never stack a second)', async () => {
      const { octokit, fns } = makeOctokit();
      fns.iterator.mockReturnValue(pages([{ id: 2, body: 'MARK old' }]));
      await new GitHubForge(octokit, 'o', 'r').upsertMarkerComment(9, 'MARK', 'MARK new');
      expect(fns.updateComment).toHaveBeenCalledWith({ owner: 'o', repo: 'r', comment_id: 2, body: 'MARK new' });
      expect(fns.createComment).not.toHaveBeenCalled();
    });

    it('should create a new comment on upsert when none matches the marker', async () => {
      const { octokit, fns } = makeOctokit();
      fns.iterator.mockReturnValue(pages([{ id: 1, body: 'unrelated' }]));
      await new GitHubForge(octokit, 'o', 'r').upsertMarkerComment(9, 'MARK', 'MARK new');
      expect(fns.createComment).toHaveBeenCalledWith({ owner: 'o', repo: 'r', issue_number: 9, body: 'MARK new' });
      expect(fns.updateComment).not.toHaveBeenCalled();
    });
  });

  describe('getIssue', () => {
    it('should map body/title/labels and detect a pull request', async () => {
      const { octokit, fns } = makeOctokit();
      fns.issuesGet.mockResolvedValue({
        data: { body: 'b', title: 't', labels: ['x', { name: 'y' }], pull_request: {} },
      });
      expect(await new GitHubForge(octokit, 'o', 'r').getIssue(3)).toEqual({
        body: 'b',
        title: 't',
        labels: ['x', 'y'],
        isPullRequest: true,
      });
    });

    it('should default a null body to empty and report a plain issue as not a PR', async () => {
      const { octokit, fns } = makeOctokit();
      fns.issuesGet.mockResolvedValue({ data: { body: null, title: 't', labels: [] } });
      expect(await new GitHubForge(octokit, 'o', 'r').getIssue(3)).toEqual({
        body: '',
        title: 't',
        labels: [],
        isPullRequest: false,
      });
    });
  });

  describe('pull requests', () => {
    it('should map a created PR to {number,url}', async () => {
      const { octokit, fns } = makeOctokit();
      fns.pullsCreate.mockResolvedValue({ data: { number: 11, html_url: 'pr-url' } });
      const ref = await new GitHubForge(octokit, 'o', 'r').createPullRequest({
        title: 't',
        body: 'b',
        head: 'h',
        base: 'm',
      });
      expect(ref).toEqual({ number: 11, url: 'pr-url' });
      expect(fns.pullsCreate).toHaveBeenCalledWith({
        owner: 'o',
        repo: 'r',
        title: 't',
        body: 'b',
        head: 'h',
        base: 'm',
      });
    });

    it('should merge via the requested method', async () => {
      const { octokit, fns } = makeOctokit();
      await new GitHubForge(octokit, 'o', 'r').mergePullRequest(7, 'squash');
      expect(fns.pullsMerge).toHaveBeenCalledWith({ owner: 'o', repo: 'r', pull_number: 7, merge_method: 'squash' });
    });
  });

  describe('listReleases', () => {
    const full = (tag: string) =>
      Array.from({ length: 100 }, () => ({ tag_name: tag, draft: false, prerelease: false, body: 'b' }));

    it('should paginate until a short page and map fields', async () => {
      const { octokit, fns } = makeOctokit();
      fns.listReleases
        .mockResolvedValueOnce({ data: full('t') })
        .mockResolvedValueOnce({ data: [{ tag_name: 'last', draft: true, prerelease: false, body: null }] });
      const releases = await new GitHubForge(octokit, 'o', 'r').listReleases();
      expect(fns.listReleases).toHaveBeenCalledTimes(2);
      expect(releases).toHaveLength(101);
      expect(releases[100]).toEqual({ tagName: 'last', draft: true, prerelease: false, body: '' });
    });

    it('should stop at the 3-page cap when every page is full', async () => {
      const { octokit, fns } = makeOctokit();
      fns.listReleases.mockResolvedValue({ data: full('t') });
      await new GitHubForge(octokit, 'o', 'r').listReleases();
      expect(fns.listReleases).toHaveBeenCalledTimes(3);
    });
  });

  describe('remaining read/write operations', () => {
    it('should map PRs associated with a commit', async () => {
      const { octokit, fns } = makeOctokit();
      fns.listPullRequestsAssociatedWithCommit.mockResolvedValue({
        data: [
          { number: 1, merged_at: '2026-01-01' },
          { number: 2, merged_at: null },
        ],
      });
      expect(await new GitHubForge(octokit, 'o', 'r').listPullRequestsForCommit('sha')).toEqual([
        { number: 1, mergedAt: '2026-01-01' },
        { number: 2, mergedAt: null },
      ]);
      expect(fns.listPullRequestsAssociatedWithCommit).toHaveBeenCalledWith({
        owner: 'o',
        repo: 'r',
        commit_sha: 'sha',
      });
    });

    it('should list recently-closed PRs for the head branch, bounded by limit', async () => {
      const { octokit, fns } = makeOctokit();
      fns.pullsList.mockResolvedValue({ data: [{ number: 9, merged_at: '2026-01-02' }] });
      expect(await new GitHubForge(octokit, 'o', 'r').listRecentlyClosedPullRequests('release/next', 10)).toEqual([
        { number: 9, mergedAt: '2026-01-02' },
      ]);
      expect(fns.pullsList).toHaveBeenCalledWith(
        expect.objectContaining({
          head: 'o:release/next',
          state: 'closed',
          sort: 'updated',
          direction: 'desc',
          per_page: 10,
        }),
      );
    });

    it('should map a pull request to {body,labels}', async () => {
      const { octokit, fns } = makeOctokit();
      fns.pullsGet.mockResolvedValue({ data: { body: 'b', labels: [{ name: 'x' }] } });
      expect(await new GitHubForge(octokit, 'o', 'r').getPullRequest(4)).toEqual({ body: 'b', labels: ['x'] });
    });

    it('should update a pull request with the given changes', async () => {
      const { octokit, fns } = makeOctokit();
      await new GitHubForge(octokit, 'o', 'r').updatePullRequest(4, { state: 'closed' });
      expect(fns.pullsUpdate).toHaveBeenCalledWith({ owner: 'o', repo: 'r', pull_number: 4, state: 'closed' });
    });

    it('should create and update comments directly', async () => {
      const { octokit, fns } = makeOctokit();
      const forge = new GitHubForge(octokit, 'o', 'r');
      await forge.createComment(4, 'hi');
      await forge.updateComment(99, 'edited');
      expect(fns.createComment).toHaveBeenCalledWith({ owner: 'o', repo: 'r', issue_number: 4, body: 'hi' });
      expect(fns.updateComment).toHaveBeenCalledWith({ owner: 'o', repo: 'r', comment_id: 99, body: 'edited' });
    });

    it('should set labels and list label names', async () => {
      const { octokit, fns } = makeOctokit();
      const forge = new GitHubForge(octokit, 'o', 'r');
      await forge.setLabels(4, ['a', 'b']);
      expect(fns.setLabels).toHaveBeenCalledWith({ owner: 'o', repo: 'r', issue_number: 4, labels: ['a', 'b'] });

      fns.iterator.mockReturnValue(pages([{ name: 'a' }, { name: 'b' }]));
      expect(await forge.listLabelNames()).toEqual(['a', 'b']);
    });

    it('should set a commit status', async () => {
      const { octokit, fns } = makeOctokit();
      await new GitHubForge(octokit, 'o', 'r').setCommitStatus({
        sha: 's',
        state: 'success',
        description: 'd',
        context: 'c',
      });
      expect(fns.createCommitStatus).toHaveBeenCalledWith({
        owner: 'o',
        repo: 'r',
        sha: 's',
        state: 'success',
        description: 'd',
        context: 'c',
      });
    });

    it('should create a release with generate_release_notes mapped from generateReleaseNotes', async () => {
      const { octokit, fns } = makeOctokit();
      fns.createRelease.mockResolvedValue({ data: { id: 3, html_url: 'u', tag_name: 'v1' } });
      const ref = await new GitHubForge(octokit, 'o', 'r').createRelease({
        tagName: 'v1',
        name: 'v1',
        body: 'b',
        draft: false,
        prerelease: false,
        generateReleaseNotes: true,
      });
      expect(ref).toEqual({ id: 3, url: 'u', tagName: 'v1' });
      expect(fns.createRelease).toHaveBeenCalledWith(
        expect.objectContaining({ tag_name: 'v1', generate_release_notes: true }),
      );
    });

    it('should update a release', async () => {
      const { octokit, fns } = makeOctokit();
      fns.updateRelease.mockResolvedValue({ data: { id: 3, html_url: 'u', tag_name: 'v1' } });
      const ref = await new GitHubForge(octokit, 'o', 'r').updateRelease(3, {
        tagName: 'v1',
        name: 'v1',
        body: 'b',
        draft: true,
        prerelease: false,
      });
      expect(ref).toEqual({ id: 3, url: 'u', tagName: 'v1' });
      expect(fns.updateRelease).toHaveBeenCalledWith(expect.objectContaining({ release_id: 3, draft: true }));
    });
  });
});

describe('createGitHubForge', () => {
  it('should build a GitHubForge bound to owner/repo', () => {
    expect(createGitHubForge({ token: 't', owner: 'o', repo: 'r' })).toBeInstanceOf(GitHubForge);
  });
});

describe('GitHubForge.getActorPermission', () => {
  it('should prefer role_name so maintain/triage are distinguished', async () => {
    const { octokit, fns } = makeOctokit();
    fns.getCollaboratorPermissionLevel.mockResolvedValue({ data: { permission: 'write', role_name: 'maintain' } });
    expect(await new GitHubForge(octokit, 'o', 'r').getActorPermission('alice')).toBe('maintain');
    expect(fns.getCollaboratorPermissionLevel).toHaveBeenCalledWith({ owner: 'o', repo: 'r', username: 'alice' });
  });

  it('should fall back to permission when role_name is unrecognised', async () => {
    const { octokit, fns } = makeOctokit();
    fns.getCollaboratorPermissionLevel.mockResolvedValue({ data: { permission: 'admin', role_name: 'custom' } });
    expect(await new GitHubForge(octokit, 'o', 'r').getActorPermission('bob')).toBe('admin');
  });

  it('should return none when the user is not a collaborator (404)', async () => {
    const { octokit, fns } = makeOctokit();
    fns.getCollaboratorPermissionLevel.mockRejectedValue(Object.assign(new Error('404'), { status: 404 }));
    expect(await new GitHubForge(octokit, 'o', 'r').getActorPermission('stranger')).toBe('none');
  });

  it('should rethrow non-404 errors (e.g. a mis-scoped token) rather than silently report none', async () => {
    const { octokit, fns } = makeOctokit();
    fns.getCollaboratorPermissionLevel.mockRejectedValue(Object.assign(new Error('403'), { status: 403 }));
    await expect(new GitHubForge(octokit, 'o', 'r').getActorPermission('alice')).rejects.toThrow('403');
  });
});

describe('forgeErrorStatus', () => {
  it('should read a numeric status off an error', () => {
    expect(forgeErrorStatus(Object.assign(new Error('x'), { status: 404 }))).toBe(404);
  });

  it('should return undefined for errors without a numeric status', () => {
    expect(forgeErrorStatus(new Error('plain'))).toBeUndefined();
    expect(forgeErrorStatus({ status: 'nope' })).toBeUndefined();
    expect(forgeErrorStatus(undefined)).toBeUndefined();
  });
});
