import { createFakeGit } from '@releasekit/git';
import { describe, expect, it } from 'vitest';
import { parseGitLogInput } from '../../../src/input/git-log.js';

// `%H|||%s|||%an|||%ad` lines, as the seam's `log` would return them.
const rawLog = [
  'abc123|||feat(cli): add dry-run flag|||Alice|||2026-06-01',
  'def456|||fix: prerelease sorting #42|||Bob|||2026-06-02',
  'ghi789|||Merge pull request #5|||Bot|||2026-06-03',
].join('\n');

describe('parseGitLogInput', () => {
  it('should parse conventional commits from the log range into changelog entries', async () => {
    const git = createFakeGit({
      commits: { 'v1.0.0..HEAD': rawLog },
      remoteUrls: { origin: 'https://github.com/o/r.git' },
      nearestTag: 'v1.2.0',
    });

    const input = await parseGitLogInput('v1.0.0', 'HEAD', git);

    expect(input.source).toBe('git-log');
    const pkg = input.packages[0];
    expect(pkg?.version).toBe('1.2.0'); // describeTags 'v1.2.0' → 'v' stripped
    expect(pkg?.repoUrl).toBe('https://github.com/o/r.git');
    expect(pkg?.revisionRange).toBe('v1.0.0..HEAD');
    expect(pkg?.previousVersion).toBe('1.0.0');
    // feat → added, fix → fixed; the Merge commit is dropped.
    expect(pkg?.entries).toEqual([
      expect.objectContaining({ type: 'added', description: 'add dry-run flag', scope: 'cli' }),
      expect.objectContaining({ type: 'fixed', description: 'prerelease sorting #42', issueIds: ['#42'] }),
    ]);
  });

  it('should default version to 0.0.0 and repoUrl to null when there is no tag or remote', async () => {
    const git = createFakeGit({ commits: { '*': '' } });
    const input = await parseGitLogInput(undefined, 'HEAD', git);
    expect(input.packages[0]?.version).toBe('0.0.0');
    expect(input.packages[0]?.repoUrl).toBeNull();
    expect(input.packages[0]?.entries).toEqual([]);
  });

  it('should query over toRef alone (no range) when no fromRef is given', async () => {
    const git = createFakeGit({ commits: { HEAD: 'aaa|||chore: bump deps|||Sam|||2026-06-04' } });
    const input = await parseGitLogInput(undefined, 'HEAD', git);
    expect(input.packages[0]?.revisionRange).toBe('HEAD');
    expect(input.packages[0]?.previousVersion).toBeNull();
    expect(input.packages[0]?.entries).toEqual([
      expect.objectContaining({ type: 'changed', description: 'bump deps' }),
    ]);
  });
});
