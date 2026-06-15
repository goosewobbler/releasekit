import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OllamaProvider } from '../../../src/llm/ollama.js';

function mockFetch(content: string) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ message: { role: 'assistant', content }, done: true }),
    }),
  );
}

describe('OllamaProvider', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('should parse structured output wrapped in a markdown code fence', async () => {
    // Regression for #289: cloud-hosted models often wrap schema output in ```json … ``` fences.
    mockFetch('```json\n{ "entries": [{ "category": "New" }] }\n```');
    const provider = new OllamaProvider({ model: 'test-model', apiKey: 'k' });

    const result = await provider.complete([{ role: 'user', content: 'hi' }], { schema: { type: 'object' } });

    expect(result.structured).toEqual({ entries: [{ category: 'New' }] });
  });

  it('should still parse plain (unfenced) JSON structured output', async () => {
    mockFetch('{ "ok": true }');
    const provider = new OllamaProvider({ model: 'test-model', apiKey: 'k' });

    const result = await provider.complete([{ role: 'user', content: 'hi' }], { schema: { type: 'object' } });

    expect(result.structured).toEqual({ ok: true });
  });
});
