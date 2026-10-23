import { log } from './logger.js';

/**
 * `@releasekit/release` bundles version, notes and publish, each inlining its own copy of core, so one process can
 * hold several `ReleaseKitError` classes and `instanceof` misses an error from another copy. `Symbol.for` is shared
 * across copies.
 */
const RELEASEKIT_ERROR_BRAND = Symbol.for('@releasekit/core:ReleaseKitError');

export abstract class ReleaseKitError extends Error {
  abstract readonly code: string;
  abstract readonly suggestions: string[];

  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
    // Non-enumerable, so the brand never shows up in a spread, JSON output, or a test's toEqual.
    Object.defineProperty(this, RELEASEKIT_ERROR_BRAND, { value: true });
  }

  logError(): void {
    log(this.message, 'error');

    if (this.suggestions.length > 0) {
      log('\nSuggested solutions:', 'info');
      for (const [i, suggestion] of this.suggestions.entries()) {
        log(`${i + 1}. ${suggestion}`, 'info');
      }
    }
  }

  /** True for an error from any copy of core (see {@link RELEASEKIT_ERROR_BRAND}), not just this one. */
  static isReleaseKitError(error: unknown): error is ReleaseKitError {
    if (error instanceof ReleaseKitError) {
      return true;
    }
    return (
      typeof error === 'object' &&
      error !== null &&
      (error as { [RELEASEKIT_ERROR_BRAND]?: unknown })[RELEASEKIT_ERROR_BRAND] === true
    );
  }
}

export class InputError extends ReleaseKitError {
  readonly code = 'INPUT_ERROR';
  readonly suggestions: string[] = [];
}

export const EXIT_CODES = {
  SUCCESS: 0,
  GENERAL_ERROR: 1,
  CONFIG_ERROR: 2,
  INPUT_ERROR: 3,
  TEMPLATE_ERROR: 4,
  LLM_ERROR: 5,
  GITHUB_ERROR: 6,
  GIT_ERROR: 7,
  VERSION_ERROR: 8,
  PUBLISH_ERROR: 9,
} as const;

export type ExitCode = (typeof EXIT_CODES)[keyof typeof EXIT_CODES];
