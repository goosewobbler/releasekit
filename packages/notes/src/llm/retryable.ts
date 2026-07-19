import { LLMError } from '../errors/index.js';

/** Node/undici socket-level failures — transient, so worth retrying. */
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

/**
 * Classify an HTTP status as retryable. Only transient failures are retried: 429 (rate limit),
 * 5xx (server), and the timeout/conflict/too-early family (408/409/425). Every other 4xx is an
 * auth, permission, validation, or not-found error that retrying can't fix — fail fast.
 */
export function isRetryableStatus(status: number): boolean {
  if (status === 408 || status === 409 || status === 425 || status === 429) return true;
  if (status >= 500) return true;
  if (status >= 400) return false;
  // Non-error status (shouldn't reach here for a thrown error) — retry rather than silently drop.
  return true;
}

/**
 * Classify a raw provider/SDK error (before it's wrapped in an {@link LLMError}). The Anthropic and
 * OpenAI SDKs expose `.status`; fetch/undici surface a socket `.code` or an abort/timeout `.name`.
 * Unknown shapes default to retryable so a genuinely transient error is never dropped — the only
 * fail-fast path is an explicit non-retryable 4xx status.
 */
export function isRetryableProviderError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return true;
  const e = error as { status?: unknown; code?: unknown; name?: unknown };
  if (typeof e.status === 'number') return isRetryableStatus(e.status);
  if (typeof e.code === 'string' && NETWORK_ERROR_CODES.has(e.code)) return true;
  // Everything else — abort/timeout error names (AbortError, TimeoutError, APIConnectionError,
  // APIConnectionTimeoutError) and unknown shapes alike — defaults to retryable; the only fail-fast
  // path is the explicit non-retryable 4xx status handled above.
  return true;
}

/**
 * Predicate for {@link withRetry}: an {@link LLMError} carries the provider's retry classification;
 * any other error (unclassified) is retried by default.
 */
export function isRetryableLLMError(error: unknown): boolean {
  if (error instanceof LLMError) return error.retryable ?? true;
  return true;
}
