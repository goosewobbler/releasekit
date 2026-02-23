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
  it('extends Error', () => {
    const error = new TestError('Test message');
    expect(error).toBeInstanceOf(Error);
  });

  it('sets name to constructor name', () => {
    const error = new TestError('Test message');
    expect(error.name).toBe('TestError');
  });

  it('preserves message', () => {
    const error = new TestError('Something went wrong');
    expect(error.message).toBe('Something went wrong');
  });

  it('has code property', () => {
    const error = new TestError('Test message');
    expect(error.code).toBe('TEST_ERROR');
  });

  it('has suggestions array', () => {
    const error = new TestError('Test message');
    expect(error.suggestions).toEqual(['Try this', 'Or try that']);
  });

  it('accepts custom suggestions', () => {
    const error = new TestError('Test message', ['Custom suggestion']);
    expect(error.suggestions).toEqual(['Custom suggestion']);
  });

  it('has default empty suggestions', () => {
    const error = new (class extends ReleaseKitError {
      readonly code = 'CODE';
      readonly suggestions: string[] = [];
    })('Test');
    expect(error.suggestions).toEqual([]);
  });

  it('logError logs message and suggestions', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const error = new TestError('Test message', ['Suggestion 1', 'Suggestion 2']);
    error.logError();

    expect(consoleSpy).toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalled();

    consoleSpy.mockRestore();
    logSpy.mockRestore();
  });

  it('logError handles empty suggestions gracefully', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const error = new TestError('Test message', []);
    error.logError();

    expect(consoleSpy).toHaveBeenCalled();
    expect(logSpy).not.toHaveBeenCalled();

    consoleSpy.mockRestore();
    logSpy.mockRestore();
  });

  it('isReleaseKitError returns true for ReleaseKitError', () => {
    const error = new TestError('Test');
    expect(ReleaseKitError.isReleaseKitError(error)).toBe(true);
  });

  it('isReleaseKitError returns false for regular Error', () => {
    const error = new Error('Test');
    expect(ReleaseKitError.isReleaseKitError(error)).toBe(false);
  });

  it('isReleaseKitError returns false for non-error values', () => {
    expect(ReleaseKitError.isReleaseKitError(null)).toBe(false);
    expect(ReleaseKitError.isReleaseKitError(undefined)).toBe(false);
    expect(ReleaseKitError.isReleaseKitError('error')).toBe(false);
    expect(ReleaseKitError.isReleaseKitError({})).toBe(false);
  });
});

describe('EXIT_CODES', () => {
  it('has SUCCESS code 0', () => {
    expect(EXIT_CODES.SUCCESS).toBe(0);
  });

  it('has GENERAL_ERROR code 1', () => {
    expect(EXIT_CODES.GENERAL_ERROR).toBe(1);
  });

  it('has CONFIG_ERROR code 2', () => {
    expect(EXIT_CODES.CONFIG_ERROR).toBe(2);
  });

  it('has INPUT_ERROR code 3', () => {
    expect(EXIT_CODES.INPUT_ERROR).toBe(3);
  });

  it('has TEMPLATE_ERROR code 4', () => {
    expect(EXIT_CODES.TEMPLATE_ERROR).toBe(4);
  });

  it('has LLM_ERROR code 5', () => {
    expect(EXIT_CODES.LLM_ERROR).toBe(5);
  });

  it('has GITHUB_ERROR code 6', () => {
    expect(EXIT_CODES.GITHUB_ERROR).toBe(6);
  });

  it('has GIT_ERROR code 7', () => {
    expect(EXIT_CODES.GIT_ERROR).toBe(7);
  });

  it('has VERSION_ERROR code 8', () => {
    expect(EXIT_CODES.VERSION_ERROR).toBe(8);
  });

  it('has PUBLISH_ERROR code 9', () => {
    expect(EXIT_CODES.PUBLISH_ERROR).toBe(9);
  });
});
