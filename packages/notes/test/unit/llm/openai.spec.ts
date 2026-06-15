import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OpenAIProvider } from '../../../src/llm/openai.js';

const { createMock } = vi.hoisted(() => ({ createMock: vi.fn() }));

vi.mock('openai', () => ({
  default: class MockOpenAI {
    chat = { completions: { create: createMock } };
  },
}));

describe('OpenAIProvider', () => {
  beforeEach(() => {
    createMock.mockReset();
  });

  it('should parse structured output wrapped in a markdown code fence', async () => {
    // Regression for #289: some models / openai-compatible backends wrap JSON in ```json fences.
    createMock.mockResolvedValue({
      choices: [{ message: { content: '```json\n{ "entries": [{ "category": "Fixed" }] }\n```' } }],
    });
    const provider = new OpenAIProvider({ model: 'gpt-4o-mini', apiKey: 'k' });

    const result = await provider.complete([{ role: 'user', content: 'hi' }], { schema: { type: 'object' } });

    expect(result.structured).toEqual({ entries: [{ category: 'Fixed' }] });
  });

  it('should still parse plain (unfenced) JSON structured output', async () => {
    createMock.mockResolvedValue({ choices: [{ message: { content: '{ "ok": true }' } }] });
    const provider = new OpenAIProvider({ model: 'gpt-4o-mini', apiKey: 'k' });

    const result = await provider.complete([{ role: 'user', content: 'hi' }], { schema: { type: 'object' } });

    expect(result.structured).toEqual({ ok: true });
  });
});
