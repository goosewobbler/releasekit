import { LLMError } from '../../src/errors/index.js';

// NETWORK_ERROR_CODES from src/llm/retryable.ts, plus undici's.
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
 * Whether a failure proves the provider was unreachable, so the e2e skips instead of failing. Proof is
 * a `retryable: true` LLMError with either no cause (the provider classified it) or a socket error code
 * in its cause chain. `retryable` alone isn't enough: providers flag any unknown error retryable.
 *
 * Known gap: a 5xx that Ollama returns for a bad request, or a prompt that times out, skips.
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
