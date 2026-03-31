import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BaseVersionError } from '../../../src/errors/baseError.js';
import { createGitError, GitError, GitErrorCode } from '../../../src/errors/gitError.js';
import { createVersionError, VersionError, VersionErrorCode } from '../../../src/errors/versionError.js';

describe('Error Handling Integration', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('Streamlined error handling pattern', () => {
    it('should handle any version error with single type guard', () => {
      const gitError = createGitError(GitErrorCode.TAG_ALREADY_EXISTS);
      const versionError = createVersionError(VersionErrorCode.CONFIG_REQUIRED);
      const regularError = new Error('Regular error');

      expect(BaseVersionError.isVersionError(gitError)).toBe(true);
      expect(BaseVersionError.isVersionError(versionError)).toBe(true);
      expect(BaseVersionError.isVersionError(regularError)).toBe(false);
    });

    it('should demonstrate the old vs new error handling pattern', () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const gitError = createGitError(GitErrorCode.TAG_ALREADY_EXISTS);
      const versionError = createVersionError(VersionErrorCode.PACKAGES_NOT_FOUND);

      const errors = [gitError, versionError, new Error('Other error')];

      for (const error of errors) {
        if (BaseVersionError.isVersionError(error)) {
          error.logError();
        } else {
          console.log('Non-version error:', error.message);
        }
      }

      // Both version errors were logged via console.error
      const errorMessages = errorSpy.mock.calls.map((c) => c[0]);
      expect(errorMessages.some((m: string) => m.includes('Git tag already exists'))).toBe(true);
      expect(errorMessages.some((m: string) => m.includes('Failed to get packages information'))).toBe(true);

      // Suggestions were also logged via console.error (new behavior)
      expect(errorMessages.some((m: string) => m.includes('Suggested solutions'))).toBe(true);
    });

    it('should maintain backward compatibility with existing error types', () => {
      const gitError = new GitError('Git error', 'GIT_CODE');
      const versionError = new VersionError('Version error', 'VERSION_CODE');

      expect(gitError instanceof GitError).toBe(true);
      expect(versionError instanceof VersionError).toBe(true);

      expect(BaseVersionError.isVersionError(gitError)).toBe(true);
      expect(BaseVersionError.isVersionError(versionError)).toBe(true);
    });

    it('should provide consistent error logging behavior across error types', () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const gitError = createGitError(GitErrorCode.NOT_GIT_REPO);
      const versionError = createVersionError(VersionErrorCode.INVALID_CONFIG);

      gitError.logError();
      versionError.logError();

      // Both errors logged via console.error
      // Each error: 1 error message + 1 header + N suggestions
      // NOT_GIT_REPO: 1 + 1 + 2 = 4, INVALID_CONFIG: 1 + 1 + 3 = 5, total = 9
      expect(errorSpy).toHaveBeenCalledTimes(9);
      expect(errorSpy.mock.calls[0]?.[0]).toContain('Not a git repository');
      expect(errorSpy.mock.calls[4]?.[0]).toContain('Invalid configuration');
    });
  });

  describe('Error suggestion system', () => {
    it('should provide contextually relevant suggestions for different error types', () => {
      const tagError = createGitError(GitErrorCode.TAG_ALREADY_EXISTS);
      const repoError = createGitError(GitErrorCode.NOT_GIT_REPO);
      const configError = createVersionError(VersionErrorCode.CONFIG_REQUIRED);
      const packageError = createVersionError(VersionErrorCode.PACKAGES_NOT_FOUND);

      expect(tagError.suggestions).toEqual([
        'Delete the existing tag: git tag -d <tag-name>',
        'Use a different version by incrementing manually',
        'Check if this version was already released',
      ]);

      expect(repoError.suggestions).toEqual([
        'Initialize git repository with: git init',
        'Ensure you are in the correct directory',
      ]);

      expect(configError.suggestions).toEqual([
        'Create a releasekit.config.json file in your project root',
        'Check the documentation for configuration examples',
      ]);

      expect(packageError.suggestions).toEqual([
        'Ensure package.json or Cargo.toml files exist in your project',
        'Check workspace configuration (pnpm-workspace.yaml, etc.)',
        'Verify file permissions and paths',
      ]);
    });

    it('should handle errors without suggestions gracefully', () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const simpleGitError = createGitError(GitErrorCode.GIT_ERROR);

      simpleGitError.logError();

      // Just the error message, no suggestions header
      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(errorSpy.mock.calls[0]?.[0]).toContain('Git operation failed');
    });
  });

  describe('Type safety and inheritance', () => {
    it('should maintain proper inheritance chain', () => {
      const gitError = createGitError(GitErrorCode.TAG_ALREADY_EXISTS);
      const versionError = createVersionError(VersionErrorCode.CONFIG_REQUIRED);

      expect(gitError instanceof Error).toBe(true);
      expect(gitError instanceof BaseVersionError).toBe(true);
      expect(gitError instanceof GitError).toBe(true);

      expect(versionError instanceof Error).toBe(true);
      expect(versionError instanceof BaseVersionError).toBe(true);
      expect(versionError instanceof VersionError).toBe(true);
    });

    it('should have proper error names for debugging', () => {
      const gitError = new GitError('Test', 'CODE');
      const versionError = new VersionError('Test', 'CODE');

      expect(gitError.name).toBe('GitError');
      expect(versionError.name).toBe('VersionError');
    });

    it('should preserve error stack traces', () => {
      const gitError = createGitError(GitErrorCode.GIT_ERROR);
      const versionError = createVersionError(VersionErrorCode.CONFIG_REQUIRED);

      expect(gitError.stack).toBeDefined();
      expect(versionError.stack).toBeDefined();
      expect(gitError.stack).toContain('GitError');
      expect(versionError.stack).toContain('VersionError');
    });
  });

  describe('Performance and efficiency', () => {
    it('should efficiently identify error types with single type guard call', () => {
      const errors = [
        createGitError(GitErrorCode.TAG_ALREADY_EXISTS),
        createVersionError(VersionErrorCode.CONFIG_REQUIRED),
        new Error('Regular error'),
        'not an error',
        null,
        undefined,
      ];

      const versionErrors = errors.filter(BaseVersionError.isVersionError);

      expect(versionErrors).toHaveLength(2);
      expect(versionErrors[0]).toBeInstanceOf(GitError);
      expect(versionErrors[1]).toBeInstanceOf(VersionError);
    });
  });
});
