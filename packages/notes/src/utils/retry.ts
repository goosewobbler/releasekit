export interface RetryOptions {
  maxAttempts?: number;
  initialDelay?: number;
  maxDelay?: number;
  backoffFactor?: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const maxAttempts = options.maxAttempts ?? 3;
  const initialDelay = options.initialDelay ?? 1_000;
  const maxDelay = options.maxDelay ?? 30_000;
  const backoffFactor = options.backoffFactor ?? 2;

  let lastError: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt < maxAttempts - 1) {
        const base = Math.min(initialDelay * backoffFactor ** attempt, maxDelay);
        const jitter = base * 0.2 * (Math.random() * 2 - 1);
        await sleep(Math.max(0, base + jitter));
      }
    }
  }

  throw lastError;
}
