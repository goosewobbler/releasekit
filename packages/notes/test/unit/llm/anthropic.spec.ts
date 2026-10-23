import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AnthropicProvider } from '../../../src/llm/anthropic.js';

const { streamMock } = vi.hoisted(() => ({ streamMock: vi.fn() }));

vi.mock('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    messages = { stream: streamMock };
  },
}));

/** Stands in for the SDK's MessageStream: `events` stream events `gapMs` apart, then `message`; an abort rejects. */
function messageStream(signal: AbortSignal, message: object, { events = 1, gapMs = 0 } = {}) {
  const listeners: Array<() => void> = [];
  const stream = {
    on: (event: string, listener: () => void) => {
      if (event === 'streamEvent') {
        listeners.push(listener);
      }
      return stream;
    },
    finalMessage: async () => {
      for (let i = 0; i < events && !signal.aborted; i++) {
        await new Promise((resolve) => setTimeout(resolve, gapMs));
        for (const listener of listeners) {
          listener();
        }
      }
      if (signal.aborted) {
        throw new Error('Request was aborted.');
      }
      return { stop_reason: 'end_turn', ...message };
    },
  };
  return stream;
}

function replies(message: object, options?: Parameters<typeof messageStream>[2]) {
  streamMock.mockImplementation((_params, opts: { signal: AbortSignal }) =>
    messageStream(opts.signal, message, options),
  );
}

function fails(error: Error) {
  const stream = { on: () => stream, finalMessage: () => Promise.reject(error) };
  streamMock.mockReturnValueOnce(stream);
}

function makeProvider(model = 'claude-sonnet-5') {
  return new AnthropicProvider({ model, apiKey: 'k' });
}

describe('AnthropicProvider', () => {
  beforeEach(() => {
    streamMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should extract structured output from a tool_use block on the schema path', async () => {
    replies({
      content: [{ type: 'tool_use', name: 'emit_release_notes', input: { entries: [{ category: 'Fixed' }] } }],
    });

    const result = await makeProvider().complete([{ role: 'user', content: 'hi' }], { schema: { type: 'object' } });

    expect(result.structured).toEqual({ entries: [{ category: 'Fixed' }] });
    expect(JSON.parse(result.content)).toEqual({ entries: [{ category: 'Fixed' }] });
  });

  it('should throw when the schema path returns no tool_use block', async () => {
    replies({ content: [{ type: 'text', text: 'I could not do that' }] });

    await expect(
      makeProvider().complete([{ role: 'user', content: 'hi' }], { schema: { type: 'object' } }),
    ).rejects.toThrow(/Expected tool_use block/);
  });

  it('should find the text block even when a thinking block precedes it (thinking-model forward-compat)', async () => {
    // Sonnet 5 / Fable 5 return thinking blocks ahead of the text block; content[0] would be `thinking`.
    replies({
      content: [
        { type: 'thinking', thinking: 'let me reason about this' },
        { type: 'text', text: 'A concise summary.' },
      ],
    });

    const result = await makeProvider().complete([{ role: 'user', content: 'summarize' }]);

    expect(result.content).toBe('A concise summary.');
  });

  it('should return the text of a plain single-block response', async () => {
    replies({ content: [{ type: 'text', text: 'hello' }] });

    const result = await makeProvider().complete([{ role: 'user', content: 'hi' }]);

    expect(result.content).toBe('hello');
  });

  it('should throw when the response contains no text block', async () => {
    replies({ content: [{ type: 'thinking', thinking: 'only thinking' }] });

    await expect(makeProvider().complete([{ role: 'user', content: 'hi' }])).rejects.toThrow(/Expected a text block/);
  });

  it('should split the system message out and map only non-system messages', async () => {
    replies({ content: [{ type: 'text', text: 'ok' }] });

    await makeProvider().complete([
      { role: 'system', content: 'You are helpful.' },
      { role: 'user', content: 'question' },
      { role: 'assistant', content: 'partial' },
    ]);

    const params = streamMock.mock.calls[0]?.[0];
    expect(params.system).toBe('You are helpful.');
    expect(params.messages).toEqual([
      { role: 'user', content: 'question' },
      { role: 'assistant', content: 'partial' },
    ]);
  });

  it('should not forward temperature (thinking models reject it) and report honorsTemperature: false', async () => {
    replies({ content: [{ type: 'text', text: 'ok' }] });

    const provider = makeProvider();
    await provider.complete([{ role: 'user', content: 'hi' }], { temperature: 0.9 });

    const params = streamMock.mock.calls[0]?.[0];
    expect(params).not.toHaveProperty('temperature');
    expect(provider.capabilities.honorsTemperature).toBe(false);
  });

  it('should not time out while stream events keep arriving, however long the whole response takes', async () => {
    vi.useFakeTimers();
    replies({ content: [{ type: 'text', text: 'done' }] }, { events: 5, gapMs: 800 });

    const pending = makeProvider().complete([{ role: 'user', content: 'hi' }], { timeout: 1_000 });
    await vi.advanceTimersByTimeAsync(5_000);

    await expect(pending).resolves.toEqual({ content: 'done' });
  });
  it('should fail, retryably, when the stream ends without a stop_reason', async () => {
    replies({ content: [{ type: 'text', text: 'cut off' }], stop_reason: null });

    await expect(makeProvider().complete([{ role: 'user', content: 'hi' }])).rejects.toMatchObject({
      message: expect.stringMatching(/stream ended before the response was complete/),
      retryable: true,
    });
  });

  it('should mark a 4xx auth/validation error as non-retryable', async () => {
    fails(Object.assign(new Error('unauthorized'), { status: 401 }));

    await expect(makeProvider().complete([{ role: 'user', content: 'hi' }])).rejects.toMatchObject({
      retryable: false,
    });
  });

  it('should mark a 429 / 5xx error as retryable', async () => {
    fails(Object.assign(new Error('rate limited'), { status: 429 }));
    await expect(makeProvider().complete([{ role: 'user', content: 'hi' }])).rejects.toMatchObject({ retryable: true });

    fails(Object.assign(new Error('server error'), { status: 503 }));
    await expect(makeProvider().complete([{ role: 'user', content: 'hi' }])).rejects.toMatchObject({ retryable: true });
  });
});
