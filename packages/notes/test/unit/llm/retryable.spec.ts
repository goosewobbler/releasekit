import { describe, expect, it } from 'vitest';
import { LLMError } from '../../../src/errors/index.js';
import { isRetryableLLMError, isRetryableProviderError, isRetryableStatus } from '../../../src/llm/retryable.js';

describe('isRetryableStatus()', () => {
  it('should retry timeout, conflict, too-early, and rate-limit statuses', () => {
    for (const status of [408, 409, 425, 429]) {
      expect(isRetryableStatus(status)).toBe(true);
    }
  });

  it('should retry 5xx server errors', () => {
    for (const status of [500, 502, 503, 529]) {
      expect(isRetryableStatus(status)).toBe(true);
    }
  });

  it('should fail fast on 4xx auth/validation statuses', () => {
    for (const status of [400, 401, 403, 404, 413, 422]) {
      expect(isRetryableStatus(status)).toBe(false);
    }
  });
});

describe('isRetryableProviderError()', () => {
  it('should classify SDK errors by their HTTP status', () => {
    expect(isRetryableProviderError(Object.assign(new Error('x'), { status: 401 }))).toBe(false);
    expect(isRetryableProviderError(Object.assign(new Error('x'), { status: 429 }))).toBe(true);
    expect(isRetryableProviderError(Object.assign(new Error('x'), { status: 500 }))).toBe(true);
  });

  it('should retry socket-level network errors', () => {
    expect(isRetryableProviderError(Object.assign(new Error('reset'), { code: 'ECONNRESET' }))).toBe(true);
    expect(isRetryableProviderError(Object.assign(new Error('dns'), { code: 'ENOTFOUND' }))).toBe(true);
  });

  it('should retry abort/timeout and connection errors by name', () => {
    expect(isRetryableProviderError(Object.assign(new Error('a'), { name: 'AbortError' }))).toBe(true);
    expect(isRetryableProviderError(Object.assign(new Error('a'), { name: 'APIConnectionError' }))).toBe(true);
  });

  it('should default an unknown error shape to retryable', () => {
    expect(isRetryableProviderError(new Error('mystery'))).toBe(true);
    expect(isRetryableProviderError('nope')).toBe(true);
  });
});

describe('isRetryableLLMError()', () => {
  it('should honor the retryable flag carried by an LLMError', () => {
    expect(isRetryableLLMError(new LLMError('auth', { retryable: false }))).toBe(false);
    expect(isRetryableLLMError(new LLMError('rate', { retryable: true }))).toBe(true);
  });

  it('should retry an unclassified LLMError or any non-LLMError', () => {
    expect(isRetryableLLMError(new LLMError('unclassified'))).toBe(true);
    expect(isRetryableLLMError(new Error('plain'))).toBe(true);
  });
});
