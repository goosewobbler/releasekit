import { BaseVersionError } from './baseError.js';

/**
 * Custom error class for versioning operations
 */
export class VersionError extends BaseVersionError {}

/**
 * Error codes for versioning operations
 */
export enum VersionErrorCode {
  CONFIG_REQUIRED = 'CONFIG_REQUIRED',
  PACKAGES_NOT_FOUND = 'PACKAGES_NOT_FOUND',
  WORKSPACE_ERROR = 'WORKSPACE_ERROR',
  INVALID_CONFIG = 'INVALID_CONFIG',
  PACKAGE_NOT_FOUND = 'PACKAGE_NOT_FOUND',
  VERSION_CALCULATION_ERROR = 'VERSION_CALCULATION_ERROR',
}

/**
 * Creates a VersionError with standard error message for common failure scenarios
 * @param code Error code
 * @param details Additional error details
 * @returns VersionError instance
 */
export function createVersionError(code: VersionErrorCode, details?: string): VersionError {
  const messages: Record<VersionErrorCode, string> = {
    [VersionErrorCode.CONFIG_REQUIRED]: 'Configuration is required',
    [VersionErrorCode.PACKAGES_NOT_FOUND]: 'Failed to get packages information',
    [VersionErrorCode.WORKSPACE_ERROR]: 'Failed to get workspace packages',
    [VersionErrorCode.INVALID_CONFIG]: 'Invalid configuration',
    [VersionErrorCode.PACKAGE_NOT_FOUND]: 'Package not found',
    [VersionErrorCode.VERSION_CALCULATION_ERROR]: 'Failed to calculate version',
  };

  // Provide helpful suggestions for specific error types
  const suggestions: Record<VersionErrorCode, string[] | undefined> = {
    [VersionErrorCode.CONFIG_REQUIRED]: [
      'Create a version.config.json file in your project root',
      'Check the documentation for configuration examples',
    ],
    [VersionErrorCode.PACKAGES_NOT_FOUND]: [
      'Ensure package.json or Cargo.toml files exist in your project',
      'Check workspace configuration (pnpm-workspace.yaml, etc.)',
      'Verify file permissions and paths',
    ],
    [VersionErrorCode.WORKSPACE_ERROR]: [
      'Verify workspace configuration files are valid',
      'Check that workspace packages are accessible',
      'Ensure proper monorepo structure',
    ],
    [VersionErrorCode.INVALID_CONFIG]: [
      'Validate version.config.json syntax',
      'Check configuration against schema',
      'Review documentation for valid configuration options',
    ],
    [VersionErrorCode.PACKAGE_NOT_FOUND]: [
      'Verify package name spelling and case',
      'Check if package exists in workspace',
      'Review packages configuration in version.config.json',
    ],
    [VersionErrorCode.VERSION_CALCULATION_ERROR]: [
      'Ensure git repository has commits',
      'Check conventional commit message format',
      'Verify git tags are properly formatted',
    ],
  };

  const baseMessage = messages[code];
  const fullMessage = details ? `${baseMessage}: ${details}` : baseMessage;

  return new VersionError(fullMessage, code, suggestions[code]);
}
