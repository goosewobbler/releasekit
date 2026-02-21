import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { execAsync, execSync } from '../../../src/git/commandExecutor.js';
import {
  getCommitsLength,
  getLatestTag,
  getLatestTagForPackage,
  lastMergeBranchName,
} from '../../../src/git/tagsAndBranches.js';
import { log } from '../../../src/utils/logging.js';

// Mock dependencies
vi.mock('../../../src/git/commandExecutor.js');
vi.mock('../../../src/utils/logging.js');
vi.mock('git-semver-tags', () => ({
  getSemverTags: vi.fn(),
}));

describe('tagsAndBranches', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('getCommitsLength', () => {
    it('should return the number of commits since last tag', () => {
      // Setup
      vi.mocked(execSync, { partial: true }).mockReturnValue(Buffer.from('5'));

      // Execute
      const result = getCommitsLength('packages/test');

      // Verify
      expect(result).toBe(5);
      expect(execSync).toHaveBeenCalledWith(
        'git rev-list --count HEAD ^$(git describe --tags --abbrev=0) packages/test',
      );
    });

    it('should return 0 if command fails', () => {
      // Setup
      vi.mocked(execSync, { partial: true }).mockImplementation(() => {
        throw new Error('Command failed');
      });

      // Execute
      const result = getCommitsLength('packages/test');

      // Verify
      expect(result).toBe(0);
      expect(log).toHaveBeenCalledWith('Failed to get number of commits since last tag: Command failed', 'error');
    });
  });

  describe('getLatestTag', () => {
    it('should return the latest semver tag', async () => {
      // Setup
      const mockGetSemverTags = await import('git-semver-tags');
      vi.mocked(mockGetSemverTags.getSemverTags, { partial: true }).mockResolvedValue(['v1.0.0', 'v0.9.0']);

      // Execute
      const result = await getLatestTag();

      // Verify
      expect(result).toBe('v1.0.0');
      expect(mockGetSemverTags.getSemverTags).toHaveBeenCalledWith({});
    });

    it('should return empty string if no tags found', async () => {
      // Setup
      const mockGetSemverTags = await import('git-semver-tags');
      vi.mocked(mockGetSemverTags.getSemverTags, { partial: true }).mockResolvedValue([]);

      // Execute
      const result = await getLatestTag();

      // Verify
      expect(result).toBe('');
    });

    it('should log error and return empty string if getSemverTags fails', async () => {
      // Setup
      const mockGetSemverTags = await import('git-semver-tags');
      vi.mocked(mockGetSemverTags.getSemverTags, { partial: true }).mockRejectedValue(new Error('No names found'));

      // Execute
      const result = await getLatestTag();

      // Verify
      expect(result).toBe('');
      expect(log).toHaveBeenCalledWith('Failed to get latest tag: No names found', 'error');
      expect(log).toHaveBeenCalledWith('No tags found in the repository.', 'info');
    });
  });

  describe('lastMergeBranchName', () => {
    it('should return the last merged branch name matching patterns', async () => {
      // Setup
      vi.mocked(execAsync, { partial: true }).mockResolvedValue({
        stdout: 'feature/test-branch',
        stderr: '',
      });

      // Execute
      const result = await lastMergeBranchName(['feature', 'fix'], 'main');

      // Verify
      expect(result).toBe('feature/test-branch');
      expect(execAsync).toHaveBeenCalledWith(expect.stringContaining('feature/(.*)|fix/(.*)'));
    });

    it('should return null if command fails', async () => {
      // Setup
      vi.mocked(execAsync, { partial: true }).mockRejectedValue(new Error('Command failed'));
      const consoleErrorSpy = vi.spyOn(console, 'error');

      // Execute
      const result = await lastMergeBranchName(['feature'], 'main');

      // Verify
      expect(result).toBe(null);
      expect(consoleErrorSpy).toHaveBeenCalled();
    });
  });

  describe('getLatestTagForPackage', () => {
    it('should find tag in format packageName@versionPrefix+version', async () => {
      // Setup
      const mockGetSemverTags = await import('git-semver-tags');
      vi.mocked(mockGetSemverTags.getSemverTags, { partial: true }).mockResolvedValue([
        'test-package@v1.0.0',
        'test-package@v0.9.0',
        'other-package@v1.2.0',
      ]);

      // Execute
      const result = await getLatestTagForPackage('test-package', 'v', {
        packageSpecificTags: true,
      });

      // Verify
      expect(result).toBe('test-package@v1.0.0');
      expect(mockGetSemverTags.getSemverTags).toHaveBeenCalledWith({ tagPrefix: 'v' });
      expect(log).toHaveBeenCalledWith(
        'Looking for tags for package test-package with prefix v, packageSpecificTags: true',
        'debug',
      );
    });

    it('should find tag in format versionPrefix+packageName@version', async () => {
      // Setup
      const mockGetSemverTags = await import('git-semver-tags');
      vi.mocked(mockGetSemverTags.getSemverTags, { partial: true }).mockResolvedValue([
        'vtest-package@1.0.0',
        'vother-package@1.2.0',
      ]);

      // Execute
      const result = await getLatestTagForPackage('test-package', 'v', {
        packageSpecificTags: true,
      });

      // Verify
      expect(result).toBe('vtest-package@1.0.0');

      // Check for the actual log messages in the correct order
      expect(log).toHaveBeenCalledWith(
        'Looking for tags for package test-package with prefix v, packageSpecificTags: true',
        'debug',
      );

      expect(log).toHaveBeenCalledWith('Retrieved 2 tags: vtest-package@1.0.0, vother-package@1.2.0', 'debug');

      expect(log).toHaveBeenCalledWith('Found 1 package tags using pattern: vpackageName@...', 'debug');

      expect(log).toHaveBeenCalledWith('Using semantically latest tag: vtest-package@1.0.0', 'debug');
    });

    it('should find tag in format packageName@version when no prefix is provided', async () => {
      // Setup
      const mockGetSemverTags = await import('git-semver-tags');
      vi.mocked(mockGetSemverTags.getSemverTags, { partial: true }).mockResolvedValue([
        'test-package@1.0.0',
        'test-package@0.9.0',
        'other-package@1.2.0',
      ]);

      // Execute
      const result = await getLatestTagForPackage('test-package', undefined, {
        packageSpecificTags: true,
      });

      // Verify
      expect(result).toBe('test-package@1.0.0');
      expect(mockGetSemverTags.getSemverTags).toHaveBeenCalledWith({ tagPrefix: undefined });
      expect(log).toHaveBeenCalledWith(
        'Looking for tags for package test-package with prefix none, packageSpecificTags: true',
        'debug',
      );
    });

    it('should handle special characters in package name', async () => {
      // Setup
      const mockGetSemverTags = await import('git-semver-tags');
      vi.mocked(mockGetSemverTags.getSemverTags, { partial: true }).mockResolvedValue([
        '@scope/test-package@v1.0.0',
        '@scope/other-package@v1.2.0',
      ]);

      // Execute
      const result = await getLatestTagForPackage('@scope/test-package', 'v', {
        packageSpecificTags: true,
      });

      // Verify
      expect(result).toBe('@scope/test-package@v1.0.0');
    });

    it('should return empty string if no tags match packageName pattern', async () => {
      // Setup
      const mockGetSemverTags = await import('git-semver-tags');
      vi.mocked(mockGetSemverTags.getSemverTags, { partial: true }).mockResolvedValue([
        'other-package@v1.0.0',
        'another-package@v0.9.0',
      ]);

      // Execute
      const result = await getLatestTagForPackage('test-package', 'v', {
        packageSpecificTags: true,
      });

      // Verify
      expect(result).toBe('');
      expect(log).toHaveBeenCalledWith(
        'Looking for tags for package test-package with prefix v, packageSpecificTags: true',
        'debug',
      );
      expect(log).toHaveBeenCalledWith('Retrieved 2 tags: other-package@v1.0.0, another-package@v0.9.0', 'debug');
      expect(log).toHaveBeenCalledWith('No matching tags found for pattern: packageName@version', 'debug');
      expect(log).toHaveBeenCalledWith('Available tags: other-package@v1.0.0, another-package@v0.9.0', 'debug');
    });

    it('should return empty string if no tags are found at all', async () => {
      // Setup
      const mockGetSemverTags = await import('git-semver-tags');
      vi.mocked(mockGetSemverTags.getSemverTags, { partial: true }).mockResolvedValue([]);

      // Execute
      const result = await getLatestTagForPackage('test-package', 'v', {
        packageSpecificTags: true,
      });

      // Verify
      expect(result).toBe('');
      expect(log).toHaveBeenCalledWith(
        'Looking for tags for package test-package with prefix v, packageSpecificTags: true',
        'debug',
      );
      expect(log).toHaveBeenCalledWith('Retrieved 0 tags: ', 'debug');
      expect(log).toHaveBeenCalledWith('No tags available in the repository', 'debug');
    });

    it('should log error and return empty string if getSemverTags fails', async () => {
      // Setup
      const mockGetSemverTags = await import('git-semver-tags');
      vi.mocked(mockGetSemverTags.getSemverTags, { partial: true }).mockRejectedValue(new Error('No names found'));

      // Execute
      const result = await getLatestTagForPackage('test-package', 'v');

      // Verify
      expect(result).toBe('');
      expect(log).toHaveBeenCalledWith('Failed to get latest tag for package test-package: No names found', 'error');
      expect(log).toHaveBeenCalledWith('No tags found for package test-package.', 'info');
    });

    it('should handle non-standard error without Error instance', async () => {
      // Setup
      const mockGetSemverTags = await import('git-semver-tags');
      vi.mocked(mockGetSemverTags.getSemverTags, { partial: true }).mockRejectedValue('String error');

      // Execute
      const result = await getLatestTagForPackage('test-package');

      // Verify
      expect(result).toBe('');
      expect(log).toHaveBeenCalledWith('Failed to get latest tag for package test-package: String error', 'error');
    });
  });
});

