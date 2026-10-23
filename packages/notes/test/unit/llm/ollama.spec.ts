import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OllamaProvider } from '../../../src/llm/ollama.js';

const encoder = new TextEncoder();

function line(content: string, done = false): string {
  return `${JSON.stringify({ message: { role: 'assistant', content }, done })}\n`;
}

function reply(content: string): string[] {
  return [line(content), line('', true)];
}

/** Each read waits `gapMs` for the next piece; like fetch, aborting the request errors the body. */
function stubStream(pieces: Array<string | Uint8Array>, { gapMs = 0 } = {}) {
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    const queue = [...pieces];
    const signal = init?.signal;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        signal?.addEventListener('abort', () => controller.error(signal.reason));
      },
      async pull(controller) {
        if (gapMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, gapMs));
        }
        if (signal?.aborted) {
          return;
        }
        const piece = queue.shift();
        if (piece !== undefined) {
          controller.enqueue(typeof piece === 'string' ? encoder.encode(piece) : piece);
        } else {
          controller.close();
        }
      },
    });
    return new Response(body);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function makeProvider() {
  return new OllamaProvider({ model: 'test-model', apiKey: 'k' });
}

const ask = [{ role: 'user' as const, content: 'hi' }];

describe('OllamaProvider', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('should request a stream, keeping the schema as format and the generation options', async () => {
    const fetchMock = stubStream(reply('{ "ok": true }'));

    await makeProvider().complete(ask, { schema: { type: 'object' }, maxTokens: 100, temperature: 0.2 });

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body).toMatchObject({
      stream: true,
      format: { type: 'object' },
      options: { num_predict: 100, temperature: 0.2 },
    });
  });

  it('should join the content of every chunk up to done', async () => {
    stubStream([line('{ "entries": '), line('[{ "category": '), line('"New" }] }'), line('', true)]);

    const result = await makeProvider().complete(ask, { schema: { type: 'object' } });

    expect(result.content).toBe('{ "entries": [{ "category": "New" }] }');
    expect(result.structured).toEqual({ entries: [{ category: 'New' }] });
  });

  it('should reassemble lines and multi-byte characters split across reads, including an unterminated last line', async () => {
    const payload = encoder.encode([line('{ "title": "Café '), line('✓" }'), line('', true)].join('').trimEnd());
    stubStream(Array.from(payload, (byte) => Uint8Array.of(byte)));

    const result = await makeProvider().complete(ask, { schema: { type: 'object' } });

    expect(result.structured).toEqual({ title: 'Café ✓' });
  });

  it('should parse structured output wrapped in a markdown code fence', async () => {
    stubStream(reply('```json\n{ "entries": [{ "category": "New" }] }\n```'));

    const result = await makeProvider().complete(ask, { schema: { type: 'object' } });

    expect(result.structured).toEqual({ entries: [{ category: 'New' }] });
  });

  it('should still parse plain (unfenced) JSON structured output', async () => {
    stubStream(reply('{ "ok": true }'));

    const result = await makeProvider().complete(ask, { schema: { type: 'object' } });

    expect(result.structured).toEqual({ ok: true });
  });

  it('should not time out while chunks keep arriving, however long the whole response takes', async () => {
    vi.useFakeTimers();
    stubStream([line('{ "a": '), line('1, "b": '), line('2, "c": '), line('3 }'), line('', true)], { gapMs: 800 });

    const pending = makeProvider().complete(ask, { schema: { type: 'object' }, timeout: 1_000 });
    await vi.advanceTimersByTimeAsync(5_000);

    await expect(pending).resolves.toMatchObject({ structured: { a: 1, b: 2, c: 3 } });
  });
  it('should surface an error object sent mid-stream, as a retryable error', async () => {
    stubStream([line('{ "a": '), `${JSON.stringify({ error: 'model runner has unexpectedly stopped' })}\n`]);

    await expect(makeProvider().complete(ask)).rejects.toMatchObject({
      message: 'Ollama error: model runner has unexpectedly stopped',
      retryable: true,
    });
  });

  it('should fail, retryably, when the stream ends without done', async () => {
    stubStream([line('{ "a": 1 }')]);

    await expect(makeProvider().complete(ask)).rejects.toMatchObject({
      message: expect.stringMatching(/stream ended before the response was complete/),
      cause: expect.objectContaining({ message: expect.stringMatching(/^Last line received: .*"done":false/) }),
      retryable: true,
    });
  });
});
