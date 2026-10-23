import { debug, warn } from '@releasekit/core';
import { getExecErrorOutput } from './exec.js';

export type PublishErrorClass = 'transient' | 'permanent';

const PERMANENT_PATTERNS: RegExp[] = [
  /\bE401\b|\bE403\b|ENEEDAUTH|\b401\b|\b403\b/i,
  /unauthorized|forbidden|authentication failed|not authorized/i,
  /\bE404\b|\b404\b|not found/i,
  /you do not have permission|requires you to be logged in/i,
  // A bare `invalid` would also match transient socket errors like
  // "read ECONNRESET, invalid argument" - require a validation-context noun.
  /\binvalid\b.*(?:package|tag|name|token|scope|field|format|version|semver)|validation|malformed|missing required|illegal|ERR! code E\d{3}.*invalid/i,
];

const TRANSIENT_PATTERNS: RegExp[] = [
  /ETIMEDOUT|ECONNRESET|ECONNREFUSED|EAI_AGAIN|ENOTFOUND|EPIPE|ESOCKETTIMEDOUT/i,
  /socket hang up|network timeout|timed out|connection (?:reset|refused|closed)/i,
  /\b5\d{2}\b/,
  /internal server error|bad gateway|service unavailable|gateway timeout/i,
  /\b429\b|too many requests|rate ?limit/i,
];

export function classifyPublishError(error: unknown): PublishErrorClass {
  const output = getExecErrorOutput(error);

  // Permanent first, so an auth or validation error that also mentions a status code is never read as transient.
  for (const pattern of PERMANENT_PATTERNS) {
    if (pattern.test(output)) {
      return 'permanent';
    }
  }

  for (const pattern of TRANSIENT_PATTERNS) {
    if (pattern.test(output)) {
      return 'transient';
    }
  }

  return 'permanent';
}

export interface PublishRetryOptions {
  /** Total attempts, including the first. */
  maxAttempts: number;
  /** Base backoff delay in ms; doubled each retry. */
  initialDelay: number;
  sleep?: (ms: number) => Promise<void>;
  /**
   * Defaults to retrying only transient failures. Wrap it to short-circuit on outcomes that
   * should not be retried (e.g. an already-published conflict resolved as skip).
   */
  shouldRetry?: (error: unknown) => boolean;
  label?: string;
  /**
   * The thrown error carries no attempt count, so callers use this to record
   * attempts even when all attempts fail.
   */
  onAttempt?: (attempt: number) => void;
}

export interface PublishRetryResult<T> {
  value: T;
  attempts: number;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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
