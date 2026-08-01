import { describe, expect, it } from 'vitest';
import {
  ENVELOPE_SCHEMA_VERSION,
  errorEnvelope,
  exitCodeForError,
  isEnvelope,
  successEnvelope,
  toEnvelopeError,
  unwrapEnvelope,
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

  describe('errorEnvelope partial progress', () => {
    it('should carry data and changed when a command failed partway with progress to report', () => {
      const env = errorEnvelope([toEnvelopeError(new Error('registry rejected'))], {
        data: { npm: ['@acme/a'] },
        changed: true,
      });
      expect(env.status).toBe('error');
      expect(env.data).toEqual({ npm: ['@acme/a'] });
      expect(env.changed).toBe(true);
    });
  });

  describe('isEnvelope', () => {
    it('should accept an envelope and reject bare payloads', () => {
      expect(isEnvelope(successEnvelope({ tags: [] }))).toBe(true);
      expect(isEnvelope({ dryRun: false, updates: [], tags: [] })).toBe(false);
      expect(isEnvelope(null)).toBe(false);
      expect(isEnvelope('a string')).toBe(false);
    });
  });

  describe('unwrapEnvelope', () => {
    it('should return the payload from a success envelope', () => {
      const payload = { dryRun: false, updates: [{ packageName: 'a' }], tags: ['v1.0.0'] };
      expect(unwrapEnvelope(successEnvelope(payload))).toEqual(payload);
    });

    it('should pass a bare payload through unchanged', () => {
      const bare = { dryRun: false, updates: [], tags: [] };
      expect(unwrapEnvelope(bare)).toBe(bare);
    });

    it('should throw with the upstream message and code for an error envelope', () => {
      const env = errorEnvelope([toEnvelopeError(new TestConfigError('bad config'))]);
      expect(() => unwrapEnvelope(env)).toThrow(/CONFIG_ERROR.*bad config/);
    });

    it('should throw even when an error envelope carries no error detail', () => {
      expect(() => unwrapEnvelope(errorEnvelope([]))).toThrow(/reported no error detail/);
    });

    it('should refuse an envelope from a newer producer', () => {
      // The point of schemaVersion: a newer producer may have moved the payload, so handing `data`
      // onward would fail later as a shape error rather than a version mismatch.
      const future = { ...successEnvelope({ updates: [] }), schemaVersion: ENVELOPE_SCHEMA_VERSION + 1 };
      expect(() => unwrapEnvelope(future)).toThrow(/schemaVersion/);
    });

    it('should accept an envelope from an older producer', () => {
      const older = { ...successEnvelope({ updates: [] }), schemaVersion: 1 };
      expect(unwrapEnvelope(older)).toEqual({ updates: [] });
    });

    it('should refuse an unrecognised status', () => {
      const odd = { ...successEnvelope({ updates: [] }), status: 'partial' };
      expect(() => unwrapEnvelope(odd)).toThrow(/Unrecognised.*status/);
    });

    it('should refuse a success envelope carrying no payload', () => {
      // Otherwise the consumer reads fields off null and reports a shape error about the payload.
      expect(() => unwrapEnvelope(successEnvelope(null))).toThrow(/success but produced no data/);
    });
  });

  describe('exit-code table coverage', () => {
    it('should map every error code the packages throw to a family, not the generic exit 1', () => {
      // Guards the table against drift: a new code that isn't mapped silently degrades to exit 1, so
      // automation can no longer tell a git failure from a config one. Update the map when this fails.
      const thrownCodes = [
        // @releasekit/version
        'CONFIG_REQUIRED',
        'INVALID_CONFIG',
        'UNSAFE_CONFIG_PATH',
        'PACKAGES_NOT_FOUND',
        'PACKAGE_NOT_FOUND',
        'WORKSPACE_ERROR',
        'NOT_GIT_REPO',
        'GIT_PROCESS_ERROR',
        'TAG_ALREADY_EXISTS',
        'VERSION_CALCULATION_ERROR',
        'STRICT_REACHABLE_UNREACHABLE',
        'NO_COMMIT_MESSAGE',
        'NO_FILES',
        'GIT_ERROR',
        // @releasekit/publish
        'PIPELINE_STAGE_ERROR',
        'NPM_AUTH_ERROR',
        'NPM_PUBLISH_ERROR',
        'CARGO_AUTH_ERROR',
        'CARGO_PUBLISH_ERROR',
        'CARGO_TOML_ERROR',
        'PUB_AUTH_ERROR',
        'PUB_PUBLISH_ERROR',
        'PUBSPEC_YAML_ERROR',
        'FILE_COPY_ERROR',
        'VERIFICATION_FAILED',
        'GIT_COMMIT_ERROR',
        'GIT_PUSH_ERROR',
        'GIT_TAG_ERROR',
        'GITHUB_RELEASE_ERROR',
        'INPUT_VALIDATION_ERROR',
        'INPUT_PARSE_ERROR',
        // @releasekit/notes
        'CONFIG_ERROR',
        'GITHUB_ERROR',
        'LLM_ERROR',
        'TEMPLATE_ERROR',
      ];

      const unmapped = thrownCodes.filter((code) => {
        class Coded extends ReleaseKitError {
          readonly code = code;
          readonly suggestions: string[] = [];
        }
        return exitCodeForError(new Coded('x')) === EXIT_CODES.GENERAL_ERROR;
      });

      expect(unmapped).toEqual([]);
    });
  });
});
