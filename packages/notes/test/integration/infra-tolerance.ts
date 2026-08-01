import { LLMError } from '../../src/errors/index.js';

/**
 * Is this failure the provider being unreachable, rather than a regression in our code?
 *
 * Separates the two things a real-provider check can fail on. A hosted model going down must not read
 * as "releasekit broke" — but the inverse mistake is worse: a mis-classified regression skips green
 * and the blocking check silently stops checking. So the bar for "infra" is deliberately high.
 *
 * Only an {@link LLMError} the provider *positively* classified as transient qualifies: a timeout,
 * 429, 5xx, or socket error. A non-retryable 4xx is a malformed request — our bug — and so is anything
 * that isn't an LLMError at all, including assertion failures and TypeErrors from our own pipeline.
 * `retryable: undefined` (unclassified) fails too: every provider sets the flag explicitly, so an
 * absent one means something unrecognised happened, and a visible red beats a silent skip.
 */
export function isProviderUnreachable(error: unknown): boolean {
  return error instanceof LLMError && error.retryable === true;
}
