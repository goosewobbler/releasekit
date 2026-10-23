import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OpenAIProvider } from '../../../src/llm/openai.js';

const { createMock } = vi.hoisted(() => ({ createMock: vi.fn() }));

vi.mock('openai', () => ({
  default: class MockOpenAI {
    chat = { completions: { create: createMock } };
  },
}));

/** Chat-completion chunks `gapMs` apart, the last with a finish_reason; like the SDK, an abort ends it quietly. */
function chunkStream(signal: AbortSignal, pieces: string[], { gapMs = 0, finish = true } = {}) {
  return (async function* () {
    for (const [i, content] of pieces.entries()) {
      await new Promise((resolve) => setTimeout(resolve, gapMs));
      if (signal.aborted) {
        return;
      }
      const last = i === pieces.length - 1;
      yield { choices: [{ delta: { content }, finish_reason: last && finish ? 'stop' : null }] };
    }
  })();
}

function streams(pieces: string[], options?: Parameters<typeof chunkStream>[2]) {
  createMock.mockImplementation(async (_params, opts: { signal: AbortSignal }) =>
    chunkStream(opts.signal, pieces, options),
  );
}

const ask = [{ role: 'user' as const, content: 'hi' }];

describe('OpenAIProvider', () => {
  beforeEach(() => {
    createMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should stream the request and join the content of every chunk', async () => {
    streams(['{ "entries": ', '[{ "category": "Fixed" }] }']);
    const provider = new OpenAIProvider({ model: 'gpt-4o-mini', apiKey: 'k' });

    const result = await provider.complete(ask, { schema: { type: 'object' } });

    expect(createMock.mock.calls[0]?.[0]).toMatchObject({ stream: true, response_format: { type: 'json_schema' } });
    expect(result.structured).toEqual({ entries: [{ category: 'Fixed' }] });
  });

  it('should parse structured output wrapped in a markdown code fence', async () => {
    streams(['```json\n{ "entries": [{ "category": "Fixed" }] }\n```']);
    const provider = new OpenAIProvider({ model: 'gpt-4o-mini', apiKey: 'k' });

    const result = await provider.complete(ask, { schema: { type: 'object' } });

    expect(result.structured).toEqual({ entries: [{ category: 'Fixed' }] });
  });

  it('should still parse plain (unfenced) JSON structured output', async () => {
    streams(['{ "ok": true }']);
    const provider = new OpenAIProvider({ model: 'gpt-4o-mini', apiKey: 'k' });

    const result = await provider.complete(ask, { schema: { type: 'object' } });

    expect(result.structured).toEqual({ ok: true });
  });

  it('should not time out while chunks keep arriving, however long the whole response takes', async () => {
    vi.useFakeTimers();
    streams(['{ "a": ', '1, "b": ', '2 }'], { gapMs: 800 });
    const provider = new OpenAIProvider({ model: 'gpt-4o-mini', apiKey: 'k' });

    const pending = provider.complete(ask, { schema: { type: 'object' }, timeout: 1_000 });
    await vi.advanceTimersByTimeAsync(5_000);

    await expect(pending).resolves.toMatchObject({ structured: { a: 1, b: 2 } });
  });
  it('should fail, retryably, when the stream ends without a finish_reason', async () => {
    streams(['{ "a": 1 }'], { finish: false });
    const provider = new OpenAIProvider({ model: 'gpt-4o-mini', apiKey: 'k' });

    await expect(provider.complete(ask)).rejects.toMatchObject({
      message: expect.stringMatching(/stream ended before the response was complete/),
      retryable: true,
    });
  });
});
