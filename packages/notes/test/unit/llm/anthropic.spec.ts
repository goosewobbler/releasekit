import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LLMError } from '../../../src/errors/index.js';
import { AnthropicProvider } from '../../../src/llm/anthropic.js';

const { createMock } = vi.hoisted(() => ({ createMock: vi.fn() }));

vi.mock('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    messages = { create: createMock };
  },
}));

function makeProvider(model = 'claude-sonnet-5') {
  return new AnthropicProvider({ model, apiKey: 'k' });
}

describe('AnthropicProvider', () => {
  beforeEach(() => {
    createMock.mockReset();
  });

  it('should extract structured output from a tool_use block on the schema path', async () => {
    createMock.mockResolvedValue({
      content: [{ type: 'tool_use', name: 'emit_release_notes', input: { entries: [{ category: 'Fixed' }] } }],
    });

    const result = await makeProvider().complete([{ role: 'user', content: 'hi' }], { schema: { type: 'object' } });

    expect(result.structured).toEqual({ entries: [{ category: 'Fixed' }] });
    expect(JSON.parse(result.content)).toEqual({ entries: [{ category: 'Fixed' }] });
  });

  it('should throw when the schema path returns no tool_use block', async () => {
    createMock.mockResolvedValue({ content: [{ type: 'text', text: 'I could not do that' }] });

    await expect(
      makeProvider().complete([{ role: 'user', content: 'hi' }], { schema: { type: 'object' } }),
    ).rejects.toThrow(/Expected tool_use block/);
  });

  it('should find the text block even when a thinking block precedes it (thinking-model forward-compat)', async () => {
    // Sonnet 5 / Fable 5 return thinking blocks ahead of the text block; content[0] would be `thinking`.
    createMock.mockResolvedValue({
      content: [
        { type: 'thinking', thinking: 'let me reason about this' },
        { type: 'text', text: 'A concise summary.' },
      ],
    });

    const result = await makeProvider().complete([{ role: 'user', content: 'summarize' }]);

    expect(result.content).toBe('A concise summary.');
  });

  it('should return the text of a plain single-block response', async () => {
    createMock.mockResolvedValue({ content: [{ type: 'text', text: 'hello' }] });

    const result = await makeProvider().complete([{ role: 'user', content: 'hi' }]);

    expect(result.content).toBe('hello');
  });

  it('should throw when the response contains no text block', async () => {
    createMock.mockResolvedValue({ content: [{ type: 'thinking', thinking: 'only thinking' }] });

    await expect(makeProvider().complete([{ role: 'user', content: 'hi' }])).rejects.toThrow(/Expected a text block/);
  });

  it('should split the system message out and map only non-system messages', async () => {
    createMock.mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] });

    await makeProvider().complete([
      { role: 'system', content: 'You are helpful.' },
      { role: 'user', content: 'question' },
      { role: 'assistant', content: 'partial' },
    ]);

    const params = createMock.mock.calls[0]?.[0];
    expect(params.system).toBe('You are helpful.');
    expect(params.messages).toEqual([
      { role: 'user', content: 'question' },
      { role: 'assistant', content: 'partial' },
    ]);
  });

  it('should not forward temperature (thinking models reject it) and report honorsTemperature: false', async () => {
    createMock.mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] });

    const provider = makeProvider();
    await provider.complete([{ role: 'user', content: 'hi' }], { temperature: 0.9 });

    const params = createMock.mock.calls[0]?.[0];
    expect(params).not.toHaveProperty('temperature');
    expect(provider.capabilities.honorsTemperature).toBe(false);
  });

  it('should map an aborted request to a clear timeout error', async () => {
    // A create call that only settles when the request's abort signal fires.
    createMock.mockImplementation(
      (_params, opts: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          opts.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        }),
    );

    await expect(makeProvider().complete([{ role: 'user', content: 'hi' }], { timeout: 5 })).rejects.toThrow(
      /timed out/,
    );
  });

  it('should mark a 4xx auth/validation error as non-retryable', async () => {
    createMock.mockRejectedValue(Object.assign(new Error('unauthorized'), { status: 401 }));

    await expect(makeProvider().complete([{ role: 'user', content: 'hi' }])).rejects.toMatchObject({
      retryable: false,
    });
  });

  it('should mark a 429 / 5xx error as retryable', async () => {
    createMock.mockRejectedValueOnce(Object.assign(new Error('rate limited'), { status: 429 }));
    await expect(makeProvider().complete([{ role: 'user', content: 'hi' }])).rejects.toMatchObject({ retryable: true });

    createMock.mockRejectedValueOnce(Object.assign(new Error('server error'), { status: 503 }));
    await expect(makeProvider().complete([{ role: 'user', content: 'hi' }])).rejects.toMatchObject({ retryable: true });
  });

  it('should surface a timeout error as an LLMError instance', async () => {
    createMock.mockImplementation(
      (_params, opts: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          opts.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        }),
    );

    await expect(makeProvider().complete([{ role: 'user', content: 'hi' }], { timeout: 5 })).rejects.toBeInstanceOf(
      LLMError,
    );
  });
});
