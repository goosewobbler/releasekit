import { describe, expect, it } from 'vitest';
import { LLMError } from '../../src/errors/index.js';
import { isProviderUnreachable } from './infra-tolerance.js';

// Always runs, unlike the opt-in e2e: if this returns `true` too readily, e2e regressions skip silently.
describe('isProviderUnreachable', () => {
  it('should treat a provider-classified transient failure as infra', () => {
    expect(isProviderUnreachable(new LLMError('Ollama request timed out after 120000ms', { retryable: true }))).toBe(
      true,
    );
  });

  it('should treat a non-retryable request failure as our bug', () => {
    expect(isProviderUnreachable(new LLMError('Ollama request failed: 400', { retryable: false }))).toBe(false);
  });

  it('should treat an unclassified LLMError as our bug', () => {
    // e.g. Ollama's "Empty response", thrown without a retryable flag.
    expect(isProviderUnreachable(new LLMError('something odd'))).toBe(false);
  });

  it("should treat a connection refused under undici's fetch failure as infra", () => {
    const socket = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:11434'), { code: 'ECONNREFUSED' });
    const fetchFailed = new TypeError('fetch failed', { cause: socket });
    expect(
      isProviderUnreachable(new LLMError('Ollama error: fetch failed', { cause: fetchFailed, retryable: true })),
    ).toBe(true);
  });

  it('should not trust the retryable flag when the cause is a bug in our code', () => {
    const bug = new TypeError("Cannot read properties of null (reading 'message')");
    expect(isProviderUnreachable(new LLMError(`Ollama error: ${bug.message}`, { cause: bug, retryable: true }))).toBe(
      false,
    );
  });

  it('should not trust the retryable flag when the cause is an unparseable response', () => {
    // e.g. an HTML page from a wrong base URL: a server answered, just not the provider.
    const parse = new SyntaxError('Unexpected token \'<\', "<html><bod"... is not valid JSON');
    expect(
      isProviderUnreachable(new LLMError(`Ollama error: ${parse.message}`, { cause: parse, retryable: true })),
    ).toBe(false);
  });

  it('should never classify a non-LLM failure as infra', () => {
    expect(isProviderUnreachable(new Error('expected 35 entries, got 34'))).toBe(false);
    expect(isProviderUnreachable(new TypeError('x.map is not a function'))).toBe(false);
    expect(isProviderUnreachable('a string')).toBe(false);
    expect(isProviderUnreachable(undefined)).toBe(false);
  });
});
