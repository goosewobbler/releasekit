import { describe, expect, it, vi } from 'vitest';
import type { LLMConfig } from '../../../src/core/types.js';
import { LLMError } from '../../../src/errors/index.js';
import { createProvider } from '../../../src/llm/index.js';

// The OpenAI-backed providers construct a client in their constructor; stub it so we can assert the
// factory's own guards without a network client.
vi.mock('openai', () => ({
  default: class MockOpenAI {
    chat = { completions: { create: vi.fn() } };
  },
}));

describe('createProvider', () => {
  it('should throw a clear error when llm.model is missing (no curated default)', () => {
    // A config assembled in-process (e.g. from CLI --llm-* flags) can bypass schema validation.
    const cfg = { provider: 'openai' } as unknown as LLMConfig;
    expect(() => createProvider(cfg)).toThrow(LLMError);
    expect(() => createProvider(cfg)).toThrow(/llm\.model is required/);
  });

  it('should require baseURL for the openai-compatible provider', () => {
    const cfg = { provider: 'openai-compatible', model: 'local-model' } as unknown as LLMConfig;
    expect(() => createProvider(cfg)).toThrow(/requires baseURL/);
  });

  it('should construct a provider when model (and baseURL for openai-compatible) are set', () => {
    expect(createProvider({ provider: 'openai', model: 'gpt-x', apiKey: 'k' } as LLMConfig).name).toBe('openai');
    expect(
      createProvider({ provider: 'openai-compatible', model: 'local-model', baseURL: 'https://x/v1' } as LLMConfig)
        .name,
    ).toBe('openai-compatible');
  });
});
