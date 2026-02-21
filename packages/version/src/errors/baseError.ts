import { ReleaseKitError } from '@releasekit/core';

/**
 * Version-specific base error that bridges the factory pattern
 * used by @releasekit/version with the abstract ReleaseKitError base.
 */
export class BaseVersionError extends ReleaseKitError {
  readonly code: string;
  readonly suggestions: string[];

  constructor(message: string, code: string, suggestions?: string[]) {
    super(message);
    this.code = code;
    this.suggestions = suggestions ?? [];
  }

  static isVersionError(error: unknown): error is BaseVersionError {
    return error instanceof BaseVersionError;
  }
}

// Backwards-compatible alias
export { BaseVersionError as BasePackageVersionerError };
