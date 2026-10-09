import { LLMError } from '../../src/errors/index.js';
import { isRetryableStatus } from '../../src/llm/retryable.js';

/**
 * Socket-level failure codes: production's `NETWORK_ERROR_CODES` (`src/llm/retryable.ts`, copied rather
 * than exported for a test) plus undici's socket and timeout codes. If the two drift, this side only gets
 * stricter — a red, never a silent skip.
 */
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
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
]);

/** Positive evidence of a transport failure on one error in a cause chain. */
function isTransportFailure(error: object): boolean {
  const e = error as { status?: unknown; code?: unknown; name?: unknown };
  if (typeof e.status === 'number') return e.status >= 400 && isRetryableStatus(e.status);
  if (typeof e.code === 'string' && TRANSPORT_ERROR_CODES.has(e.code)) return true;
  return e.name === 'AbortError' || e.name === 'TimeoutError';
}

/**
 * Is this failure the provider being unreachable, rather than a regression in our code?
 *
 * Separates the two things a real-provider check can fail on. A hosted model going down must not read
 * as "releasekit broke" — but the inverse mistake is worse: a mis-classified regression skips green
 * and the blocking check silently stops checking. So the bar for "infra" is deliberately high.
 *
 * `retryable: true` is necessary but not sufficient. Providers wrap *any* unexpected error in a
 * retryable LLMError — production defaults unknown shapes to retryable so a transient failure is never
 * dropped — so a TypeError from our own code, a 200 HTML page that fails to parse, or a malformed base
 * URL all arrive flagged retryable. What separates them is the cause:
 *  - no cause → the provider classified the failure itself, from a retryable HTTP status (429, 5xx, …)
 *    or its own request timeout. Accepted.
 *  - a cause → some error in the chain must be positive transport evidence: a retryable HTTP status, a
 *    socket error code, or an abort/timeout. undici nests the socket error a level down
 *    (`TypeError: fetch failed` → `Error: connect ECONNREFUSED`), hence the walk.
 *
 * Everything else is our bug: a non-retryable 4xx (malformed request), an unflagged LLMError (e.g.
 * "Empty response", a validation failure — not every throw site sets the flag), and anything that isn't
 * an LLMError at all. A visible red beats a silent skip.
 */
export function isProviderUnreachable(error: unknown): boolean {
  if (!(error instanceof LLMError) || error.retryable !== true) return false;
  if (error.cause === undefined) return true;
  // Bounded walk: a cause chain is short, and a cyclic one must not hang the check.
  let cause: unknown = error.cause;
  for (let depth = 0; depth < 10 && cause !== null && typeof cause === 'object'; depth++) {
    if (isTransportFailure(cause)) return true;
    cause = (cause as { cause?: unknown }).cause;
  }
  return false;
}
