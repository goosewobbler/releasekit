import { describe, expect, it } from 'vitest';
import { createFakeForge } from '../../src/fake.js';

describe('FakeForge', () => {
  it('should return seeded reads and null for unseeded ones', async () => {
    const forge = createFakeForge({
      standingPR: { number: 3, url: 'u', labels: ['release'] },
      pullRequestsForCommit: { abc: [{ number: 5, mergedAt: '2026-01-01' }] },
      releasesByTag: { v1: { id: 9, url: 'r', tagName: 'v1' } },
    });

    expect(await forge.findStandingPR('release/next')).toEqual({ number: 3, url: 'u', labels: ['release'] });
    expect(await forge.listPullRequestsForCommit('abc')).toEqual([{ number: 5, mergedAt: '2026-01-01' }]);
    expect(await forge.listPullRequestsForCommit('missing')).toEqual([]);
    expect(await forge.getReleaseByTag('v1')).toEqual({ id: 9, url: 'r', tagName: 'v1' });
    expect(await forge.getReleaseByTag('absent')).toBeNull();
  });

  it('should return seeded open pull requests', async () => {
    const open = [{ number: 7, headRef: 'feat/x', draft: false, baseSha: 'abc123' }];
    const forge = createFakeForge({ openPullRequests: open });

    expect(await forge.listOpenPullRequests()).toEqual(open);
    expect(await createFakeForge().listOpenPullRequests()).toEqual([]);
  });

  it('should record writes for assertions', async () => {
    const forge = createFakeForge();
    const ref = await forge.createPullRequest({ title: 't', body: 'b', head: 'h', base: 'm' });
    await forge.updatePullRequest(ref.number, { state: 'closed' });
    await forge.mergePullRequest(ref.number, 'squash');
    await forge.setCommitStatus({ sha: 's', state: 'pending', description: 'd', context: 'c' });

    expect(ref).toEqual({ number: 42, url: expect.stringContaining('42') });
    expect(forge.createdPullRequests).toEqual([{ title: 't', body: 'b', head: 'h', base: 'm' }]);
    expect(forge.updatedPullRequests).toEqual([{ prNumber: 42, changes: { state: 'closed' } }]);
    expect(forge.mergedPullRequests).toEqual([{ prNumber: 42, method: 'squash' }]);
    expect(forge.commitStatuses).toEqual([{ sha: 's', state: 'pending', description: 'd', context: 'c' }]);
  });

  it('should upsert a marker comment: create then update the same comment', async () => {
    const forge = createFakeForge();

    await forge.upsertMarkerComment(1, 'MARK', 'MARK first');
    expect(forge.createdComments).toEqual([{ prNumber: 1, body: 'MARK first' }]);
    expect(await forge.findComment(1, 'MARK')).toMatchObject({ body: 'MARK first' });

    await forge.upsertMarkerComment(1, 'MARK', 'MARK second');
    expect(forge.createdComments).toHaveLength(1); // not stacked
    expect(forge.updatedComments).toHaveLength(1);
    expect(await forge.findComment(1, 'MARK')).toMatchObject({ body: 'MARK second' });
  });

  it('should scope findComment to the requested PR (created comments) while ambient seeds are global', async () => {
    const forge = createFakeForge({ comments: [{ id: 1, body: 'AMBIENT note' }] });
    await forge.createComment(5, 'PR5 note');

    // An unscoped seeded comment is visible from any PR.
    expect(await forge.findComment(99, 'AMBIENT')).toMatchObject({ body: 'AMBIENT note' });
    // A created comment is only found on its own PR.
    expect(await forge.findComment(5, 'PR5')).toMatchObject({ body: 'PR5 note' });
    expect(await forge.findComment(6, 'PR5')).toBeNull();
  });

  it('should make createLabel idempotent against seeded labels', async () => {
    const forge = createFakeForge({ labelNames: ['existing'] });

    expect(await forge.createLabel({ name: 'existing', color: 'c', description: 'd' })).toBe('exists');
    expect(await forge.createLabel({ name: 'fresh', color: 'c', description: 'd' })).toBe('created');
    expect(await forge.createLabel({ name: 'fresh', color: 'c', description: 'd' })).toBe('exists'); // now present
    expect((await forge.listLabelNames()).sort()).toEqual(['existing', 'fresh']);
    expect(forge.createdLabels).toHaveLength(3);
  });

  it('should bound listRecentlyClosedPullRequests by the limit argument', async () => {
    const forge = createFakeForge({
      recentlyClosedPRs: [
        { number: 1, mergedAt: 'a' },
        { number: 2, mergedAt: 'b' },
        { number: 3, mergedAt: 'c' },
      ],
    });
    expect(await forge.listRecentlyClosedPullRequests('release/next', 2)).toHaveLength(2);
    expect(await forge.listRecentlyClosedPullRequests('release/next', 10)).toHaveLength(3);
  });

  it('should return seeded issue/PR details and sensible defaults', async () => {
    const forge = createFakeForge({
      issues: { 7: { body: 'ib', title: 'it', labels: ['l'], isPullRequest: true } },
      pullRequests: { 7: { body: 'pb', labels: ['p'] } },
    });
    expect(await forge.getIssue(7)).toEqual({ body: 'ib', title: 'it', labels: ['l'], isPullRequest: true });
    expect(await forge.getPullRequest(7)).toEqual({ body: 'pb', labels: ['p'] });
    expect(await forge.getIssue(404)).toEqual({ body: '', title: '', labels: [], isPullRequest: true });
    expect(await forge.getPullRequest(404)).toEqual({ body: '', labels: [] });
  });

  it('should record label and release writes and return release refs', async () => {
    const forge = createFakeForge();
    await forge.setLabels(7, ['a', 'b']);
    const created = await forge.createRelease({
      tagName: 'v1',
      name: 'v1',
      body: 'b',
      draft: false,
      prerelease: false,
    });
    const updated = await forge.updateRelease(created.id, {
      tagName: 'v1',
      name: 'v1',
      body: 'b2',
      draft: true,
      prerelease: false,
    });

    expect(forge.setLabelsCalls).toEqual([{ issueNumber: 7, labels: ['a', 'b'] }]);
    expect(created).toEqual({ id: 1, url: expect.stringContaining('1'), tagName: 'v1' });
    expect(updated.id).toBe(1);
    expect(forge.createdReleases).toHaveLength(1);
    expect(forge.updatedReleases).toEqual([{ releaseId: 1, release: expect.objectContaining({ body: 'b2' }) }]);
  });

  it('should return seeded releases from listReleases', async () => {
    const releases = [{ tagName: 'v1', draft: false, prerelease: false, body: 'b' }];
    const forge = createFakeForge({ releases });
    expect(await forge.listReleases()).toEqual(releases);
  });

  it('should return seeded actor permission (case-insensitively), and none for unseeded actors', async () => {
    const forge = createFakeForge({ actorPermissions: { Alice: 'admin', bob: 'write' } });
    expect(await forge.getActorPermission('alice')).toBe('admin'); // seeded as 'Alice'
    expect(await forge.getActorPermission('BOB')).toBe('write');
    expect(await forge.getActorPermission('stranger')).toBe('none');
  });

  it('should resolve seeded team membership case-insensitively', async () => {
    const forge = createFakeForge({ teamMemberships: { 'acme/releasers': ['Alice'] } });
    expect(await forge.isTeamMember('acme', 'releasers', 'alice')).toBe(true);
    expect(await forge.isTeamMember('acme', 'releasers', 'bob')).toBe(false);
    expect(await forge.isTeamMember('acme', 'other', 'alice')).toBe(false);
  });

  it('should create an issue, record it, and reflect it in getIssue and findOpenIssueByLabel', async () => {
    const forge = createFakeForge();

    const ref = await forge.createIssue({ title: 'Release draft', body: 'notes', labels: ['release:draft'] });

    expect(ref).toEqual({ number: 42, url: expect.stringContaining('issues/42') });
    expect(forge.createdIssues).toEqual([{ title: 'Release draft', body: 'notes', labels: ['release:draft'] }]);
    expect(await forge.getIssue(42)).toEqual({
      body: 'notes',
      title: 'Release draft',
      labels: ['release:draft'],
      isPullRequest: false,
    });
    expect(await forge.findOpenIssueByLabel('release:draft')).toEqual({ number: 42, url: ref.url });
    expect(await forge.findOpenIssueByLabel('nope')).toBeNull();
  });

  it('should update an issue body and close it (dropping it from open-issue discovery)', async () => {
    const forge = createFakeForge();
    const ref = await forge.createIssue({ title: 't', body: 'old', labels: ['release:draft'] });

    await forge.updateIssue(ref.number, { body: 'edited' });
    expect(await forge.getIssue(ref.number)).toMatchObject({ body: 'edited' });
    expect(forge.updatedIssues).toEqual([{ issueNumber: 42, changes: { body: 'edited' } }]);

    await forge.updateIssue(ref.number, { state: 'closed' });
    expect(await forge.findOpenIssueByLabel('release:draft')).toBeNull();
  });

  it('should discover a pre-seeded open issue by label', async () => {
    const forge = createFakeForge({
      openIssues: [{ number: 7, url: 'https://example/issues/7', labels: ['release:draft'] }],
    });
    expect(await forge.findOpenIssueByLabel('release:draft')).toEqual({
      number: 7,
      url: 'https://example/issues/7',
    });
  });

  it('should discover an issue seeded only via the issues map (#462 review)', async () => {
    const forge = createFakeForge({
      issues: { 7: { body: 'b', title: 't', labels: ['release:draft'], isPullRequest: false } },
    });
    expect(await forge.findOpenIssueByLabel('release:draft')).toMatchObject({ number: 7 });
    // A seeded PR carrying the label must NOT be discoverable as an issue.
    const withPr = createFakeForge({
      issues: { 8: { body: 'b', title: 't', labels: ['release:draft'], isPullRequest: true } },
    });
    expect(await withPr.findOpenIssueByLabel('release:draft')).toBeNull();
  });

  it('should return the newest (highest-numbered) matching open issue (#462 review)', async () => {
    const forge = createFakeForge({
      openIssues: [
        { number: 3, url: 'u3', labels: ['release:draft'] },
        { number: 9, url: 'u9', labels: ['release:draft'] },
      ],
    });
    expect(await forge.findOpenIssueByLabel('release:draft')).toEqual({ number: 9, url: 'u9' });
  });

  it('should share the number space between issues and PRs', async () => {
    const forge = createFakeForge();
    const pr = await forge.createPullRequest({ title: 't', body: 'b', head: 'h', base: 'm' });
    const issue = await forge.createIssue({ title: 't', body: 'b' });
    expect(issue.number).toBe(pr.number + 1);
  });
});
