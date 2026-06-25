import { createFakeGit, type Git } from '@releasekit/git';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { verifyTag } from '../../../src/git/tagVerification.js';
import { log } from '../../../src/utils/logging.js';
import { getBestVersionSource, VersionMismatchError } from '../../../src/utils/versionUtils.js';

// Mock logging only; git execution is driven through an injected FakeGit.
vi.mock('../../../src/utils/logging.js');

const mockLog = vi.mocked(log);

/**
 * A FakeGit seeded so a tag both exists (refExists) and is reachable from HEAD (isAncestor). Mirrors
 * the old "tag exists, rev-parse + merge-base both succeed" mock.
 */
function gitWithReachableTag(tag: string): Git {
  return createFakeGit({ existingRefs: [tag], ancestors: { HEAD: [tag] } });
}

/** A FakeGit where the tag exists but is NOT an ancestor of HEAD. */
function gitWithUnreachableTag(tag: string): Git {
  return createFakeGit({ existingRefs: [tag] });
}

/** A FakeGit where the tag is absent entirely (refExists → false). */
function gitWithMissingTag(): Git {
  return createFakeGit();
}

describe('Tag Verification', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockLog.mockImplementation(() => {}); // Silent by default
  });

  describe('verifyTag', () => {
    it('should return exists: true when tag exists and is reachable', async () => {
      const result = await verifyTag('v1.0.0', '/test/path', gitWithReachableTag('v1.0.0'));

      expect(result).toEqual({
        exists: true,
        reachable: true,
      });
    });

    it('should return reachable: false when ref exists but is not an ancestor of HEAD', async () => {
      const result = await verifyTag('deadbeef', '/test/path', gitWithUnreachableTag('deadbeef'));

      expect(result).toEqual({
        exists: true,
        reachable: false,
        error: "Ref 'deadbeef' exists but is not an ancestor of HEAD",
      });
    });

    it('should return exists: false when tag does not exist', async () => {
      const result = await verifyTag('v1.0.0', '/test/path', gitWithMissingTag());

      expect(result).toEqual({
        exists: false,
        reachable: false,
        error: "Ref 'v1.0.0' not found in repository",
      });
    });

    it('should surface a git error when refExists throws unexpectedly', async () => {
      // refExists only throws when git itself is missing/fails unexpectedly (e.g. binary not found).
      const git = createFakeGit();
      git.refExists = async () => {
        throw new Error('git binary not found');
      };

      const result = await verifyTag('v1.0.0', '/test/path', git);

      expect(result).toEqual({
        exists: false,
        reachable: false,
        error: 'Git error: git binary not found',
      });
    });

    it('should return exists: false for empty tag name', async () => {
      const git = createFakeGit();
      const result = await verifyTag('', '/test/path', git);

      expect(result).toEqual({
        exists: false,
        reachable: false,
        error: 'Empty tag name',
      });
      // No git call for an empty tag.
      expect(git.added).toEqual([]);
    });

    it('should return exists: false for whitespace-only tag name', async () => {
      const result = await verifyTag('   ', '/test/path', createFakeGit({ existingRefs: ['   '] }));

      expect(result).toEqual({
        exists: false,
        reachable: false,
        error: 'Empty tag name',
      });
    });
  });

  describe('getBestVersionSource', () => {
    it('should use package version when it is newer than git tag', async () => {
      const result = await getBestVersionSource(
        'v1.0.0',
        '1.1.0',
        '/test/path',
        'error',
        false,
        gitWithReachableTag('v1.0.0'),
      );

      expect(result).toEqual({
        source: 'package',
        version: '1.1.0',
        reason: 'Package version is newer',
      });
      expect(mockLog).toHaveBeenCalledWith(
        'Package version 1.1.0 is newer than git tag v1.0.0, using package version',
        'info',
      );
    });

    it('should use git tag when it is newer than package version', async () => {
      const result = await getBestVersionSource(
        'v1.2.0',
        '1.0.0',
        '/test/path',
        'warn',
        false,
        gitWithReachableTag('v1.2.0'),
      );

      expect(result.source).toBe('git');
      expect(result.version).toBe('v1.2.0');
      expect(result.reason).toBe('Git tag is newer');
      expect(result.mismatch).toBeDefined();
      expect(result.mismatch?.detected).toBe(true);
      expect(result.mismatch?.severity).toBe('major');
      expect(mockLog).toHaveBeenCalledWith('Git tag v1.2.0 is newer than package version 1.0.0, using git tag', 'info');
    });

    it('should use git tag when versions are equal', async () => {
      const result = await getBestVersionSource(
        'v1.0.0',
        '1.0.0',
        '/test/path',
        'error',
        false,
        gitWithReachableTag('v1.0.0'),
      );

      expect(result).toEqual({
        source: 'git',
        version: 'v1.0.0',
        reason: 'Versions equal, using git tag',
      });
    });

    it('should fallback to package version when tag is unreachable', async () => {
      const result = await getBestVersionSource('v1.0.0', '1.0.0', '/test/path', 'error', false, gitWithMissingTag());

      expect(result).toEqual({
        source: 'package',
        version: '1.0.0',
        reason: 'Git tag unreachable',
      });
      expect(mockLog).toHaveBeenCalledWith(
        "Git tag 'v1.0.0' unreachable (Ref 'v1.0.0' not found in repository), using package version: 1.0.0",
        'warning',
      );
    });

    it('should throw error when tag is unreachable and strictReachable is true', async () => {
      await expect(
        getBestVersionSource('v1.0.0', '1.0.0', '/test/path', 'error', true, gitWithMissingTag()),
      ).rejects.toThrow("Git tag 'v1.0.0' is not reachable from the current commit");
    });

    it('should throw error when tag is unreachable, strictReachable is true, and no package version', async () => {
      await expect(
        getBestVersionSource('v1.0.0', undefined, '/test/path', 'error', true, gitWithMissingTag()),
      ).rejects.toThrow("Git tag 'v1.0.0' is not reachable from the current commit");
    });

    it('should fallback to package version when strictReachable is false (default)', async () => {
      const result = await getBestVersionSource('v1.0.0', '1.0.0', '/test/path', 'error', false, gitWithMissingTag());

      expect(result).toEqual({
        source: 'package',
        version: '1.0.0',
        reason: 'Git tag unreachable',
      });
    });

    it('should use package version when no tag provided', async () => {
      const result = await getBestVersionSource(undefined, '1.0.0', '/test/path');

      expect(result).toEqual({
        source: 'package',
        version: '1.0.0',
        reason: 'No git tag provided',
      });
    });

    it('should use initial version when no tag and no package version', async () => {
      const result = await getBestVersionSource(undefined, undefined, '/test/path');

      expect(result).toEqual({
        source: 'initial',
        version: '0.1.0',
        reason: 'No git tag or package version available',
      });
    });

    it('should use initial version when tag unreachable and no package version', async () => {
      const result = await getBestVersionSource('v1.0.0', undefined, '/test/path', 'error', false, gitWithMissingTag());

      expect(result).toEqual({
        source: 'initial',
        version: '0.1.0',
        reason: 'Git tag unreachable, no package version',
      });
      expect(mockLog).toHaveBeenCalledWith(
        "Git tag 'v1.0.0' unreachable and no package version available, using initial version",
        'warning',
      );
    });

    it('should handle empty tag string', async () => {
      const result = await getBestVersionSource('', '1.0.0', '/test/path');

      expect(result).toEqual({
        source: 'package',
        version: '1.0.0',
        reason: 'No git tag provided',
      });
    });

    it('should handle whitespace-only tag string', async () => {
      const result = await getBestVersionSource('   ', '1.0.0', '/test/path');

      expect(result).toEqual({
        source: 'package',
        version: '1.0.0',
        reason: 'No git tag provided',
      });
    });

    it('should handle package-specific tags correctly', async () => {
      const result = await getBestVersionSource(
        'my-package@v1.0.0',
        '1.1.0',
        '/test/path',
        'error',
        false,
        gitWithReachableTag('my-package@v1.0.0'),
      );

      expect(result).toEqual({
        source: 'package',
        version: '1.1.0',
        reason: 'Package version is newer',
      });
    });

    it('should fallback to git tag when version comparison fails', async () => {
      const result = await getBestVersionSource(
        'v1.0.0',
        'invalid-version',
        '/test/path',
        'error',
        false,
        gitWithReachableTag('v1.0.0'),
      );

      expect(result).toEqual({
        source: 'git',
        version: 'v1.0.0',
        reason: 'Version comparison failed',
      });
      expect(mockLog).toHaveBeenCalledWith(
        'Failed to compare versions, defaulting to git tag: TypeError: Invalid Version: invalid-version',
        'warning',
      );
    });

    it('should use git tag when no package version to compare', async () => {
      const result = await getBestVersionSource(
        'v1.0.0',
        undefined,
        '/test/path',
        'error',
        false,
        gitWithReachableTag('v1.0.0'),
      );

      expect(result).toEqual({
        source: 'git',
        version: 'v1.0.0',
        reason: 'Git tag exists, no package version to compare',
      });
    });

    describe('version mismatch detection', () => {
      it('should detect mismatch when git tag is stable but package is prerelease (same major)', async () => {
        const result = await getBestVersionSource(
          'v1.0.0',
          '1.0.0-beta.1',
          '/test/path',
          'warn',
          false,
          gitWithReachableTag('v1.0.0'),
        );

        expect(result.source).toBe('git');
        expect(result.version).toBe('v1.0.0');
        expect(result.mismatch?.detected).toBe(true);
        expect(result.mismatch?.severity).toBe('major');
        expect(result.mismatch?.message).toContain('reverted release');
      });

      it('should use prefer-package strategy to use package version on mismatch', async () => {
        const result = await getBestVersionSource(
          'v1.0.0',
          '1.0.0-beta.1',
          '/test/path',
          'prefer-package',
          false,
          gitWithReachableTag('v1.0.0'),
        );

        expect(result.source).toBe('package');
        expect(result.version).toBe('1.0.0-beta.1');
        expect(result.reason).toContain('package version');
      });

      it('should throw VersionMismatchError on mismatch with error strategy', async () => {
        await expect(
          getBestVersionSource('v1.0.0', '1.0.0-beta.1', '/test/path', 'error', false, gitWithReachableTag('v1.0.0')),
        ).rejects.toThrow(VersionMismatchError);
      });

      it('should throw VersionMismatchError by default (error is the default strategy)', async () => {
        await expect(
          getBestVersionSource('v1.0.0', '1.0.0-beta.1', '/test/path', 'error', false, gitWithReachableTag('v1.0.0')),
        ).rejects.toThrow(VersionMismatchError);
      });

      it('should detect major version difference as significant mismatch', async () => {
        const result = await getBestVersionSource(
          'v2.0.0',
          '1.0.0',
          '/test/path',
          'warn',
          false,
          gitWithReachableTag('v2.0.0'),
        );

        expect(result.source).toBe('git');
        expect(result.mismatch?.detected).toBe(true);
        expect(result.mismatch?.severity).toBe('major');
      });

      it('should detect minor version difference as significant mismatch', async () => {
        const result = await getBestVersionSource(
          'v1.5.0',
          '1.0.0',
          '/test/path',
          'warn',
          false,
          gitWithReachableTag('v1.5.0'),
        );

        expect(result.source).toBe('git');
        expect(result.mismatch?.detected).toBe(true);
        expect(result.mismatch?.severity).toBe('major');
      });

      it('should not flag patch difference as major mismatch', async () => {
        const result = await getBestVersionSource(
          'v1.0.5',
          '1.0.0',
          '/test/path',
          'error',
          false,
          gitWithReachableTag('v1.0.5'),
        );

        expect(result.source).toBe('git');
        expect(result.mismatch?.detected).toBeFalsy();
      });

      it('should use package version when it is newer than prerelease tag', async () => {
        // Package 1.0.0 is greater than tag 1.0.0-beta.1
        const result = await getBestVersionSource(
          'v1.0.0-beta.1',
          '1.0.0',
          '/test/path',
          'warn',
          false,
          gitWithReachableTag('v1.0.0-beta.1'),
        );

        expect(result.source).toBe('package');
        expect(result.version).toBe('1.0.0');
        expect(result.reason).toBe('Package version is newer');
      });

      it('should support ignore strategy (silent)', async () => {
        mockLog.mockClear();

        const result = await getBestVersionSource(
          'v2.0.0',
          '1.0.0',
          '/test/path',
          'ignore',
          false,
          gitWithReachableTag('v2.0.0'),
        );

        expect(result.source).toBe('git');
        // Should not log warnings with ignore strategy
        const warningCalls = mockLog.mock.calls.filter((call) => call[1] === 'warning');
        expect(warningCalls.length).toBe(0);
      });

      it('should support prefer-git strategy explicitly', async () => {
        const result = await getBestVersionSource(
          'v1.0.0',
          '1.0.0-beta.1',
          '/test/path',
          'prefer-git',
          false,
          gitWithReachableTag('v1.0.0'),
        );

        expect(result.source).toBe('git');
        expect(result.version).toBe('v1.0.0');
        expect(result.reason).toContain('git tag per strategy');
        expect(result.mismatch?.detected).toBe(true);
      });
    });
  });
});
