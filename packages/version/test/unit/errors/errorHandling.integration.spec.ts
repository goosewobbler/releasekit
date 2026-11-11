import { EXIT_CODES, exitCodeForError } from '@releasekit/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BaseVersionError } from '../../../src/errors/baseError.js';
import { StrictReachableError } from '../../../src/errors/strictReachableError.js';
import { createVersionError, VersionError, VersionErrorCode } from '../../../src/errors/versionError.js';

describe('Error Handling Integration', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('Streamlined error handling pattern', () => {
    it('should handle any version error with single type guard', () => {
      const versionError = createVersionError(VersionErrorCode.CONFIG_REQUIRED);
      const regularError = new Error('Regular error');

      expect(BaseVersionError.isVersionError(versionError)).toBe(true);
      expect(BaseVersionError.isVersionError(regularError)).toBe(false);
    });

    it('should log version errors through the type guard and skip other errors', () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const versionError = createVersionError(VersionErrorCode.PACKAGES_NOT_FOUND);

      const errors = [versionError, new Error('Other error')];

      for (const error of errors) {
        if (BaseVersionError.isVersionError(error)) {
          error.logError();
        }
      }

      const errorMessages = errorSpy.mock.calls.map((c) => c[0]);
      expect(errorMessages.some((m: string) => m.includes('Failed to get packages information'))).toBe(true);
      expect(errorMessages.some((m: string) => m.includes('Suggested solutions'))).toBe(true);
    });

    it('should log the message, a header and each suggestion', () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      createVersionError(VersionErrorCode.INVALID_CONFIG).logError();

      // 1 error message + 1 header + 3 suggestions
      expect(errorSpy).toHaveBeenCalledTimes(5);
      expect(errorSpy.mock.calls[0]?.[0]).toContain('Invalid configuration');
    });
  });

  describe('Error suggestion system', () => {
    it('should provide contextually relevant suggestions for different error types', () => {
      const configError = createVersionError(VersionErrorCode.CONFIG_REQUIRED);
      const packageError = createVersionError(VersionErrorCode.PACKAGES_NOT_FOUND);

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
  });

  describe('Type safety and inheritance', () => {
    it('should maintain proper inheritance chain', () => {
      const versionError = createVersionError(VersionErrorCode.CONFIG_REQUIRED);

      expect(versionError instanceof Error).toBe(true);
      expect(versionError instanceof BaseVersionError).toBe(true);
      expect(versionError instanceof VersionError).toBe(true);
    });

    it('should have proper error names for debugging', () => {
      expect(new VersionError('Test', 'CODE').name).toBe('VersionError');
    });

    it('should preserve error stack traces', () => {
      const versionError = createVersionError(VersionErrorCode.CONFIG_REQUIRED);

      expect(versionError.stack).toContain('VersionError');
    });
  });

  describe('Exit codes', () => {
    it('should give every error code its exit-code family rather than the generic exit 1', () => {
      const errors: BaseVersionError[] = [
        ...Object.values(VersionErrorCode).map((code) => createVersionError(code)),
        new StrictReachableError('baseline unreachable'),
      ];

      const unmapped = errors.filter((e) => exitCodeForError(e) === EXIT_CODES.GENERAL_ERROR).map((e) => e.code);

      expect(unmapped).toEqual([]);
    });
  });
});
