import { beforeEach, describe, expect, it, vi } from 'vitest';
import { classifyPublishError, withPublishRetry } from '../../../src/utils/publish-retry.js';

describe('classifyPublishError', () => {
  describe('transient errors', () => {
    const transient: Array<[string, string]> = [
      ['HTTP 500', 'npm ERR! 500 Internal Server Error - PUT https://registry.npmjs.org/pkg'],
      ['HTTP 502', 'received 502 Bad Gateway from registry'],
      ['HTTP 503', '503 Service Unavailable'],
      ['HTTP 504', 'Gateway Timeout (504)'],
      ['ETIMEDOUT', 'npm ERR! network request to https://registry.npmjs.org failed, reason: ETIMEDOUT'],
      ['ECONNRESET', 'Error: socket hang up\ncode ECONNRESET'],
      ['EAI_AGAIN', 'getaddrinfo EAI_AGAIN registry.npmjs.org'],
      ['rate limit 429', 'npm ERR! 429 Too Many Requests'],
      ['rate limit text', 'error: rate limit exceeded, please slow down'],
      ['socket hang up', 'request to crates.io failed: socket hang up'],
    ];

    it.each(transient)('should classify %s as transient', (_label, message) => {
      expect(classifyPublishError(new Error(message))).toBe('transient');
    });

    it('should read stdout/stderr from exec-style errors', () => {
      const error = Object.assign(new Error('Command failed: npm publish'), {
        stdout: '',
        stderr: 'npm ERR! 503 Service Unavailable',
        exitCode: 1,
      });
      expect(classifyPublishError(error)).toBe('transient');
    });
  });

  describe('permanent errors', () => {
    const permanent: Array<[string, string]> = [
      ['ENEEDAUTH', 'npm ERR! code ENEEDAUTH\nThis command requires you to be logged in'],
      ['E401', 'npm ERR! code E401\nnpm ERR! 401 Unauthorized'],
      ['E403', 'npm ERR! code E403\nyou do not have permission to publish'],
      ['E404 missing', 'npm ERR! 404 Not Found - GET https://registry.npmjs.org/@scope%2fpkg'],
      ['cargo auth', 'error: failed to get a 200 OK response, got 403 Forbidden'],
      ['validation', 'npm ERR! Invalid package name'],
    ];

    it.each(permanent)('should classify %s as permanent', (_label, message) => {
      expect(classifyPublishError(new Error(message))).toBe('permanent');
    });

    it('should treat unknown errors as permanent (fail-fast default)', () => {
      expect(classifyPublishError(new Error('failed to verify package tarball'))).toBe('permanent');
    });

    it('should prefer permanent when an auth error also mentions a status code', () => {
      // 403 is a status code, but auth failures must not be retried.
      expect(classifyPublishError(new Error('npm ERR! 403 Forbidden - authentication failed'))).toBe('permanent');
    });

    it('should not treat "invalid" inside raw socket errors as permanent', () => {
      // Node can phrase transient socket failures with the word "invalid" —
      // these must remain transient or retries would be suppressed.
      expect(classifyPublishError(new Error('read ECONNRESET, invalid argument'))).toBe('transient');
      expect(classifyPublishError(new Error('write EPIPE, invalid argument'))).toBe('transient');
    });

    it('should still classify validation-context "invalid" messages as permanent', () => {
      expect(classifyPublishError(new Error('npm ERR! Invalid tag name "latest@"'))).toBe('permanent');
      expect(classifyPublishError(new Error('Invalid version: "1.0.0.0" is not valid semver'))).toBe('permanent');
    });
  });
});

describe('withPublishRetry', () => {
  const noSleep = vi.fn().mockResolvedValue(undefined);
  const opts = { maxAttempts: 3, initialDelay: 1000, sleep: noSleep };

  beforeEach(() => {
    noSleep.mockClear();
  });

  it('should return the result and attempts=1 on first success', async () => {
    const fn = vi.fn().mockResolvedValue('ok');

    const result = await withPublishRetry(fn, opts);

    expect(result).toEqual({ value: 'ok', attempts: 1 });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(noSleep).not.toHaveBeenCalled();
  });

  it('should retry a transient failure and succeed, reporting attempt count', async () => {
    const fn = vi.fn().mockRejectedValueOnce(new Error('503 Service Unavailable')).mockResolvedValue('recovered');

    const result = await withPublishRetry(fn, opts);

    expect(result).toEqual({ value: 'recovered', attempts: 2 });
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('should exhaust retries on persistent transient failure and rethrow the real error', async () => {
    const realError = new Error('ETIMEDOUT');
    const fn = vi.fn().mockRejectedValue(realError);

    await expect(withPublishRetry(fn, opts)).rejects.toThrow('ETIMEDOUT');
    await expect(withPublishRetry(fn, opts)).rejects.toBe(realError);
    // 3 attempts per call, 2 calls.
    expect(fn).toHaveBeenCalledTimes(6);
  });

  it('should not retry a permanent failure (fail-fast, zero retries)', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('npm ERR! code ENEEDAUTH'));

    await expect(withPublishRetry(fn, opts)).rejects.toThrow('ENEEDAUTH');

    expect(fn).toHaveBeenCalledTimes(1);
    expect(noSleep).not.toHaveBeenCalled();
  });

  it('should report every attempt via onAttempt, including when all attempts fail', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('ETIMEDOUT'));
    const onAttempt = vi.fn();

    await expect(withPublishRetry(fn, { ...opts, onAttempt })).rejects.toThrow('ETIMEDOUT');

    // The thrown error carries no count — onAttempt is how callers record it.
    expect(onAttempt.mock.calls.map(([n]) => n)).toEqual([1, 2, 3]);
  });

  it('should use exponential backoff between retries', async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const fn = vi.fn().mockRejectedValue(new Error('ECONNRESET'));

    await expect(withPublishRetry(fn, { maxAttempts: 3, initialDelay: 1000, sleep })).rejects.toThrow('ECONNRESET');

    // Two backoffs between three attempts: 1000ms then 2000ms.
    expect(sleep.mock.calls).toEqual([[1000], [2000]]);
  });

  it('should honour a custom shouldRetry predicate', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('503 Service Unavailable'));
    const shouldRetry = vi.fn().mockReturnValue(false);

    await expect(
      withPublishRetry(fn, { maxAttempts: 3, initialDelay: 1, sleep: noSleep, shouldRetry }),
    ).rejects.toThrow('503');

    // Transient by classification, but the predicate vetoes the retry.
    expect(fn).toHaveBeenCalledTimes(1);
    expect(shouldRetry).toHaveBeenCalledTimes(1);
  });
});
