import { LLMError } from '../../src/errors/index.js';

// Production's NETWORK_ERROR_CODES (src/llm/retryable.ts) plus undici's. A code missing here makes an
// outage fail rather than skip, so drift is safe.
const TRANSPORT_ERROR_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ECONNABORTED',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EPIPE',
  'ENETUNREACH',
  'ENETDOWN',
  'UND_ERR_SOCKET',
  'UND_ERR_CONNECT_TIMEOUT',
]);

function isTransportFailure(error: object): boolean {
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' && TRANSPORT_ERROR_CODES.has(code);
}

/**
 * True only when the failure proves the provider was unreachable, so the e2e skips instead of failing.
 * Misreading a regression as an outage would skip silently, so anything unproven counts as our bug.
 *
 * Requires an LLMError with `retryable: true` and either:
 *  - no cause: the provider classified it (retryable HTTP status or its own timeout), or
 *  - a socket error code somewhere in the cause chain (undici nests it under `fetch failed`).
 * `retryable` alone isn't enough: providers flag any unknown error retryable, our own TypeErrors included.
 *
 * Blind spot: a bad request Ollama answers with a 5xx, or a prompt slow enough to time out, skips.
 */
export function isProviderUnreachable(error: unknown): boolean {
  if (!(error instanceof LLMError) || error.retryable !== true) {
    return false;
  }
  if (error.cause === undefined) {
    return true;
  }
  let cause: unknown = error.cause;
  while (cause !== null && typeof cause === 'object') {
    if (isTransportFailure(cause)) {
      return true;
    }
    cause = (cause as { cause?: unknown }).cause;
  }
  return false;
}
