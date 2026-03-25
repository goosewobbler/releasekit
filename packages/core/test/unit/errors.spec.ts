import { describe, expect, it, vi } from 'vitest';
import { EXIT_CODES, ReleaseKitError } from '../../src/errors.js';

class TestError extends ReleaseKitError {
  readonly code = 'TEST_ERROR';
  readonly suggestions: string[];

  constructor(message: string, suggestions?: string[]) {
    super(message);
    this.suggestions = suggestions ?? ['Try this', 'Or try that'];
  }
}

describe('ReleaseKitError', () => {
  it('should extend Error', () => {
    const error = new TestError('Test message');
    expect(error).toBeInstanceOf(Error);
  });

  it('should set name to constructor name', () => {
    const error = new TestError('Test message');
    expect(error.name).toBe('TestError');
  });

  it('should preserve message', () => {
    const error = new TestError('Something went wrong');
    expect(error.message).toBe('Something went wrong');
  });

  it('should have code property', () => {
    const error = new TestError('Test message');
    expect(error.code).toBe('TEST_ERROR');
  });

  it('should have suggestions array', () => {
    const error = new TestError('Test message');
    expect(error.suggestions).toEqual(['Try this', 'Or try that']);
  });

  it('should accept custom suggestions', () => {
    const error = new TestError('Test message', ['Custom suggestion']);
    expect(error.suggestions).toEqual(['Custom suggestion']);
  });

  it('should have default empty suggestions', () => {
    const error = new (class extends ReleaseKitError {
      readonly code = 'CODE';
      readonly suggestions: string[] = [];
    })('Test');
    expect(error.suggestions).toEqual([]);
  });

  describe('logError', () => {
    it('should log message and suggestions', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const error = new TestError('Test message', ['Suggestion 1', 'Suggestion 2']);
      error.logError();

      // error message + "Suggested solutions:" + 2 suggestions = 4 calls
      expect(consoleSpy.mock.calls.length).toBeGreaterThanOrEqual(4);

      consoleSpy.mockRestore();
    });

    it('should handle empty suggestions gracefully', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const error = new TestError('Test message', []);
      error.logError();

      // Only the error message, no suggestions
      expect(consoleSpy).toHaveBeenCalledTimes(1);

      consoleSpy.mockRestore();
    });
  });

  describe('isReleaseKitError', () => {
    it('should return true for ReleaseKitError', () => {
      const error = new TestError('Test');
      expect(ReleaseKitError.isReleaseKitError(error)).toBe(true);
    });

    it('should return false for regular Error', () => {
      const error = new Error('Test');
      expect(ReleaseKitError.isReleaseKitError(error)).toBe(false);
    });

    it('should return false for non-error values', () => {
      expect(ReleaseKitError.isReleaseKitError(null)).toBe(false);
      expect(ReleaseKitError.isReleaseKitError(undefined)).toBe(false);
      expect(ReleaseKitError.isReleaseKitError('error')).toBe(false);
      expect(ReleaseKitError.isReleaseKitError({})).toBe(false);
    });
  });
});

describe('EXIT_CODES', () => {
  it('should have SUCCESS code 0', () => {
    expect(EXIT_CODES.SUCCESS).toBe(0);
  });

  it('should have GENERAL_ERROR code 1', () => {
    expect(EXIT_CODES.GENERAL_ERROR).toBe(1);
  });

  it('should have CONFIG_ERROR code 2', () => {
    expect(EXIT_CODES.CONFIG_ERROR).toBe(2);
  });

  it('should have INPUT_ERROR code 3', () => {
    expect(EXIT_CODES.INPUT_ERROR).toBe(3);
  });

  it('should have TEMPLATE_ERROR code 4', () => {
    expect(EXIT_CODES.TEMPLATE_ERROR).toBe(4);
  });

  it('should have LLM_ERROR code 5', () => {
    expect(EXIT_CODES.LLM_ERROR).toBe(5);
  });

  it('should have GITHUB_ERROR code 6', () => {
    expect(EXIT_CODES.GITHUB_ERROR).toBe(6);
  });

  it('should have GIT_ERROR code 7', () => {
    expect(EXIT_CODES.GIT_ERROR).toBe(7);
  });

  it('should have VERSION_ERROR code 8', () => {
    expect(EXIT_CODES.VERSION_ERROR).toBe(8);
  });

  it('should have PUBLISH_ERROR code 9', () => {
    expect(EXIT_CODES.PUBLISH_ERROR).toBe(9);
  });
});
