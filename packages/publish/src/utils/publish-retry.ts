import { debug, warn } from '@releasekit/core';
import { getExecErrorOutput } from './exec.js';

/**
 * Classification of a registry publish failure.
 *
 * - `transient`: a short-lived registry/network blip (5xx, timeout, connection
 *   reset, DNS hiccup, rate limit) that is likely to succeed if retried.
 * - `permanent`: a deterministic failure (auth, missing scope/package,
 *   validation) that will not change on retry, so we fail fast.
 */
export type PublishErrorClass = 'transient' | 'permanent';

// Permanent failures: deterministic, retrying will not help. Checked first so an
// auth/validation error is never misread as transient.
const PERMANENT_PATTERNS: RegExp[] = [
  /\bE401\b|\bE403\b|ENEEDAUTH|\b401\b|\b403\b/i, // auth / forbidden
  /unauthorized|forbidden|authentication failed|not authorized/i,
  /\bE404\b|\b404\b|not found/i, // missing package/scope
  /you do not have permission|requires you to be logged in/i,
  // A bare `invalid` would also match transient socket errors like
  // "read ECONNRESET, invalid argument" — require a validation-context noun.
  /\binvalid\b.*(?:package|tag|name|token|scope|field|format|version|semver)|validation|malformed|missing required|illegal|ERR! code E\d{3}.*invalid/i,
];

// Transient failures: worth retrying once the registry recovers.
const TRANSIENT_PATTERNS: RegExp[] = [
  /ETIMEDOUT|ECONNRESET|ECONNREFUSED|EAI_AGAIN|ENOTFOUND|EPIPE|ESOCKETTIMEDOUT/i, // network
  /socket hang up|network timeout|timed out|connection (?:reset|refused|closed)/i,
  /\b5\d{2}\b/, // HTTP 5xx
  /internal server error|bad gateway|service unavailable|gateway timeout/i,
  /\b429\b|too many requests|rate ?limit/i, // rate limiting
];

/**
 * Classify a publish failure as transient (retryable) or permanent (fail-fast).
 *
 * Permanent patterns are matched first so an auth or validation error that also
 * happens to mention a status code is never treated as transient. Anything we
 * cannot positively identify as transient is treated as permanent, preserving
 * today's fail-fast default for unknown errors.
 */
export function classifyPublishError(error: unknown): PublishErrorClass {
  const output = getExecErrorOutput(error);

  for (const pattern of PERMANENT_PATTERNS) {
    if (pattern.test(output)) return 'permanent';
  }

  for (const pattern of TRANSIENT_PATTERNS) {
    if (pattern.test(output)) return 'transient';
  }

  return 'permanent';
}

export interface PublishRetryOptions {
  /** Total attempts including the first try (e.g. 3 = initial + 2 retries). */
  maxAttempts: number;
  /** Base backoff delay in ms; doubled each retry. */
  initialDelay: number;
  /** Sleep implementation, injectable so tests don't actually wait. */
  sleep?: (ms: number) => Promise<void>;
  /**
   * Decide whether to keep retrying a given error. Defaults to retrying only
   * transient failures. Callers can wrap this to short-circuit on outcomes that
   * should not be retried (e.g. an already-published conflict resolved as skip).
   */
  shouldRetry?: (error: unknown) => boolean;
  /** Label for the package/operation, used in retry log lines. */
  label?: string;
  /**
   * Called at the start of every attempt with the attempt number. The thrown
   * error carries no attempt count, so callers use this to record attempts on
   * the per-package result even when all attempts fail.
   */
  onAttempt?: (attempt: number) => void;
}

export interface PublishRetryResult<T> {
  value: T;
  /** Number of attempts made before success (1 = succeeded first try). */
  attempts: number;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Run a registry publish operation with bounded auto-retry for transient
 * failures. Transient errors (5xx, timeouts, connection resets, rate limits)
 * are retried with exponential backoff up to `maxAttempts`; permanent errors
 * (auth, missing scope/package, validation) throw immediately with zero retries.
 *
 * On success it returns the operation result plus the attempt count so the
 * caller can record it in the per-package publish result. When attempts are
 * exhausted the final (real) error is rethrown.
 */
export async function withPublishRetry<T>(
  fn: () => Promise<T>,
  options: PublishRetryOptions,
): Promise<PublishRetryResult<T>> {
  const sleep = options.sleep ?? defaultSleep;
  const shouldRetry = options.shouldRetry ?? ((error) => classifyPublishError(error) === 'transient');
  const labelSuffix = options.label ? ` for ${options.label}` : '';
  let delay = options.initialDelay;

  for (let attempt = 1; attempt <= options.maxAttempts; attempt++) {
    options.onAttempt?.(attempt);
    try {
      const value = await fn();
      return { value, attempts: attempt };
    } catch (error) {
      const isLastAttempt = attempt >= options.maxAttempts;

      if (isLastAttempt || !shouldRetry(error)) {
        throw error;
      }

      const reason = error instanceof Error ? error.message : String(error);
      warn(`Transient publish error${labelSuffix} (attempt ${attempt}/${options.maxAttempts}), retrying in ${delay}ms`);
      debug(`Retry reason${labelSuffix}: ${reason}`);
      await sleep(delay);
      delay *= 2;
    }
  }

  // Unreachable: the loop either returns on success or throws on the last attempt.
  throw new Error('withPublishRetry: exhausted attempts without throwing');
}
