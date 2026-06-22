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

  it('should make createLabel idempotent against seeded labels', async () => {
    const forge = createFakeForge({ labelNames: ['existing'] });

    expect(await forge.createLabel({ name: 'existing', color: 'c', description: 'd' })).toBe('exists');
    expect(await forge.createLabel({ name: 'fresh', color: 'c', description: 'd' })).toBe('created');
    expect(await forge.createLabel({ name: 'fresh', color: 'c', description: 'd' })).toBe('exists'); // now present
    expect((await forge.listLabelNames()).sort()).toEqual(['existing', 'fresh']);
    expect(forge.createdLabels).toHaveLength(3);
  });
});
