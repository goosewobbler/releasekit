import { describe, expect, it } from 'vitest';
import { LLMError } from '../../src/errors/index.js';
import { isProviderUnreachable } from './infra-tolerance.js';

/**
 * The real-provider e2e is opt-in, but this predicate decides whether that check can go red at all —
 * a version that returns `true` too readily turns every regression into a silent skip. So it is
 * covered here, in a spec that always runs.
 */
describe('isProviderUnreachable', () => {
  it('should treat a provider-classified transient failure as infra', () => {
    expect(isProviderUnreachable(new LLMError('Ollama request timed out after 120000ms', { retryable: true }))).toBe(
      true,
    );
  });

  it('should treat a non-retryable request failure as our bug', () => {
    // A 4xx is a malformed request — retrying won't fix it and neither will waiting for the host.
    expect(isProviderUnreachable(new LLMError('Ollama request failed: 400', { retryable: false }))).toBe(false);
  });

  it('should treat an unclassified LLMError as our bug', () => {
    // Every provider sets the flag explicitly, so an absent one means something unrecognised happened.
    expect(isProviderUnreachable(new LLMError('something odd'))).toBe(false);
  });

  it('should never classify a non-LLM failure as infra', () => {
    // Assertion failures and pipeline TypeErrors are exactly what the check exists to catch.
    expect(isProviderUnreachable(new Error('expected 35 entries, got 34'))).toBe(false);
    expect(isProviderUnreachable(new TypeError('x.map is not a function'))).toBe(false);
    expect(isProviderUnreachable('a string')).toBe(false);
    expect(isProviderUnreachable(undefined)).toBe(false);
  });
});