describe('Semantic Tag Ordering', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('getLatestTag with semantic ordering', () => {
    it('should return semantically latest tag when tags are in correct chronological order', async () => {
      // Setup - chronological order matches semantic order
      const mockGetSemverTags = await import('git-semver-tags');
      vi.mocked(mockGetSemverTags.getSemverTags, { partial: true }).mockResolvedValue([
        'v1.2.0', // chronologically and semantically latest
        'v1.1.0',
        'v1.0.0',
      ]);

      // Execute
      const result = await getLatestTag('v');

      // Verify
      expect(result).toBe('v1.2.0');
      expect(mockGetSemverTags.getSemverTags).toHaveBeenCalledWith({ tagPrefix: 'v' });
    });

    it('should return semantically latest tag when tags are misordered chronologically', async () => {
      // Setup - chronological order does NOT match semantic order
      const mockGetSemverTags = await import('git-semver-tags');
      vi.mocked(mockGetSemverTags.getSemverTags, { partial: true }).mockResolvedValue([
        'v1.0.5', // chronologically latest but semantically older
        'v1.2.0', // semantically latest but chronologically older
        'v1.1.0',
        'v1.0.0',
      ]);

      // Execute
      const result = await getLatestTag('v');

      // Verify - should return semantic latest, not chronological latest
      expect(result).toBe('v1.2.0');
      expect(log).toHaveBeenCalledWith(
        'Tag ordering differs: chronological latest is v1.0.5, semantic latest is v1.2.0',
        'debug',
      );
      expect(log).toHaveBeenCalledWith('Using semantic latest (v1.2.0) to handle out-of-order tag creation', 'info');
    });

    it('should handle prereleases correctly in semantic ordering', async () => {
      // Setup
      const mockGetSemverTags = await import('git-semver-tags');
      vi.mocked(mockGetSemverTags.getSemverTags, { partial: true }).mockResolvedValue([
        'v1.0.0-beta.2', // chronologically latest prerelease
        'v1.0.0', // semantically latest stable
        'v1.0.0-beta.1',
        'v0.9.0',
      ]);

      // Execute
      const result = await getLatestTag('v');

      // Verify - stable release should be considered higher than prerelease
      expect(result).toBe('v1.0.0');
    });

    it('should return empty string when no tags found', async () => {
      // Setup
      const mockGetSemverTags = await import('git-semver-tags');
      vi.mocked(mockGetSemverTags.getSemverTags, { partial: true }).mockResolvedValue([]);

      // Execute
      const result = await getLatestTag('v');

      // Verify
      expect(result).toBe('');
    });

    it('should handle semver.clean failures gracefully', async () => {
      // Setup
      const mockGetSemverTags = await import('git-semver-tags');
      vi.mocked(mockGetSemverTags.getSemverTags, { partial: true }).mockResolvedValue([
        'invalid-tag',
        'v1.0.0',
        'another-invalid',
      ]);

      // Execute
      const result = await getLatestTag('v');

      // Verify - should handle invalid tags and return the valid one
      expect(result).toBe('v1.0.0');
    });

    it('should use semantic ordering by default', async () => {
      // Setup
      const mockGetSemverTags = await import('git-semver-tags');
      vi.mocked(mockGetSemverTags.getSemverTags, { partial: true }).mockResolvedValue([
        'v0.7.4', // chronologically latest
        'v0.8.1', // semantically latest
        'v0.7.1',
      ]);

      // Execute
      const result = await getLatestTag('v');

      // Verify
      expect(result).toBe('v0.8.1'); // Should return semantic latest
    });

    it('should handle complex semantic ordering with major versions', async () => {
      // Setup
      const mockGetSemverTags = await import('git-semver-tags');
      vi.mocked(mockGetSemverTags.getSemverTags, { partial: true }).mockResolvedValue([
        'v1.0.0-beta.1', // chronologically first
        'v2.0.0', // semantically latest
        'v1.9.5', // chronologically latest but semantically older
      ]);

      // Execute
      const result = await getLatestTag('v');

      // Verify
      expect(result).toBe('v2.0.0'); // Should return semantic latest
    });

    it('should handle patch version ordering correctly', async () => {
      // Setup
      const mockGetSemverTags = await import('git-semver-tags');
      vi.mocked(mockGetSemverTags.getSemverTags, { partial: true }).mockResolvedValue([
        'v1.0.10', // higher patch version
        'v1.0.2', // lower patch version
        'v1.0.9', // middle patch version
      ]);

      // Execute
      const result = await getLatestTag('v');

      // Verify
      expect(result).toBe('v1.0.10'); // Should return highest patch version
    });

    it('should handle mixed prerelease and stable versions', async () => {
      // Setup
      const mockGetSemverTags = await import('git-semver-tags');
      vi.mocked(mockGetSemverTags.getSemverTags, { partial: true }).mockResolvedValue([
        'v1.0.0-rc.1', // prerelease
        'v1.0.0', // stable
        'v1.0.0-beta.2', // earlier prerelease
      ]);

      // Execute
      const result = await getLatestTag('v');

      // Verify
      expect(result).toBe('v1.0.0'); // Stable should be latest
    });

    it('should pass versionPrefix parameter to getSemverTags', async () => {
      // Setup
      const mockGetSemverTags = await import('git-semver-tags');
      vi.mocked(mockGetSemverTags.getSemverTags, { partial: true }).mockResolvedValue(['release-1.0.0']);

      // Execute
      await getLatestTag('release-');

      // Verify
      expect(mockGetSemverTags.getSemverTags).toHaveBeenCalledWith({ tagPrefix: 'release-' });
    });
  });

  describe('getLatestTagForPackage with semantic ordering', () => {
    it('should return semantically latest package tag when misordered chronologically', async () => {
      // Setup - package tags where chronological != semantic order
      const mockGetSemverTags = await import('git-semver-tags');
      vi.mocked(mockGetSemverTags.getSemverTags, { partial: true }).mockResolvedValue([
        'test-package@v1.0.5', // chronologically latest but semantically older
        'test-package@v1.2.0', // semantically latest but chronologically older
        'test-package@v1.1.0',
        'other-package@v2.0.0',
      ]);

      // Execute
      const result = await getLatestTagForPackage('test-package', 'v', {
        packageSpecificTags: true,
      });

      // Verify - should return semantic latest for this package
      expect(result).toBe('test-package@v1.2.0');
      expect(log).toHaveBeenCalledWith('Using semantically latest tag: test-package@v1.2.0', 'debug');
    });

    it('should handle package prerelease vs stable semantic ordering', async () => {
      // Setup
      const mockGetSemverTags = await import('git-semver-tags');
      vi.mocked(mockGetSemverTags.getSemverTags, { partial: true }).mockResolvedValue([
        'test-package@v1.0.0-rc.1', // prerelease
        'test-package@v1.0.0', // stable (should be latest)
        'test-package@v1.0.0-beta.1',
      ]);

      // Execute
      const result = await getLatestTagForPackage('test-package', 'v', {
        packageSpecificTags: true,
      });

      // Verify - stable should be latest
      expect(result).toBe('test-package@v1.0.0');
    });

    it('should handle package patch version ordering', async () => {
      // Setup
      const mockGetSemverTags = await import('git-semver-tags');
      vi.mocked(mockGetSemverTags.getSemverTags, { partial: true }).mockResolvedValue([
        'test-package@v1.0.2',
        'test-package@v1.0.10', // highest patch
        'test-package@v1.0.9',
      ]);

      // Execute
      const result = await getLatestTagForPackage('test-package', 'v', {
        packageSpecificTags: true,
      });

      // Verify
      expect(result).toBe('test-package@v1.0.10');
    });

    it('should apply semantic ordering to versionPrefix+packageName@version format', async () => {
      // Setup
      const mockGetSemverTags = await import('git-semver-tags');
      vi.mocked(mockGetSemverTags.getSemverTags, { partial: true }).mockResolvedValue([
        'vtest-package@1.0.5', // chronologically first but semantically older
        'vtest-package@1.2.0', // semantically latest
        'vother-package@2.0.0',
      ]);

      // Execute
      const result = await getLatestTagForPackage('test-package', 'v', {
        packageSpecificTags: true,
      });

      // Verify
      expect(result).toBe('vtest-package@1.2.0');
      expect(log).toHaveBeenCalledWith('Using semantically latest tag: vtest-package@1.2.0', 'debug');
    });

    it('should apply semantic ordering to packageName@version format (no prefix)', async () => {
      // Setup
      const mockGetSemverTags = await import('git-semver-tags');
      vi.mocked(mockGetSemverTags.getSemverTags, { partial: true }).mockResolvedValue([
        'test-package@0.9.0',
        'test-package@1.0.0', // semantically latest
        'test-package@0.10.5', // chronologically latest but semantically older
      ]);

      // Execute
      const result = await getLatestTagForPackage('test-package', undefined, {
        packageSpecificTags: true,
      });

      // Verify
      expect(result).toBe('test-package@1.0.0');
    });

    it('should handle semantic ordering with fallback pattern', async () => {
      // Setup - use a pattern that matches the fallback logic
      const mockGetSemverTags = await import('git-semver-tags');
      vi.mocked(mockGetSemverTags.getSemverTags, { partial: true }).mockResolvedValue([
        'my-package@release-1.0.5', // chronologically first
        'my-package@release-2.0.0', // semantically latest
        'my-package@release-1.9.0',
      ]);

      // Execute - the packageName@prefix pattern should be caught by fallback logic
      const result = await getLatestTagForPackage('my-package', 'release-', {
        packageSpecificTags: true,
      });

      // Verify - should use the packageName@prefix fallback pattern and return semantic latest
      expect(result).toBe('my-package@release-2.0.0');
      expect(log).toHaveBeenCalledWith('Found 3 package tags using pattern: packageName@release-...', 'debug');
      expect(log).toHaveBeenCalledWith('Using semantically latest tag: my-package@release-2.0.0', 'debug');
    });

    it('should not log ordering difference when semantic and chronological match', async () => {
      // Setup - semantic and chronological order are the same
      const mockGetSemverTags = await import('git-semver-tags');
      vi.mocked(mockGetSemverTags.getSemverTags, { partial: true }).mockResolvedValue([
        'test-package@v1.2.0', // both chronologically and semantically latest
        'test-package@v1.1.0',
        'test-package@v1.0.0',
      ]);

      // Execute
      const result = await getLatestTagForPackage('test-package', 'v', {
        packageSpecificTags: true,
      });

      // Verify
      expect(result).toBe('test-package@v1.2.0');
      // Should NOT log ordering difference
      expect(log).not.toHaveBeenCalledWith(expect.stringContaining('Package tag ordering differs'), 'debug');
    });
  });

  describe('Edge Cases and Error Handling', () => {
    it('should handle invalid semver versions in tag sorting gracefully', async () => {
      // Setup - mix of valid and invalid semver tags
      const mockGetSemverTags = await import('git-semver-tags');
      vi.mocked(mockGetSemverTags.getSemverTags, { partial: true }).mockResolvedValue([
        'v1.0.0-invalid-semver-', // invalid semver (semver.clean returns null)
        'v1.2.0', // valid and semantically latest
        'invalid-tag-format', // completely invalid
        'v1.1.0', // valid but older
      ]);

      // Execute
      const result = await getLatestTag('v');

      // Verify - should return the highest valid semver tag
      expect(result).toBe('v1.2.0');
    });

    it('should handle empty version prefix correctly', async () => {
      // Setup
      const mockGetSemverTags = await import('git-semver-tags');
      vi.mocked(mockGetSemverTags.getSemverTags, { partial: true }).mockResolvedValue(['1.0.0', '2.0.0', '1.5.0']);

      // Execute
      const result = await getLatestTag('');

      // Verify
      expect(result).toBe('2.0.0');
      expect(mockGetSemverTags.getSemverTags).toHaveBeenCalledWith({ tagPrefix: '' });
    });

    it('should handle undefined version prefix correctly', async () => {
      // Setup
      const mockGetSemverTags = await import('git-semver-tags');
      vi.mocked(mockGetSemverTags.getSemverTags, { partial: true }).mockResolvedValue(['v1.0.0', 'v2.0.0']);

      // Execute
      const result = await getLatestTag(undefined);

      // Verify
      expect(result).toBe('v2.0.0');
      expect(mockGetSemverTags.getSemverTags).toHaveBeenCalledWith({ tagPrefix: undefined });
    });

    it('should handle single tag correctly', async () => {
      // Setup
      const mockGetSemverTags = await import('git-semver-tags');
      vi.mocked(mockGetSemverTags.getSemverTags, { partial: true }).mockResolvedValue(['v1.0.0']);

      // Execute
      const result = await getLatestTag('v');

      // Verify
      expect(result).toBe('v1.0.0');
      // Should not log ordering difference when there's only one tag
      expect(log).not.toHaveBeenCalledWith(expect.stringContaining('Tag ordering differs'), 'debug');
    });

    it('should handle complex prerelease identifiers correctly', async () => {
      // Setup
      const mockGetSemverTags = await import('git-semver-tags');
      vi.mocked(mockGetSemverTags.getSemverTags, { partial: true }).mockResolvedValue([
        'v1.0.0-beta.1.2.3',
        'v1.0.0-alpha.1',
        'v1.0.0-rc.1',
        'v1.0.0', // stable should be latest
      ]);

      // Execute
      const result = await getLatestTag('v');

      // Verify
      expect(result).toBe('v1.0.0');
    });

    it('should handle package names with special regex characters', async () => {
      // Setup
      const mockGetSemverTags = await import('git-semver-tags');
      vi.mocked(mockGetSemverTags.getSemverTags, { partial: true }).mockResolvedValue([
        '@scope/package-with.dots@v1.0.0',
        '@scope/package-with+plus@v2.0.0',
        '@scope/other-package@v1.5.0',
      ]);

      // Execute
      const result = await getLatestTagForPackage('@scope/package-with.dots', 'v', {
        packageSpecificTags: true,
      });

      // Verify - should correctly match package with dots in name
      expect(result).toBe('@scope/package-with.dots@v1.0.0');
    });

    it('should handle version comparison edge cases correctly', async () => {
      // Setup
      const mockGetSemverTags = await import('git-semver-tags');
      vi.mocked(mockGetSemverTags.getSemverTags, { partial: true }).mockResolvedValue([
        'v10.0.0', // double digit major
        'v2.0.0',
        'v1.10.0', // double digit minor
        'v1.2.10', // double digit patch
      ]);

      // Execute
      const result = await getLatestTag('v');

      // Verify - should correctly handle double digit versions
      expect(result).toBe('v10.0.0');
    });

    it('should handle version comparison edge cases with prereleases correctly', async () => {
      // Setup
      const mockGetSemverTags = await import('git-semver-tags');
      vi.mocked(mockGetSemverTags.getSemverTags, { partial: true }).mockResolvedValue([
        'v1.0.0-alpha', // prerelease
        'v1.0.0', // stable should be higher than prerelease
        'v0.9.9', // older patch
      ]);

      // Execute
      const result = await getLatestTag('v');

      // Verify - stable should be higher than prerelease
      expect(result).toBe('v1.0.0');
    });
  });

  describe('Semantic Ordering for Unreachable Tags Feature', () => {
    it('should prioritize semantic version over chronological order for global tags', async () => {
      // Setup - this simulates the "unreachable tags" scenario where chronological != semantic order
      const mockGetSemverTags = await import('git-semver-tags');
      vi.mocked(mockGetSemverTags.getSemverTags, { partial: true }).mockResolvedValue([
        'v0.7.1', // chronologically first (created after v0.8.0 due to hotfix)
        'v0.8.0', // semantically latest (created earlier but higher version)
        'v0.7.0',
      ]);

      // Execute
      const result = await getLatestTag('v');

      // Verify - should return semantic latest, not chronological latest
      expect(result).toBe('v0.8.0');
      expect(log).toHaveBeenCalledWith(
        'Tag ordering differs: chronological latest is v0.7.1, semantic latest is v0.8.0',
        'debug',
      );
      expect(log).toHaveBeenCalledWith('Using semantic latest (v0.8.0) to handle out-of-order tag creation', 'info');
    });

    it('should handle package-specific tags with complex version prefixes correctly', async () => {
      // Setup - package tags with complex prefixes (simulates custom tag templates)
      const mockGetSemverTags = await import('git-semver-tags');
      vi.mocked(mockGetSemverTags.getSemverTags, { partial: true }).mockResolvedValue([
        'frontend@release-1.0.5', // chronologically first
        'frontend@release-2.1.0', // semantically latest
        'frontend@release-1.9.0',
        'backend@release-3.0.0', // different package
      ]);

      // Execute
      const result = await getLatestTagForPackage('frontend', 'release-', {
        packageSpecificTags: true,
      });

      // Verify - should extract version correctly and return semantic latest
      expect(result).toBe('frontend@release-2.1.0');
      expect(log).toHaveBeenCalledWith('Using semantically latest tag: frontend@release-2.1.0', 'debug');
    });

    it('should handle mixed prefix and no-prefix scenarios', async () => {
      // Setup - mix of tags with and without prefixes
      const mockGetSemverTags = await import('git-semver-tags');
      vi.mocked(mockGetSemverTags.getSemverTags, { partial: true }).mockResolvedValue([
        'api@1.0.5', // chronologically first, no prefix
        'api@1.2.0', // semantically latest, no prefix
        'other@v2.0.0', // different package with prefix
      ]);

      // Execute - no prefix specified
      const result = await getLatestTagForPackage('api', undefined, {
        packageSpecificTags: true,
      });

      // Verify - should handle no prefix correctly
      expect(result).toBe('api@1.2.0');
      expect(log).toHaveBeenCalledWith('Using semantically latest tag: api@1.2.0', 'debug');
    });

    it('should gracefully handle malformed version tags in semantic sorting', async () => {
      // Setup - mix of valid and malformed tags
      const mockGetSemverTags = await import('git-semver-tags');
      vi.mocked(mockGetSemverTags.getSemverTags, { partial: true }).mockResolvedValue([
        'pkg@invalid-version', // malformed version
        'pkg@1.0.0', // valid version, should be selected
        'pkg@not-a-version', // another malformed version
      ]);

      // Execute
      const result = await getLatestTagForPackage('pkg', undefined, {
        packageSpecificTags: true,
      });

      // Verify - should fallback to valid semver tags
      expect(result).toBe('pkg@1.0.0');
      expect(log).toHaveBeenCalledWith('Using semantically latest tag: pkg@1.0.0', 'debug');
    });

    it('should maintain chronological order when semantic versions are identical', async () => {
      // Setup - identical semantic versions (edge case)
      const mockGetSemverTags = await import('git-semver-tags');
      vi.mocked(mockGetSemverTags.getSemverTags, { partial: true }).mockResolvedValue([
        'v1.0.0', // chronologically first
        'v1.0.0', // identical version (shouldn't happen in practice but testing edge case)
      ]);

      // Execute
      const result = await getLatestTag('v');

      // Verify - should return first (chronological) when versions are identical
      expect(result).toBe('v1.0.0');
    });
  });
});
