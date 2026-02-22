import { describe, expect, it, vi } from 'vitest';
import { withRetry } from '../../../src/utils/retry.js';

describe('withRetry', () => {
  it('should return result on first success', async () => {
    const fn = vi.fn().mockResolvedValue('success');

    const result = await withRetry(fn, { maxAttempts: 3, initialDelay: 1, backoffMultiplier: 1 });

    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('should retry on failure and succeed', async () => {
    const fn = vi.fn().mockRejectedValueOnce(new Error('fail 1')).mockResolvedValue('success');

    const result = await withRetry(fn, { maxAttempts: 3, initialDelay: 1, backoffMultiplier: 1 });

    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('should throw after max attempts exhausted', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('always fails'));

    await expect(withRetry(fn, { maxAttempts: 3, initialDelay: 1, backoffMultiplier: 1 })).rejects.toThrow(
      'always fails',
    );

    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('should not retry when shouldRetry returns false', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('fatal'));
    const shouldRetry = vi.fn().mockReturnValue(false);

    await expect(withRetry(fn, { maxAttempts: 3, initialDelay: 1, backoffMultiplier: 1 }, shouldRetry)).rejects.toThrow(
      'fatal',
    );

    expect(fn).toHaveBeenCalledTimes(1);
    expect(shouldRetry).toHaveBeenCalledTimes(1);
  });

  it('should call function the correct number of times before succeeding', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('1'))
      .mockRejectedValueOnce(new Error('2'))
      .mockResolvedValue('ok');

    const result = await withRetry(fn, { maxAttempts: 4, initialDelay: 1, backoffMultiplier: 1 });

    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
  });
});
