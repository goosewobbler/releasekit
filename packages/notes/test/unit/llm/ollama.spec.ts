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

  it('should surface a clear timeout error when the request exceeds the configured timeout', async () => {
    // A fetch that never resolves on its own — it only settles when the request's abort signal fires.
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url, opts: { signal?: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            opts.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'TimeoutError')));
          }),
      ),
    );
    const provider = new OllamaProvider({ model: 'test-model', apiKey: 'k' });

    await expect(provider.complete([{ role: 'user', content: 'hi' }], { timeout: 5 })).rejects.toThrow(/timed out/);
  });

  it('should clamp a 0 / invalid timeout to the default rather than aborting every request', async () => {
    // Before the clamp, timeout: 0 produced an already-expired AbortSignal that aborted every call.
    mockFetch('{ "ok": true }');
    const provider = new OllamaProvider({ model: 'test-model', apiKey: 'k' });

    const result = await provider.complete([{ role: 'user', content: 'hi' }], {
      schema: { type: 'object' },
      timeout: 0,
    });

    expect(result.structured).toEqual({ ok: true });
  });

  it('should clamp an over-large timeout to the timer ceiling rather than throwing', async () => {
    // A value past the 2^31-1 ms timer ceiling makes AbortSignal.timeout() throw/overflow while
    // building the signal — before the request try block — bypassing the best-effort fallback.
    mockFetch('{ "ok": true }');
    const provider = new OllamaProvider({ model: 'test-model', apiKey: 'k' });

    const result = await provider.complete([{ role: 'user', content: 'hi' }], {
      schema: { type: 'object' },
      timeout: Number.MAX_SAFE_INTEGER,
    });

    expect(result.structured).toEqual({ ok: true });
  });
});
