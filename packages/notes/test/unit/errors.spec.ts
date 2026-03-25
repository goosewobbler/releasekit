import { EXIT_CODES, ReleaseKitError } from '@releasekit/core';
import { describe, expect, it, vi } from 'vitest';
import {
  ConfigError,
  GitHubError,
  getExitCode,
  InputParseError,
  LLMError,
  NotesError,
  TemplateError,
} from '../../src/errors/index.js';

describe('Error classes', () => {
  it('should have the expected code for each error type', () => {
    expect(new InputParseError('x').code).toBe('INPUT_PARSE_ERROR');
    expect(new TemplateError('x').code).toBe('TEMPLATE_ERROR');
    expect(new LLMError('x').code).toBe('LLM_ERROR');
    expect(new GitHubError('x').code).toBe('GITHUB_ERROR');
    expect(new ConfigError('x').code).toBe('CONFIG_ERROR');
  });

  it('should extend NotesError and ReleaseKitError', () => {
    const errors = [
      new InputParseError('x'),
      new TemplateError('x'),
      new LLMError('x'),
      new GitHubError('x'),
      new ConfigError('x'),
    ];
    for (const err of errors) {
      expect(err).toBeInstanceOf(NotesError);
      expect(err).toBeInstanceOf(ReleaseKitError);
    }
  });

  it('should expose at least one suggestion', () => {
    const errors = [
      new InputParseError('x'),
      new TemplateError('x'),
      new LLMError('x'),
      new GitHubError('x'),
      new ConfigError('x'),
    ];
    for (const err of errors) {
      expect(err.suggestions.length).toBeGreaterThan(0);
    }
  });
});

describe('ReleaseKitError.isReleaseKitError()', () => {
  it('should return true for NotesError subclasses', () => {
    expect(ReleaseKitError.isReleaseKitError(new InputParseError('x'))).toBe(true);
    expect(ReleaseKitError.isReleaseKitError(new LLMError('x'))).toBe(true);
    expect(ReleaseKitError.isReleaseKitError(new ConfigError('x'))).toBe(true);
  });

  it('should return false for plain errors and non-errors', () => {
    expect(ReleaseKitError.isReleaseKitError(new Error('x'))).toBe(false);
    expect(ReleaseKitError.isReleaseKitError('string')).toBe(false);
    expect(ReleaseKitError.isReleaseKitError(null)).toBe(false);
  });
});

describe('getExitCode()', () => {
  it('should map each error type to the correct exit code', () => {
    expect(getExitCode(new ConfigError('x'))).toBe(EXIT_CODES.CONFIG_ERROR);
    expect(getExitCode(new InputParseError('x'))).toBe(EXIT_CODES.INPUT_ERROR);
    expect(getExitCode(new TemplateError('x'))).toBe(EXIT_CODES.TEMPLATE_ERROR);
    expect(getExitCode(new LLMError('x'))).toBe(EXIT_CODES.LLM_ERROR);
    expect(getExitCode(new GitHubError('x'))).toBe(EXIT_CODES.GITHUB_ERROR);
  });
});

describe('logError()', () => {
  it('should print error message and suggestions', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const err = new InputParseError('bad input');
    err.logError();

    // All log output now goes to console.error (stderr)
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('bad input'));
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Suggested solutions'));

    errorSpy.mockRestore();
  });
});
