import { log } from './logger.js';

/**
 * Base error class that all releasekit errors should extend.
 * Provides consistent error handling with codes and suggestions.
 */
export abstract class ReleaseKitError extends Error {
  abstract readonly code: string;
  abstract readonly suggestions: string[];

  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
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

  static isReleaseKitError(error: unknown): error is ReleaseKitError {
    return error instanceof ReleaseKitError;
  }
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
} as const;

export type ExitCode = (typeof EXIT_CODES)[keyof typeof EXIT_CODES];
