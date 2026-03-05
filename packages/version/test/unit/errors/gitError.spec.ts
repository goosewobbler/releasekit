import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BaseVersionError } from '../../../src/errors/baseError.js';
import { createGitError, GitError, GitErrorCode } from '../../../src/errors/gitError.js';

describe('GitError', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('GitError class', () => {
    it('should extend BaseVersionError', () => {
      const error = new GitError('Git error message', 'GIT_CODE');

      expect(error instanceof BaseVersionError).toBe(true);
      expect(error instanceof GitError).toBe(true);
      expect(error.message).toBe('Git error message');
      expect(error.code).toBe('GIT_CODE');
    });

    it('should inherit logError functionality from base class', () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const error = new GitError('Git error', 'GIT_CODE', ['Suggestion 1']);

      error.logError();

      // error + header + 1 suggestion = 3 calls
      expect(errorSpy).toHaveBeenCalledTimes(3);
      expect(errorSpy.mock.calls[0]?.[0]).toContain('Git error');
      expect(errorSpy.mock.calls[1]?.[0]).toContain('Suggested solutions');
      expect(errorSpy.mock.calls[2]?.[0]).toContain('1. Suggestion 1');
    });
  });

  describe('createGitError factory function', () => {
    it('should create GitError with NOT_GIT_REPO code and suggestions', () => {
      const error = createGitError(GitErrorCode.NOT_GIT_REPO);

      expect(error).toBeInstanceOf(GitError);
      expect(error.code).toBe(GitErrorCode.NOT_GIT_REPO);
      expect(error.message).toBe('Not a git repository');
      expect(error.suggestions).toEqual([
        'Initialize git repository with: git init',
        'Ensure you are in the correct directory',
      ]);
    });

    it('should create GitError with TAG_ALREADY_EXISTS code and helpful suggestions', () => {
      const error = createGitError(GitErrorCode.TAG_ALREADY_EXISTS, 'Tag v1.0.0 already exists');

      expect(error).toBeInstanceOf(GitError);
      expect(error.code).toBe(GitErrorCode.TAG_ALREADY_EXISTS);
      expect(error.message).toBe('Git tag already exists: Tag v1.0.0 already exists');
      expect(error.suggestions).toEqual([
        'Delete the existing tag: git tag -d <tag-name>',
        'Use a different version by incrementing manually',
        'Check if this version was already released',
      ]);
    });

    it('should create GitError without suggestions for codes that do not have them', () => {
      const error = createGitError(GitErrorCode.GIT_ERROR);

      expect(error).toBeInstanceOf(GitError);
      expect(error.code).toBe(GitErrorCode.GIT_ERROR);
      expect(error.message).toBe('Git operation failed');
      expect(error.suggestions).toEqual([]);
    });

    it('should handle details parameter correctly', () => {
      const error = createGitError(GitErrorCode.GIT_PROCESS_ERROR, 'Command failed with exit code 1');

      expect(error.message).toBe('Failed to create new version: Command failed with exit code 1');
      expect(error.code).toBe(GitErrorCode.GIT_PROCESS_ERROR);
    });

    it('should create error without details when not provided', () => {
      const error = createGitError(GitErrorCode.NO_COMMIT_MESSAGE);

      expect(error.message).toBe('Commit message is required');
      expect(error.code).toBe(GitErrorCode.NO_COMMIT_MESSAGE);
    });

    it('should work with all GitErrorCode enum values', () => {
      const allCodes = [
        GitErrorCode.NOT_GIT_REPO,
        GitErrorCode.GIT_PROCESS_ERROR,
        GitErrorCode.NO_FILES,
        GitErrorCode.NO_COMMIT_MESSAGE,
        GitErrorCode.GIT_ERROR,
        GitErrorCode.TAG_ALREADY_EXISTS,
      ];

      for (const code of allCodes) {
        const error = createGitError(code);
        expect(error).toBeInstanceOf(GitError);
        expect(error.code).toBe(code);
        expect(error.message).toBeTruthy();
      }
    });
  });

  describe('Suggestions integration', () => {
    it('should log TAG_ALREADY_EXISTS error with suggestions', () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const error = createGitError(GitErrorCode.TAG_ALREADY_EXISTS);

      error.logError();

      // error + header + 3 suggestions = 5 calls
      expect(errorSpy).toHaveBeenCalledTimes(5);
      expect(errorSpy.mock.calls[0]?.[0]).toContain('Git tag already exists');
      expect(errorSpy.mock.calls[2]?.[0]).toContain('Delete the existing tag');
      expect(errorSpy.mock.calls[3]?.[0]).toContain('Use a different version');
      expect(errorSpy.mock.calls[4]?.[0]).toContain('Check if this version was already released');
    });

    it('should log NOT_GIT_REPO error with suggestions', () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const error = createGitError(GitErrorCode.NOT_GIT_REPO);

      error.logError();

      // error + header + 2 suggestions = 4 calls
      expect(errorSpy).toHaveBeenCalledTimes(4);
      expect(errorSpy.mock.calls[0]?.[0]).toContain('Not a git repository');
      expect(errorSpy.mock.calls[2]?.[0]).toContain('Initialize git repository');
      expect(errorSpy.mock.calls[3]?.[0]).toContain('Ensure you are in the correct directory');
    });

    it('should not log suggestions for error codes without them', () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const error = createGitError(GitErrorCode.GIT_ERROR);

      error.logError();

      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(errorSpy.mock.calls[0]?.[0]).toContain('Git operation failed');
    });
  });
});
