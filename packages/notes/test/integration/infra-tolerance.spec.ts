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
    // Unflagged throw sites (e.g. Ollama's "Empty response", a validation failure) aren't transport errors.
    expect(isProviderUnreachable(new LLMError('something odd'))).toBe(false);
  });

  it("should treat a connection refused under undici's fetch failure as infra", () => {
    // undici nests the socket error a level down: TypeError('fetch failed') → Error{ code: 'ECONNREFUSED' }.
    const socket = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:11434'), { code: 'ECONNREFUSED' });
    const fetchFailed = new TypeError('fetch failed', { cause: socket });
    expect(
      isProviderUnreachable(new LLMError('Ollama error: fetch failed', { cause: fetchFailed, retryable: true })),
    ).toBe(true);
  });

  it('should not trust the retryable flag when the cause is a bug in our code', () => {
    // Providers wrap any unexpected error as retryable — a TypeError from our own code included.
    const bug = new TypeError("Cannot read properties of null (reading 'message')");
    expect(isProviderUnreachable(new LLMError(`Ollama error: ${bug.message}`, { cause: bug, retryable: true }))).toBe(
      false,
    );
  });

  it('should not trust the retryable flag when the cause is an unparseable response', () => {
    // A 200 HTML page (captive portal, wrong base URL) reached a server — it just isn't the provider's API.
    const parse = new SyntaxError('Unexpected token \'<\', "<html><bod"... is not valid JSON');
    expect(
      isProviderUnreachable(new LLMError(`Ollama error: ${parse.message}`, { cause: parse, retryable: true })),
    ).toBe(false);
  });

  it('should never classify a non-LLM failure as infra', () => {
    // Assertion failures and pipeline TypeErrors are exactly what the check exists to catch.
    expect(isProviderUnreachable(new Error('expected 35 entries, got 34'))).toBe(false);
    expect(isProviderUnreachable(new TypeError('x.map is not a function'))).toBe(false);
    expect(isProviderUnreachable('a string')).toBe(false);
    expect(isProviderUnreachable(undefined)).toBe(false);
  });
});
