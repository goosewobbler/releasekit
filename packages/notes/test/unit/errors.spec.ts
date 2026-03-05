import { ReleaseKitError } from '@releasekit/core';
import { describe, expect, it, vi } from 'vitest';
import {
  ChangelogCreatorError,
  ConfigError,
  EXIT_CODES,
  GitHubError,
  getExitCode,
  InputParseError,
  LLMError,
  NotesError,
  TemplateError,
} from '../../src/errors/index.js';

describe('Error classes', () => {
  it('InputParseError has correct code and is a NotesError', () => {
    const err = new InputParseError('bad input');
    expect(err.code).toBe('INPUT_PARSE_ERROR');
    expect(err.message).toBe('bad input');
    expect(err).toBeInstanceOf(NotesError);
    expect(err).toBeInstanceOf(ReleaseKitError);
    expect(err.suggestions.length).toBeGreaterThan(0);
  });

  it('ChangelogCreatorError alias works for backwards compatibility', () => {
    const err = new InputParseError('bad input');
    expect(err).toBeInstanceOf(ChangelogCreatorError);
  });

  it('TemplateError has correct code', () => {
    const err = new TemplateError('bad template');
    expect(err.code).toBe('TEMPLATE_ERROR');
    expect(err).toBeInstanceOf(NotesError);
  });

  it('LLMError has correct code', () => {
    const err = new LLMError('provider failed');
    expect(err.code).toBe('LLM_ERROR');
    expect(err).toBeInstanceOf(NotesError);
  });

  it('GitHubError has correct code', () => {
    const err = new GitHubError('unauthorized');
    expect(err.code).toBe('GITHUB_ERROR');
  });

  it('ConfigError has correct code', () => {
    const err = new ConfigError('invalid config');
    expect(err.code).toBe('CONFIG_ERROR');
  });
});

describe('ReleaseKitError.isReleaseKitError()', () => {
  it('returns true for NotesError subclasses', () => {
    expect(ReleaseKitError.isReleaseKitError(new InputParseError('x'))).toBe(true);
    expect(ReleaseKitError.isReleaseKitError(new LLMError('x'))).toBe(true);
    expect(ReleaseKitError.isReleaseKitError(new ConfigError('x'))).toBe(true);
  });

  it('returns false for plain errors and non-errors', () => {
    expect(ReleaseKitError.isReleaseKitError(new Error('x'))).toBe(false);
    expect(ReleaseKitError.isReleaseKitError('string')).toBe(false);
    expect(ReleaseKitError.isReleaseKitError(null)).toBe(false);
  });
});

describe('getExitCode()', () => {
  it('maps each error type to the correct exit code', () => {
    expect(getExitCode(new ConfigError('x'))).toBe(EXIT_CODES.CONFIG_ERROR);
    expect(getExitCode(new InputParseError('x'))).toBe(EXIT_CODES.INPUT_ERROR);
    expect(getExitCode(new TemplateError('x'))).toBe(EXIT_CODES.TEMPLATE_ERROR);
    expect(getExitCode(new LLMError('x'))).toBe(EXIT_CODES.LLM_ERROR);
    expect(getExitCode(new GitHubError('x'))).toBe(EXIT_CODES.GITHUB_ERROR);
  });

  it('exit codes match the plan spec', () => {
    expect(EXIT_CODES.SUCCESS).toBe(0);
    expect(EXIT_CODES.GENERAL_ERROR).toBe(1);
    expect(EXIT_CODES.CONFIG_ERROR).toBe(2);
    expect(EXIT_CODES.INPUT_ERROR).toBe(3);
    expect(EXIT_CODES.TEMPLATE_ERROR).toBe(4);
    expect(EXIT_CODES.LLM_ERROR).toBe(5);
    expect(EXIT_CODES.GITHUB_ERROR).toBe(6);
  });
});

describe('logError()', () => {
  it('prints error message and suggestions', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const err = new InputParseError('bad input');
    err.logError();

    // All log output now goes to console.error (stderr)
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('bad input'));
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Suggested solutions'));

    errorSpy.mockRestore();
  });
});
