import { describe, expect, it } from 'vitest';
import { withRetry } from '../../src/utils/retry.js';

describe('withRetry()', () => {
  it('should return the value on first successful call', async () => {
    const result = await withRetry(async () => 'success', { maxAttempts: 3, initialDelay: 0 });
    expect(result).toBe('success');
  });

  it('calls the function exactly once when it succeeds immediately', async () => {
    let calls = 0;
    await withRetry(
      async () => {
        calls++;
        return 'ok';
      },
      { maxAttempts: 5, initialDelay: 0 },
    );
    expect(calls).toBe(1);
  });

  it('retries on failure and succeeds on the 2nd attempt', async () => {
    let calls = 0;
    const result = await withRetry(
      async () => {
        calls++;
        if (calls < 2) throw new Error('temporary error');
        return 'ok';
      },
      { maxAttempts: 3, initialDelay: 0 },
    );
    expect(result).toBe('ok');
    expect(calls).toBe(2);
  });

  it('retries up to maxAttempts and then throws the last error', async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls++;
          throw new Error('always fails');
        },
        { maxAttempts: 3, initialDelay: 0 },
      ),
    ).rejects.toThrow('always fails');
    expect(calls).toBe(3);
  });

  it('maxAttempts: 1 means no retries', async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls++;
          throw new Error('fail');
        },
        { maxAttempts: 1, initialDelay: 0 },
      ),
    ).rejects.toThrow('fail');
    expect(calls).toBe(1);
  });

  it('should preserve the error type from the last attempt', async () => {
    class CustomError extends Error {}
    await expect(
      withRetry(
        async () => {
          throw new CustomError('custom');
        },
        { maxAttempts: 2, initialDelay: 0 },
      ),
    ).rejects.toBeInstanceOf(CustomError);
  });

  it('succeeds on the last allowed attempt', async () => {
    let calls = 0;
    const result = await withRetry(
      async () => {
        calls++;
        if (calls < 3) throw new Error('not yet');
        return 'done';
      },
      { maxAttempts: 3, initialDelay: 0 },
    );
    expect(result).toBe('done');
    expect(calls).toBe(3);
  });
});
