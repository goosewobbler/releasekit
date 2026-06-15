import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { withContentHashCache } from '../../../src/llm/cache.js';
import type { CompleteResult, LLMMessage, LLMProvider } from '../../../src/llm/provider.js';

function mockProvider(responder: (messages: LLMMessage[]) => string): LLMProvider & { calls: number } {
  let calls = 0;
  return {
    name: 'mock',
    capabilities: { systemRole: true, structuredOutputs: false, toolUse: false },
    get calls() {
      return calls;
    },
    async complete(messages: LLMMessage[]): Promise<CompleteResult> {
      calls += 1;
      return { content: responder(messages) };
    },
  };
}

describe('withContentHashCache', () => {
  const dirs: string[] = [];
  const freshDir = () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'rk-llm-cache-'));
    dirs.push(d);
    return d;
  };

  afterEach(() => {
    for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
    dirs.length = 0;
  });

  const msgs: LLMMessage[] = [{ role: 'user', content: 'hi' }];

  it('should call the provider once and serve identical requests from cache', async () => {
    const dir = freshDir();
    const provider = mockProvider(() => 'response-A');
    const cached = withContentHashCache(provider, 'model-x', dir);

    const first = await cached.complete(msgs);
    const second = await cached.complete(msgs);

    expect(first).toEqual({ content: 'response-A' });
    expect(second).toEqual({ content: 'response-A' });
    expect(provider.calls).toBe(1);
  });

  it('should miss when the messages change', async () => {
    const dir = freshDir();
    const provider = mockProvider((m) => `echo:${m[0]?.content}`);
    const cached = withContentHashCache(provider, 'model-x', dir);

    await cached.complete([{ role: 'user', content: 'one' }]);
    await cached.complete([{ role: 'user', content: 'two' }]);

    expect(provider.calls).toBe(2);
  });

  it('should miss when the model, temperature, or schema changes', async () => {
    const dir = freshDir();
    const provider = mockProvider(() => 'r');

    await withContentHashCache(provider, 'model-x', dir).complete(msgs);
    await withContentHashCache(provider, 'model-y', dir).complete(msgs); // different model
    await withContentHashCache(provider, 'model-x', dir).complete(msgs, { temperature: 0.1 }); // different temp
    await withContentHashCache(provider, 'model-x', dir).complete(msgs, { schema: { type: 'object' } }); // different schema

    expect(provider.calls).toBe(4);
  });

  it('should hash message order, not just contents', async () => {
    const dir = freshDir();
    const provider = mockProvider(() => 'r');
    const cached = withContentHashCache(provider, 'model-x', dir);

    await cached.complete([
      { role: 'system', content: 'a' },
      { role: 'user', content: 'b' },
    ]);
    await cached.complete([
      { role: 'user', content: 'b' },
      { role: 'system', content: 'a' },
    ]);

    expect(provider.calls).toBe(2);
  });

  it('should fall back to a live call when the cache location is unwritable', async () => {
    const dir = freshDir();
    // Point the cache at a regular file so mkdir/read/write all fail; the completion still succeeds.
    const asFile = path.join(dir, 'not-a-dir');
    fs.writeFileSync(asFile, 'x');
    const provider = mockProvider(() => 'r');

    const result = await withContentHashCache(provider, 'model-x', asFile).complete(msgs);

    expect(result).toEqual({ content: 'r' });
    expect(provider.calls).toBe(1);
  });
});
