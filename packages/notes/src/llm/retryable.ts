import { LLMError } from '../errors/index.js';

const NETWORK_ERROR_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ECONNABORTED',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EPIPE',
  'ENETUNREACH',
  'ENETDOWN',
]);

/** Every other 4xx is an auth, permission, validation, or not-found error that retrying can't fix. */
export function isRetryableStatus(status: number): boolean {
  if (status === 408 || status === 409 || status === 425 || status === 429) {
    return true;
  }
  if (status >= 500) {
    return true;
  }
  if (status >= 400) {
    return false;
  }
  // Non-error status (shouldn't reach here for a thrown error) - retry rather than silently drop.
  return true;
}

/**
 * Classify a raw provider/SDK error (before it's wrapped in an {@link LLMError}). The Anthropic and
 * OpenAI SDKs expose `.status`; fetch/undici surface a socket `.code` or an abort/timeout `.name`.
 */
export function isRetryableProviderError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return true;
  }
  const e = error as { status?: unknown; code?: unknown; name?: unknown };
  if (typeof e.status === 'number') {
    return isRetryableStatus(e.status);
  }
  if (typeof e.code === 'string' && NETWORK_ERROR_CODES.has(e.code)) {
    return true;
  }
  // Abort/timeout errors and unknown shapes default to retryable so a genuinely transient error is never dropped.
  return true;
}

export function isRetryableLLMError(error: unknown): boolean {
  if (error instanceof LLMError) {
    return error.retryable ?? true;
  }
  return true;
}
