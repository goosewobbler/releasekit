import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BaseVersionError } from '../../../src/errors/baseError.js';

// Create a concrete test class since BaseVersionError is not abstract itself
// but extends the abstract ReleaseKitError
class TestVersionError extends BaseVersionError {}

describe('BaseVersionError', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('Constructor and Basic Properties', () => {
    it('should create error with message and code', () => {
      const error = new TestVersionError('Test error message', 'TEST_CODE');

      expect(error.message).toBe('Test error message');
      expect(error.code).toBe('TEST_CODE');
      expect(error.name).toBe('TestVersionError');
      expect(error.suggestions).toEqual([]);
    });

    it('should create error with suggestions', () => {
      const suggestions = ['First suggestion', 'Second suggestion'];
      const error = new TestVersionError('Test error', 'TEST_CODE', suggestions);

      expect(error.suggestions).toEqual(suggestions);
    });

    it('should extend Error properly', () => {
      const error = new TestVersionError('Test error', 'TEST_CODE');

      expect(error instanceof Error).toBe(true);
      expect(error instanceof BaseVersionError).toBe(true);
    });
  });

  describe('logError method', () => {
    it('should log error message without suggestions', () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const error = new TestVersionError('Test error message', 'TEST_CODE');

      error.logError();

      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(errorSpy.mock.calls[0]?.[0]).toContain('Test error message');
      expect(logSpy).not.toHaveBeenCalled();
    });

    it('should log error message with suggestions', () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const suggestions = ['First suggestion', 'Second suggestion', 'Third suggestion'];
      const error = new TestVersionError('Test error message', 'TEST_CODE', suggestions);

      error.logError();

      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(errorSpy.mock.calls[0]?.[0]).toContain('Test error message');
      // Suggestions header + 3 suggestions = 4 console.log calls
      expect(logSpy).toHaveBeenCalledTimes(4);
      expect(logSpy.mock.calls[0]?.[0]).toContain('Suggested solutions');
      expect(logSpy.mock.calls[1]?.[0]).toContain('1. First suggestion');
      expect(logSpy.mock.calls[2]?.[0]).toContain('2. Second suggestion');
      expect(logSpy.mock.calls[3]?.[0]).toContain('3. Third suggestion');
    });

    it('should not log suggestions if array is empty', () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const error = new TestVersionError('Test error message', 'TEST_CODE', []);

      error.logError();

      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(logSpy).not.toHaveBeenCalled();
    });

    it('should handle single suggestion correctly', () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const error = new TestVersionError('Test error', 'TEST_CODE', ['Only suggestion']);

      error.logError();

      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(logSpy).toHaveBeenCalledTimes(2);
      expect(logSpy.mock.calls[0]?.[0]).toContain('Suggested solutions');
      expect(logSpy.mock.calls[1]?.[0]).toContain('1. Only suggestion');
    });
  });

  describe('isVersionError type guard', () => {
    it('should return true for BaseVersionError instances', () => {
      const error = new TestVersionError('Test error', 'TEST_CODE');

      expect(BaseVersionError.isVersionError(error)).toBe(true);
    });

    it('should return false for regular Error instances', () => {
      const error = new Error('Regular error');

      expect(BaseVersionError.isVersionError(error)).toBe(false);
    });

    it('should return false for non-error values', () => {
      expect(BaseVersionError.isVersionError('string')).toBe(false);
      expect(BaseVersionError.isVersionError(42)).toBe(false);
      expect(BaseVersionError.isVersionError(null)).toBe(false);
      expect(BaseVersionError.isVersionError(undefined)).toBe(false);
      expect(BaseVersionError.isVersionError({})).toBe(false);
    });

    it('should return true for subclasses of BaseVersionError', () => {
      class SpecificError extends BaseVersionError {}
      const error = new SpecificError('Specific error', 'SPECIFIC_CODE');

      expect(BaseVersionError.isVersionError(error)).toBe(true);
    });
  });

  describe('Integration with GitError and VersionError', () => {
    it('should work correctly with GitError instances', async () => {
      const { GitError } = await import('../../../src/errors/gitError.js');
      const gitError = new GitError('Git error message', 'GIT_ERROR_CODE');

      expect(BaseVersionError.isVersionError(gitError)).toBe(true);
      expect(gitError instanceof BaseVersionError).toBe(true);
    });

    it('should work correctly with VersionError instances', async () => {
      const { VersionError } = await import('../../../src/errors/versionError.js');
      const versionError = new VersionError('Version error message', 'VERSION_ERROR_CODE');

      expect(BaseVersionError.isVersionError(versionError)).toBe(true);
      expect(versionError instanceof BaseVersionError).toBe(true);
    });
  });
});
