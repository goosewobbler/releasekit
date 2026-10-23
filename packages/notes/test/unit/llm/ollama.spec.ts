import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OllamaProvider } from '../../../src/llm/ollama.js';

const encoder = new TextEncoder();

function line(content: string, done = false): string {
  return `${JSON.stringify({ message: { role: 'assistant', content }, done })}\n`;
}

function reply(content: string): string[] {
  return [line(content), line('', true)];
}

/**
 * Each read waits `gapMs` for the next piece; with `stall`, the body goes quiet instead of closing.
 * Like fetch, aborting the request errors the body.
 */
function stubStream(pieces: Array<string | Uint8Array>, { gapMs = 0, stall = false } = {}) {
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
        } else if (stall) {
          await new Promise(() => {});
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

  it('should time out once the stream goes quiet for the timeout, as a retryable error', async () => {
    vi.useFakeTimers();
    stubStream([line('{ "a": '), line('1')], { gapMs: 100, stall: true });

    await Promise.all([
      expect(makeProvider().complete(ask, { timeout: 1_000 })).rejects.toMatchObject({
        message: expect.stringMatching(/timed out: nothing received for 1000ms/),
        retryable: true,
        cause: expect.objectContaining({ name: 'TimeoutError' }),
      }),
      vi.advanceTimersByTimeAsync(1_300),
    ]);
  });

  it('should time out when nothing arrives at all', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url, opts: { signal?: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            opts.signal?.addEventListener('abort', () => reject(opts.signal?.reason));
          }),
      ),
    );

    await expect(makeProvider().complete(ask, { timeout: 5 })).rejects.toThrow(/timed out/);
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

  it('should clamp a 0 / invalid timeout to the default rather than aborting every request', async () => {
    stubStream(reply('{ "ok": true }'));

    const result = await makeProvider().complete(ask, { schema: { type: 'object' }, timeout: 0 });

    expect(result.structured).toEqual({ ok: true });
  });

  it('should clamp an over-large timeout to the timer ceiling rather than aborting every request', async () => {
    stubStream(reply('{ "ok": true }'));

    const result = await makeProvider().complete(ask, {
      schema: { type: 'object' },
      timeout: Number.MAX_SAFE_INTEGER,
    });

    expect(result.structured).toEqual({ ok: true });
  });

  it('should treat a sub-millisecond timeout as the default rather than aborting every request', async () => {
    stubStream(reply('{ "ok": true }'));

    const result = await makeProvider().complete(ask, { schema: { type: 'object' }, timeout: 0.5 });

    expect(result.structured).toEqual({ ok: true });
  });
});
