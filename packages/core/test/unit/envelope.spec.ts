import { describe, expect, it } from 'vitest';
import {
  ENVELOPE_SCHEMA_VERSION,
  errorEnvelope,
  exitCodeForError,
  successEnvelope,
  toEnvelopeError,
} from '../../src/envelope.js';
import { EXIT_CODES, ReleaseKitError } from '../../src/errors.js';

class TestConfigError extends ReleaseKitError {
  readonly code = 'CONFIG_ERROR';
  readonly suggestions: string[] = [];
}

class TestLLMError extends ReleaseKitError {
  readonly code = 'LLM_ERROR';
  readonly suggestions: string[] = [];
  readonly retryable: boolean;
  constructor(message: string, retryable: boolean) {
    super(message);
    this.retryable = retryable;
  }
}

describe('envelope', () => {
  describe('successEnvelope', () => {
    it('should wrap data with success status and defaults', () => {
      expect(successEnvelope({ tags: ['v1.2.3'] })).toEqual({
        schemaVersion: ENVELOPE_SCHEMA_VERSION,
        status: 'success',
        changed: false,
        data: { tags: ['v1.2.3'] },
        warnings: [],
        errors: [],
      });
    });

    it('should carry changed and warnings when provided', () => {
      const env = successEnvelope(null, { changed: true, warnings: [{ message: 'heads up' }] });
      expect(env.changed).toBe(true);
      expect(env.warnings).toEqual([{ message: 'heads up' }]);
    });
  });

  describe('errorEnvelope', () => {
    it('should carry error status, null data, and the given errors', () => {
      const errors = [{ code: 'X_ERROR', category: 'x', retryable: false, message: 'boom' }];
      expect(errorEnvelope(errors)).toEqual({
        schemaVersion: ENVELOPE_SCHEMA_VERSION,
        status: 'error',
        changed: false,
        data: null,
        warnings: [],
        errors,
      });
    });
  });

  describe('toEnvelopeError', () => {
    it('should map a ReleaseKitError to its code and derived category', () => {
      expect(toEnvelopeError(new TestConfigError('bad config'))).toEqual({
        code: 'CONFIG_ERROR',
        category: 'config',
        retryable: false,
        message: 'bad config',
      });
    });

    it('should surface a retryable ReleaseKitError as retryable', () => {
      expect(toEnvelopeError(new TestLLMError('timeout', true)).retryable).toBe(true);
    });

    it('should treat an unclassified error as non-retryable', () => {
      expect(toEnvelopeError(new TestLLMError('auth', false)).retryable).toBe(false);
    });

    it('should map a plain Error to GENERAL_ERROR', () => {
      expect(toEnvelopeError(new Error('oops'))).toEqual({
        code: 'GENERAL_ERROR',
        category: 'general',
        retryable: false,
        message: 'oops',
      });
    });

    it('should stringify a non-Error thrown value', () => {
      expect(toEnvelopeError('just a string').message).toBe('just a string');
    });
  });

  describe('exitCodeForError', () => {
    it('should map a ReleaseKitError code to its exit code', () => {
      expect(exitCodeForError(new TestConfigError('x'))).toBe(EXIT_CODES.CONFIG_ERROR);
    });

    it('should default to GENERAL_ERROR for a plain Error', () => {
      expect(exitCodeForError(new Error('x'))).toBe(EXIT_CODES.GENERAL_ERROR);
    });
  });
});
