import { debug } from '@releasekit/core';

export interface RetryOptions {
  maxAttempts: number;
  initialDelay: number;
  backoffMultiplier: number;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions,
  shouldRetry?: (error: unknown) => boolean,
): Promise<T> {
  let lastError: unknown;
  let delay = options.initialDelay;

  for (let attempt = 1; attempt <= options.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (shouldRetry && !shouldRetry(error)) {
        throw error;
      }

      if (attempt < options.maxAttempts) {
        debug(`Attempt ${attempt}/${options.maxAttempts} failed, retrying in ${delay}ms...`);
        await sleep(delay);
        delay = Math.floor(delay * options.backoffMultiplier);
      }
    }
  }

  throw lastError;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
