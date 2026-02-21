import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BaseVersionError } from '../../../src/errors/baseError.js';
import { createVersionError, VersionError, VersionErrorCode } from '../../../src/errors/versionError.js';

describe('VersionError', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('VersionError class', () => {
    it('should extend BaseVersionError', () => {
      const error = new VersionError('Version error message', 'VERSION_CODE');

      expect(error instanceof BaseVersionError).toBe(true);
      expect(error instanceof VersionError).toBe(true);
      expect(error.message).toBe('Version error message');
      expect(error.code).toBe('VERSION_CODE');
    });

    it('should inherit logError functionality from base class', () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const error = new VersionError('Version error', 'VERSION_CODE', ['Fix suggestion']);

      error.logError();

      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(errorSpy.mock.calls[0]?.[0]).toContain('Version error');
      expect(logSpy).toHaveBeenCalledTimes(2);
      expect(logSpy.mock.calls[0]?.[0]).toContain('Suggested solutions');
      expect(logSpy.mock.calls[1]?.[0]).toContain('1. Fix suggestion');
    });
  });

  describe('createVersionError factory function', () => {
    it('should create VersionError with CONFIG_REQUIRED code and suggestions', () => {
      const error = createVersionError(VersionErrorCode.CONFIG_REQUIRED);

      expect(error).toBeInstanceOf(VersionError);
      expect(error.code).toBe(VersionErrorCode.CONFIG_REQUIRED);
      expect(error.message).toBe('Configuration is required');
      expect(error.suggestions).toEqual([
        'Create a version.config.json file in your project root',
        'Check the documentation for configuration examples',
      ]);
    });

    it('should create VersionError with PACKAGES_NOT_FOUND code and helpful suggestions', () => {
      const error = createVersionError(VersionErrorCode.PACKAGES_NOT_FOUND, 'No package.json found');

      expect(error).toBeInstanceOf(VersionError);
      expect(error.code).toBe(VersionErrorCode.PACKAGES_NOT_FOUND);
      expect(error.message).toBe('Failed to get packages information: No package.json found');
      expect(error.suggestions).toEqual([
        'Ensure package.json or Cargo.toml files exist in your project',
        'Check workspace configuration (pnpm-workspace.yaml, etc.)',
        'Verify file permissions and paths',
      ]);
    });

    it('should create VersionError with WORKSPACE_ERROR code and suggestions', () => {
      const error = createVersionError(VersionErrorCode.WORKSPACE_ERROR);

      expect(error).toBeInstanceOf(VersionError);
      expect(error.code).toBe(VersionErrorCode.WORKSPACE_ERROR);
      expect(error.message).toBe('Failed to get workspace packages');
      expect(error.suggestions).toEqual([
        'Verify workspace configuration files are valid',
        'Check that workspace packages are accessible',
        'Ensure proper monorepo structure',
      ]);
    });

    it('should create VersionError with INVALID_CONFIG code and suggestions', () => {
      const error = createVersionError(VersionErrorCode.INVALID_CONFIG);

      expect(error).toBeInstanceOf(VersionError);
      expect(error.code).toBe(VersionErrorCode.INVALID_CONFIG);
      expect(error.message).toBe('Invalid configuration');
      expect(error.suggestions).toEqual([
        'Validate version.config.json syntax',
        'Check configuration against schema',
        'Review documentation for valid configuration options',
      ]);
    });

    it('should create VersionError with PACKAGE_NOT_FOUND code and suggestions', () => {
      const error = createVersionError(VersionErrorCode.PACKAGE_NOT_FOUND, '@scope/missing-package');

      expect(error).toBeInstanceOf(VersionError);
      expect(error.code).toBe(VersionErrorCode.PACKAGE_NOT_FOUND);
      expect(error.message).toBe('Package not found: @scope/missing-package');
      expect(error.suggestions).toEqual([
        'Verify package name spelling and case',
        'Check if package exists in workspace',
        'Review packages configuration in version.config.json',
      ]);
    });

    it('should create VersionError with VERSION_CALCULATION_ERROR code and suggestions', () => {
      const error = createVersionError(VersionErrorCode.VERSION_CALCULATION_ERROR);

      expect(error).toBeInstanceOf(VersionError);
      expect(error.code).toBe(VersionErrorCode.VERSION_CALCULATION_ERROR);
      expect(error.message).toBe('Failed to calculate version');
      expect(error.suggestions).toEqual([
        'Ensure git repository has commits',
        'Check conventional commit message format',
        'Verify git tags are properly formatted',
      ]);
    });

    it('should handle details parameter correctly', () => {
      const error = createVersionError(VersionErrorCode.INVALID_CONFIG, 'Missing required field "preset"');

      expect(error.message).toBe('Invalid configuration: Missing required field "preset"');
      expect(error.code).toBe(VersionErrorCode.INVALID_CONFIG);
    });

    it('should create error without details when not provided', () => {
      const error = createVersionError(VersionErrorCode.CONFIG_REQUIRED);

      expect(error.message).toBe('Configuration is required');
      expect(error.code).toBe(VersionErrorCode.CONFIG_REQUIRED);
    });

    it('should work with all VersionErrorCode enum values', () => {
      const allCodes = [
        VersionErrorCode.CONFIG_REQUIRED,
        VersionErrorCode.PACKAGES_NOT_FOUND,
        VersionErrorCode.WORKSPACE_ERROR,
        VersionErrorCode.INVALID_CONFIG,
        VersionErrorCode.PACKAGE_NOT_FOUND,
        VersionErrorCode.VERSION_CALCULATION_ERROR,
      ];

      for (const code of allCodes) {
        const error = createVersionError(code);
        expect(error).toBeInstanceOf(VersionError);
        expect(error.code).toBe(code);
        expect(error.message).toBeTruthy();
        expect(error.suggestions).toBeTruthy();
      }
    });
  });

  describe('Suggestions integration', () => {
    it('should log CONFIG_REQUIRED error with suggestions', () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const error = createVersionError(VersionErrorCode.CONFIG_REQUIRED);

      error.logError();

      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(errorSpy.mock.calls[0]?.[0]).toContain('Configuration is required');
      expect(logSpy).toHaveBeenCalledTimes(3); // header + 2 suggestions
      expect(logSpy.mock.calls[0]?.[0]).toContain('Suggested solutions');
      expect(logSpy.mock.calls[1]?.[0]).toContain('Create a version.config.json');
      expect(logSpy.mock.calls[2]?.[0]).toContain('Check the documentation');
    });

    it('should log PACKAGES_NOT_FOUND error with comprehensive suggestions', () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const error = createVersionError(VersionErrorCode.PACKAGES_NOT_FOUND);

      error.logError();

      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(errorSpy.mock.calls[0]?.[0]).toContain('Failed to get packages information');
      expect(logSpy).toHaveBeenCalledTimes(4); // header + 3 suggestions
    });

    it('should log VERSION_CALCULATION_ERROR with specific suggestions', () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const error = createVersionError(VersionErrorCode.VERSION_CALCULATION_ERROR);

      error.logError();

      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(errorSpy.mock.calls[0]?.[0]).toContain('Failed to calculate version');
      expect(logSpy).toHaveBeenCalledTimes(4); // header + 3 suggestions
      expect(logSpy.mock.calls[1]?.[0]).toContain('Ensure git repository has commits');
      expect(logSpy.mock.calls[2]?.[0]).toContain('Check conventional commit message format');
      expect(logSpy.mock.calls[3]?.[0]).toContain('Verify git tags are properly formatted');
    });
  });
});
