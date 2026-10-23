import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CompleteOptions } from '../../../src/core/types.js';
import { LLMError } from '../../../src/errors/index.js';
import { BaseLLMProvider, type IdleTimeout } from '../../../src/llm/base.js';
import type { CompleteResult } from '../../../src/llm/messages.js';

class TestProvider extends BaseLLMProvider {
  readonly name = 'test';
  readonly capabilities = { systemRole: true, structuredOutputs: false, toolUse: false };

  async complete(): Promise<CompleteResult> {
    return { content: '' };
  }

  run<T>(options: CompleteOptions | undefined, request: (idle: IdleTimeout) => Promise<T>): Promise<T> {
    return this.withIdleTimeout('Test', options, request);
  }
}

const run = <T>(options: CompleteOptions | undefined, request: (idle: IdleTimeout) => Promise<T>) =>
  new TestProvider().run(options, request);
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const throwing = (error: Error) => async () => {
  throw error;
};

function abortable<T>(idle: IdleTimeout, work: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    idle.signal.addEventListener('abort', () => reject(idle.signal.reason));
    work().then(resolve, reject);
  });
}

describe('BaseLLMProvider.withIdleTimeout', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('should not time out while the request keeps resetting, however long it takes', async () => {
    vi.useFakeTimers();
    const pending = run({ timeout: 1_000 }, (idle) =>
      abortable(idle, async () => {
        for (let i = 0; i < 5; i++) {
          await wait(800);
          idle.reset();
        }
        return 'done';
      }),
    );

    await vi.advanceTimersByTimeAsync(5_000);

    await expect(pending).resolves.toBe('done');
  });

  it('should abort a quiet request as a retryable timeout, with the abort as the cause', async () => {
    vi.useFakeTimers();
    const pending = run({ timeout: 1_000 }, (idle) => abortable(idle, () => new Promise(() => {})));

    await Promise.all([
      expect(pending).rejects.toMatchObject({
        message: 'Test request timed out: nothing received for 1000ms',
        retryable: true,
        cause: expect.objectContaining({ name: 'TimeoutError' }),
      }),
      vi.advanceTimersByTimeAsync(1_000),
    ]);
  });

  it('should report a timeout whatever the request throws once aborted', async () => {
    vi.useFakeTimers();
    const endedEarly = throwing(new LLMError('stream ended early', { retryable: true }));
    const pending = run({ timeout: 1_000 }, (idle) => abortable(idle, () => new Promise(() => {})).catch(endedEarly));

    await Promise.all([expect(pending).rejects.toThrow('Test request timed out'), vi.advanceTimersByTimeAsync(1_000)]);
  });

  it('should pass an LLMError through unchanged', async () => {
    const error = new LLMError('bad request', { retryable: false });

    await expect(run(undefined, throwing(error))).rejects.toBe(error);
  });

  it('should wrap any other error, labelled, with it as the cause', async () => {
    const error = new TypeError('boom');

    await expect(run(undefined, throwing(error))).rejects.toMatchObject({ message: 'Test error: boom', cause: error });
  });

  it('should clear the timer once the request settles', async () => {
    vi.useFakeTimers();

    await run({ timeout: 1_000 }, async () => 'ok');

    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    ['0', 0],
    ['a sub-millisecond value', 0.5],
    ['NaN', Number.NaN],
    ['a value past the timer ceiling', Number.MAX_SAFE_INTEGER],
  ])('should not abort at once for a timeout of %s', async (_label, timeout) => {
    vi.useFakeTimers();
    const pending = run({ timeout }, (idle) => abortable(idle, () => wait(10).then(() => 'ok')));

    await vi.advanceTimersByTimeAsync(10);

    await expect(pending).resolves.toBe('ok');
  });
});
