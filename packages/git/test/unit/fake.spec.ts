import { describe, expect, it } from 'vitest';
import { createFakeGit } from '../../src/fake.js';

describe('FakeGit queries', () => {
  it('should return seeded reads and sensible defaults for unseeded ones', async () => {
    const git = createFakeGit({
      tags: ['v1.0.0', 'v1.1.0'],
      nearestTag: 'v1.1.0',
      headSha: 'deadbeef',
      currentBranch: 'release/next',
      remoteUrls: { origin: 'git@github.com:o/r.git' },
      commitCounts: { 'v1..HEAD': 3 },
      status: ' M a.ts\n',
    });

    expect(await git.isRepository()).toBe(true);
    expect(await git.listTags()).toEqual(['v1.0.0', 'v1.1.0']);
    expect(await git.describeTags()).toBe('v1.1.0');
    expect(await git.headSha()).toBe('deadbeef');
    expect(await git.currentBranch()).toBe('release/next');
    expect(await git.remoteUrl('origin')).toBe('git@github.com:o/r.git');
    expect(await git.remoteUrl('upstream')).toBeNull();
    expect(await git.countCommits('v1..HEAD')).toBe(3);
    expect(await git.countCommits('absent..HEAD')).toBe(0);
    expect(await git.status({ porcelain: true })).toBe(' M a.ts\n');
  });

  it('should default to a repo with main/zeroed-sha and empty/null reads when unseeded', async () => {
    const git = createFakeGit();
    expect(await git.isRepository()).toBe(true);
    expect(await git.currentBranch()).toBe('main');
    expect(await git.headSha()).toMatch(/^0+$/);
    expect(await git.describeTags()).toBeNull();
    expect(await git.listTags()).toEqual([]);
    expect(await git.status()).toBe('');
  });

  it('should honour an isRepo: false seed', async () => {
    expect(await createFakeGit({ isRepo: false }).isRepository()).toBe(false);
  });

  it('should report seeded existing refs', async () => {
    const git = createFakeGit({ existingRefs: ['v1.0.0', 'refs/heads/main'] });
    expect(await git.refExists('v1.0.0')).toBe(true);
    expect(await git.refExists('refs/heads/main')).toBe(true);
    expect(await git.refExists('missing')).toBe(false);
  });

  it('should resolve isAncestor from a record of descendant -> ancestors', async () => {
    const git = createFakeGit({ ancestors: { HEAD: ['v1.0.0', 'main'] } });
    expect(await git.isAncestor('v1.0.0', 'HEAD')).toBe(true);
    expect(await git.isAncestor('main', 'HEAD')).toBe(true);
    expect(await git.isAncestor('v2.0.0', 'HEAD')).toBe(false);
    expect(await git.isAncestor('v1.0.0', 'other')).toBe(false);
  });

  it('should resolve isAncestor from a predicate seed', async () => {
    const git = createFakeGit({ ancestors: (ancestor, ref) => ancestor === 'base' && ref === 'tip' });
    expect(await git.isAncestor('base', 'tip')).toBe(true);
    expect(await git.isAncestor('base', 'other')).toBe(false);
  });

  it('should match log by range, falling back to the * catch-all', async () => {
    const git = createFakeGit({ commits: { 'v1..HEAD': 'ranged log', '*': 'all log' } });
    expect(await git.log({ range: 'v1..HEAD' })).toBe('ranged log');
    expect(await git.log({ range: 'other..HEAD' })).toBe('all log');
    expect(await git.log({})).toBe('all log');
  });

  it('should return empty log when neither the range nor a catch-all is seeded', async () => {
    expect(await createFakeGit().log({ range: 'v1..HEAD' })).toBe('');
  });

  it('should return seeded changed paths per commit', async () => {
    const git = createFakeGit({ diffNames: { sha1: ['a.ts', 'b.ts'] } });
    expect(await git.diffTreeNames('sha1')).toEqual(['a.ts', 'b.ts']);
    expect(await git.diffTreeNames('sha2')).toEqual([]);
  });

  it('should return seeded for-each-ref lines', async () => {
    const git = createFakeGit({ refLines: ['v1 sha1', 'v2 sha2'] });
    expect(await git.forEachRef({ format: '%(refname)' })).toEqual(['v1 sha1', 'v2 sha2']);
  });

  it('should report seeded remote branches per remote', async () => {
    const git = createFakeGit({ remoteBranches: { origin: ['release/next'] } });
    expect(await git.remoteBranchExists('origin', 'release/next')).toBe(true);
    expect(await git.remoteBranchExists('origin', 'main')).toBe(false);
    expect(await git.remoteBranchExists('upstream', 'release/next')).toBe(false);
  });
});

describe('FakeGit mutations', () => {
  it('should record adds, commits, fetches, checkouts, and resets', async () => {
    const git = createFakeGit();
    await git.add(['a.ts', 'b.ts']);
    await git.add(['-A']);
    await git.commit('chore: release', { paths: ['CHANGELOG.md'], skipHooks: true });
    await git.fetch('origin');
    await git.checkout('release/next', { create: true });
    await git.resetHard('origin/main');

    expect(git.added).toEqual([['a.ts', 'b.ts'], ['-A']]);
    expect(git.committed).toEqual([{ message: 'chore: release', paths: ['CHANGELOG.md'], skipHooks: true }]);
    expect(git.fetched).toEqual(['origin']);
    expect(git.checkedOut).toEqual(['release/next']);
    expect(git.resetTo).toEqual(['origin/main']);
  });

  it('should record tags and surface a new tag in listTags', async () => {
    const git = createFakeGit({ tags: ['v1.0.0'] });
    await git.tag('v1.1.0', { message: 'release v1.1.0' });
    await git.tag('v1.0.0'); // already present — not duplicated

    expect(git.tagged).toEqual([
      { name: 'v1.1.0', message: 'release v1.1.0' },
      { name: 'v1.0.0', message: undefined },
    ]);
    expect(await git.listTags()).toEqual(['v1.0.0', 'v1.1.0']);
  });

  it('should record pushes with their flags', async () => {
    const git = createFakeGit();
    await git.push({ remote: 'origin', ref: 'HEAD:release/next', forceWithLease: true, tags: true });
    await git.push({ remote: 'origin', force: true });

    expect(git.pushed).toEqual([
      { remote: 'origin', ref: 'HEAD:release/next', force: undefined, forceWithLease: true, tags: true },
      { remote: 'origin', ref: undefined, force: true, forceWithLease: undefined, tags: undefined },
    ]);
  });
});

describe('createFakeGit', () => {
  it('should not share recorded-call arrays between instances', async () => {
    const a = createFakeGit();
    await a.commit('one');
    const b = createFakeGit();
    expect(b.committed).toEqual([]);
    expect(a.committed).toHaveLength(1);
  });
});
