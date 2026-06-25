import { createFakeGit, type Git } from '@releasekit/git';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getCommitsLength,
  getLatestStableTagForPackage,
  getLatestTag,
  getLatestTagForPackage,
  listGlobalTags,
  listPackageTags,
  refExists,
} from '../../../src/git/tagsAndBranches.js';
import { log } from '../../../src/utils/logging.js';

// getLatestTag/getLatestStableTag still go through git-semver-tags (NOT the seam) — keep mocking it.
vi.mock('../../../src/utils/logging.js');
vi.mock('git-semver-tags', () => ({
  getSemverTags: vi.fn(),
}));

/** A FakeGit seeded with `git tag --sort=-creatordate` output (newest-first), for listTags-backed lookups. */
const gitWithTags = (tags: string[]): Git => createFakeGit({ tags });

/** A FakeGit whose listTags rejects, to exercise the tag-listing error paths. */
function gitThatFailsListTagsWith(message: string): Git {
  const git = createFakeGit();
  git.listTags = async () => {
    throw new Error(message);
  };
  return git;
}

describe('tagsAndBranches', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('getCommitsLength', () => {
    it('should return the number of commits since a specific tag', async () => {
      const git = createFakeGit({ commitCounts: { 'v0.9.0..HEAD': 5 } });

      const result = await getCommitsLength('packages/test', 'v0.9.0', git);

      expect(result).toBe(5);
    });

    it('should fall back to the nearest tag via describe when no sinceTag is given', async () => {
      // describeTags returns the nearest tag; the count is then taken over `<tag>..HEAD`.
      const git = createFakeGit({ nearestTag: 'v0.9.0', commitCounts: { 'v0.9.0..HEAD': 5 } });

      const result = await getCommitsLength('packages/test', undefined, git);

      expect(result).toBe(5);
    });

    it('should return 0 when describe finds no reachable tag', async () => {
      const git = createFakeGit({ nearestTag: null });

      const result = await getCommitsLength('packages/test', undefined, git);

      expect(result).toBe(0);
      expect(log).toHaveBeenCalledWith(expect.stringContaining('Failed to get number of commits'), 'error');
    });

    it('should return 0 if the git command fails', async () => {
      const git = createFakeGit();
      git.countCommits = async () => {
        throw new Error('Command failed');
      };

      const result = await getCommitsLength('packages/test', 'v0.9.0', git);

      expect(result).toBe(0);
      expect(log).toHaveBeenCalledWith('Failed to get number of commits since last tag: Command failed', 'error');
    });
  });

  describe('refExists', () => {
    it('should return true when the ref resolves', async () => {
      const git = createFakeGit({ existingRefs: ['release/v0.29.0'] });

      expect(await refExists('release/v0.29.0', undefined, git)).toBe(true);
    });

    it('should pass cwd through when provided', async () => {
      const git = createFakeGit({ existingRefs: ['v1.0.0'] });

      expect(await refExists('v1.0.0', '/repo/pkg', git)).toBe(true);
    });

    it('should return false when the ref does not resolve', async () => {
      const git = createFakeGit();

      expect(await refExists('does-not-exist', undefined, git)).toBe(false);
    });

    it('should return false for an empty ref without shelling out', async () => {
      const git = createFakeGit({ existingRefs: [''] });

      expect(await refExists('', undefined, git)).toBe(false);
    });
  });

  describe('getLatestTag', () => {
    it('should return the latest semver tag', async () => {
      const mockGetSemverTags = await import('git-semver-tags');
      vi.mocked(mockGetSemverTags.getSemverTags, { partial: true }).mockResolvedValue(['v1.0.0', 'v0.9.0']);

      const result = await getLatestTag();

      expect(result).toBe('v1.0.0');
      expect(mockGetSemverTags.getSemverTags).toHaveBeenCalledWith({});
    });

    it('should return empty string if no tags found', async () => {
      const mockGetSemverTags = await import('git-semver-tags');
      vi.mocked(mockGetSemverTags.getSemverTags, { partial: true }).mockResolvedValue([]);

      const result = await getLatestTag();

      expect(result).toBe('');
    });

    it('should log error and return empty string if getSemverTags fails', async () => {
      const mockGetSemverTags = await import('git-semver-tags');
      vi.mocked(mockGetSemverTags.getSemverTags, { partial: true }).mockRejectedValue(new Error('No names found'));

      const result = await getLatestTag();

      expect(result).toBe('');
      expect(log).toHaveBeenCalledWith('Failed to get latest tag: No names found', 'error');
      expect(log).toHaveBeenCalledWith('No tags found in the repository.', 'info');
    });

    it('should sort multi-segment-prefixed tags by semver (not as 0.0.0)', async () => {
      const mockGetSemverTags = await import('git-semver-tags');
      vi.mocked(mockGetSemverTags.getSemverTags, { partial: true }).mockResolvedValue([
        'release/v0.21.0',
        'release/v0.22.0',
      ]);

      const result = await getLatestTag('release/v');

      expect(result).toBe('release/v0.22.0');
    });
  });

  describe('getLatestTagForPackage', () => {
    it('should find tag in format packageName-versionPrefix+version', async () => {
      const git = gitWithTags(['test-package-v1.0.0', 'test-package-v0.9.0', 'other-package-v1.2.0']);

      const result = await getLatestTagForPackage(
        'test-package',
        'v',
        { packageSpecificTags: true, tagTemplate: '${packageName}-${prefix}${version}' },
        git,
      );

      expect(result).toBe('test-package-v1.0.0');
      expect(log).toHaveBeenCalledWith(
        'Looking for tags for package test-package with prefix v, packageSpecificTags: true',
        'debug',
      );
    });

    it('should find tag in format versionPrefix-packageName-version', async () => {
      const git = gitWithTags(['vtest-package-1.0.0', 'vother-package-1.2.0']);

      const result = await getLatestTagForPackage(
        'test-package',
        'v',
        { packageSpecificTags: true, tagTemplate: '${prefix}${packageName}-${version}' },
        git,
      );

      expect(result).toBe('vtest-package-1.0.0');
      expect(log).toHaveBeenCalledWith('Retrieved 2 tags', 'debug');
      expect(log).toHaveBeenCalledWith('Found 1 package tags using configured pattern', 'debug');
      expect(log).toHaveBeenCalledWith('Using most recently created tag: vtest-package-1.0.0', 'debug');
    });

    it('should find tag in format packageName-version when no prefix is provided', async () => {
      const git = gitWithTags(['test-package-1.0.0', 'test-package-0.9.0', 'other-package-1.2.0']);

      const result = await getLatestTagForPackage(
        'test-package',
        undefined,
        { packageSpecificTags: true, tagTemplate: '${packageName}-${version}' },
        git,
      );

      expect(result).toBe('test-package-1.0.0');
      expect(log).toHaveBeenCalledWith(
        'Looking for tags for package test-package with prefix none, packageSpecificTags: true',
        'debug',
      );
    });

    it('should handle scoped package names', async () => {
      const git = gitWithTags(['scope-test-package-v1.0.0', 'scope-other-package-v1.2.0']);

      const result = await getLatestTagForPackage(
        '@scope/test-package',
        'v',
        { packageSpecificTags: true, tagTemplate: '${packageName}-${prefix}${version}' },
        git,
      );

      expect(result).toBe('scope-test-package-v1.0.0');
    });

    it('should return empty string if no tags match packageName pattern', async () => {
      const git = gitWithTags(['other-package-v1.0.0', 'another-package-v0.9.0']);

      const result = await getLatestTagForPackage(
        'test-package',
        'v',
        { packageSpecificTags: true, tagTemplate: '${packageName}-${prefix}${version}' },
        git,
      );

      expect(result).toBe('');
      expect(log).toHaveBeenCalledWith('No matching tags found for configured tag pattern', 'debug');
      expect(log).toHaveBeenCalledWith('Available tags: other-package-v1.0.0, another-package-v0.9.0', 'debug');
    });

    it('should return empty string if no tags are found at all', async () => {
      const git = gitWithTags([]);

      const result = await getLatestTagForPackage('test-package', 'v', { packageSpecificTags: true }, git);

      expect(result).toBe('');
      expect(log).toHaveBeenCalledWith('Retrieved 0 tags', 'debug');
      expect(log).toHaveBeenCalledWith('No tags available in the repository', 'debug');
    });

    it('should log error and return empty string if getting tags fails', async () => {
      const git = gitThatFailsListTagsWith('No names found');

      const result = await getLatestTagForPackage('test-package', 'v', { packageSpecificTags: true }, git);

      // listPackageTags swallows the listTags error internally (logs + empty list) → no matches → ''.
      expect(result).toBe('');
    });

    it('should return empty string when listing fails with a non-Error value', async () => {
      const git = createFakeGit();
      git.listTags = async () => {
        throw 'String error';
      };

      const result = await getLatestTagForPackage('test-package', undefined, { packageSpecificTags: true }, git);

      expect(result).toBe('');
    });
  });

  describe('getLatestTagForPackage (chronological / creatordate ordering)', () => {
    it('should return the most recently created package tag (first in list)', async () => {
      const git = gitWithTags([
        'test-package-v1.0.5',
        'test-package-v1.2.0',
        'test-package-v1.1.0',
        'other-package-v2.0.0',
      ]);

      const result = await getLatestTagForPackage(
        'test-package',
        'v',
        { packageSpecificTags: true, tagTemplate: '${packageName}-${prefix}${version}' },
        git,
      );

      expect(result).toBe('test-package-v1.0.5');
      expect(log).toHaveBeenCalledWith('Using most recently created tag: test-package-v1.0.5', 'debug');
    });

    it('should prefer a stable patch release created after a prerelease', async () => {
      const git = gitWithTags(['test-package-v0.2.1', 'test-package-v0.3.0-next.4', 'test-package-v0.3.0-next.3']);

      const result = await getLatestTagForPackage(
        'test-package',
        'v',
        { packageSpecificTags: true, tagTemplate: '${packageName}-${prefix}${version}' },
        git,
      );

      expect(result).toBe('test-package-v0.2.1');
    });

    it('should return the most recently created tag even with malformed versions', async () => {
      const git = gitWithTags(['pkg-1.0.0', 'pkg-invalid-version', 'pkg-not-a-version']);

      const result = await getLatestTagForPackage(
        'pkg',
        undefined,
        { packageSpecificTags: true, tagTemplate: '${packageName}-${version}' },
        git,
      );

      expect(result).toBe('pkg-1.0.0');
    });

    it('should handle package names with special regex characters', async () => {
      const git = gitWithTags([
        'scope-package-with.dots-v1.0.0',
        'scope-package-withplus-v2.0.0',
        'scope-other-package-v1.5.0',
      ]);

      const result = await getLatestTagForPackage(
        '@scope/package-with.dots',
        'v',
        { packageSpecificTags: true, tagTemplate: '${packageName}-${prefix}${version}' },
        git,
      );

      expect(result).toBe('scope-package-with.dots-v1.0.0');
    });
  });

  describe('getLatestTag semantic ordering', () => {
    it('should return semantically latest tag when misordered chronologically', async () => {
      const mockGetSemverTags = await import('git-semver-tags');
      vi.mocked(mockGetSemverTags.getSemverTags, { partial: true }).mockResolvedValue([
        'v1.0.5',
        'v1.2.0',
        'v1.1.0',
        'v1.0.0',
      ]);

      const result = await getLatestTag('v');

      expect(result).toBe('v1.2.0');
      expect(log).toHaveBeenCalledWith(
        'Tag ordering differs: chronological latest is v1.0.5, semantic latest is v1.2.0',
        'debug',
      );
      expect(log).toHaveBeenCalledWith('Using semantic latest (v1.2.0) to handle out-of-order tag creation', 'info');
    });

    it('should treat a stable release as higher than a prerelease', async () => {
      const mockGetSemverTags = await import('git-semver-tags');
      vi.mocked(mockGetSemverTags.getSemverTags, { partial: true }).mockResolvedValue([
        'v1.0.0-rc.1',
        'v1.0.0',
        'v1.0.0-beta.2',
      ]);

      const result = await getLatestTag('v');

      expect(result).toBe('v1.0.0');
    });

    it('should handle invalid semver versions in sorting gracefully', async () => {
      const mockGetSemverTags = await import('git-semver-tags');
      vi.mocked(mockGetSemverTags.getSemverTags, { partial: true }).mockResolvedValue([
        'v1.0.0-invalid-semver-',
        'v1.2.0',
        'invalid-tag-format',
        'v1.1.0',
      ]);

      const result = await getLatestTag('v');

      expect(result).toBe('v1.2.0');
    });

    it('should handle double-digit version components', async () => {
      const mockGetSemverTags = await import('git-semver-tags');
      vi.mocked(mockGetSemverTags.getSemverTags, { partial: true }).mockResolvedValue([
        'v10.0.0',
        'v2.0.0',
        'v1.10.0',
        'v1.2.10',
      ]);

      const result = await getLatestTag('v');

      expect(result).toBe('v10.0.0');
    });

    it('should pass the version prefix through to getSemverTags', async () => {
      const mockGetSemverTags = await import('git-semver-tags');
      vi.mocked(mockGetSemverTags.getSemverTags, { partial: true }).mockResolvedValue(['release-1.0.0']);

      await getLatestTag('release-');

      expect(mockGetSemverTags.getSemverTags).toHaveBeenCalledWith({ tagPrefix: 'release-' });
    });

    it('should handle an undefined version prefix', async () => {
      const mockGetSemverTags = await import('git-semver-tags');
      vi.mocked(mockGetSemverTags.getSemverTags, { partial: true }).mockResolvedValue(['v1.0.0', 'v2.0.0']);

      const result = await getLatestTag(undefined);

      expect(result).toBe('v2.0.0');
      expect(mockGetSemverTags.getSemverTags).toHaveBeenCalledWith({ tagPrefix: undefined });
    });

    it('should not log an ordering difference when there is only one tag', async () => {
      const mockGetSemverTags = await import('git-semver-tags');
      vi.mocked(mockGetSemverTags.getSemverTags, { partial: true }).mockResolvedValue(['v1.0.0']);

      const result = await getLatestTag('v');

      expect(result).toBe('v1.0.0');
      expect(log).not.toHaveBeenCalledWith(expect.stringContaining('Tag ordering differs'), 'debug');
    });
  });

  describe('listPackageTags', () => {
    it('should return matching package tags newest-first and an empty list when none match', async () => {
      const git = gitWithTags(['pkg@v1.1.0', 'pkg@v1.0.0', 'other@v9.9.9']);

      const result = await listPackageTags('pkg', 'v', { packageSpecificTags: true }, git);

      expect(result).toEqual(['pkg@v1.1.0', 'pkg@v1.0.0']);
    });

    it('should return an empty list when package-specific tags are disabled', async () => {
      const git = gitWithTags(['v1.0.0', 'v1.1.0']);

      const result = await listPackageTags('pkg', 'v', { packageSpecificTags: false }, git);

      expect(result).toEqual([]);
    });
  });

  describe('listGlobalTags', () => {
    it('should return prefix-matching global tags newest-first, ignoring package and non-semver tags', async () => {
      const git = gitWithTags(['v1.2.0', 'v1.1.0', 'pkg@v1.0.0', 'release/v0.9.0', 'nightly']);

      const result = await listGlobalTags('v', git);

      expect(result).toEqual(['v1.2.0', 'v1.1.0']);
    });

    it('should match unprefixed semver tags when no prefix is given', async () => {
      const git = gitWithTags(['1.2.0', '1.0.0', 'v2.0.0']);

      const result = await listGlobalTags(undefined, git);

      expect(result).toEqual(['1.2.0', '1.0.0']);
    });

    it('should return an empty list when listing tags fails', async () => {
      const git = gitThatFailsListTagsWith('boom');

      const result = await listGlobalTags('v', git);

      expect(result).toEqual([]);
      expect(log).toHaveBeenCalledWith('Failed to list global tags: boom', 'error');
    });
  });

  describe('getLatestStableTagForPackage', () => {
    it('should skip prerelease tags and return the most recent stable tag', async () => {
      const git = gitWithTags(['pkg@v1.1.0-next.0', 'pkg@v1.0.0', 'pkg@v0.9.0']);

      const result = await getLatestStableTagForPackage('pkg', 'v', { packageSpecificTags: true }, git);

      expect(result).toBe('pkg@v1.0.0');
    });

    it('should return an empty string when only prerelease tags exist', async () => {
      const git = gitWithTags(['pkg@v1.0.0-next.1', 'pkg@v1.0.0-next.0']);

      const result = await getLatestStableTagForPackage('pkg', 'v', { packageSpecificTags: true }, git);

      expect(result).toBe('');
    });
  });
});
