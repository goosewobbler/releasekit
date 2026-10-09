import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { writeEnvelope } from '../../src/cli.js';
import { errorEnvelope, successEnvelope } from '../../src/envelope.js';

describe('writeEnvelope', () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
    dirs.length = 0;
    vi.restoreAllMocks();
  });

  it('should write the envelope to --output and leave stdout empty', () => {
    const dir = mkdtempSync(join(tmpdir(), 'write-envelope-'));
    dirs.push(dir);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    writeEnvelope(successEnvelope({ a: 1 }), { json: true, output: join(dir, 'out.json') });

    expect(JSON.parse(readFileSync(join(dir, 'out.json'), 'utf8')).data).toEqual({ a: 1 });
    expect(log).not.toHaveBeenCalled();
  });

  it('should throw when a result cannot be written to --output, so the command fails', () => {
    expect(() => writeEnvelope(successEnvelope({ a: 1 }), { output: '/nonexistent-dir/out.json' })).toThrow();
  });

  it('should not throw out of the error path when --output is unwritable', () => {
    // The error path writes to the same file the result write just failed on; a second throw there
    // would crash the command with a stack instead of reporting the original failure.
    const stderr = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() =>
      writeEnvelope(errorEnvelope([{ code: 'GENERAL_ERROR', category: 'general', retryable: false, message: 'x' }]), {
        output: '/nonexistent-dir/out.json',
      }),
    ).not.toThrow();
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining('/nonexistent-dir/out.json'));
  });

  it('should print to stdout under --json alone and do nothing without either flag', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    writeEnvelope(successEnvelope({ a: 1 }), { json: true });
    writeEnvelope(successEnvelope({ a: 1 }), {});

    expect(log).toHaveBeenCalledTimes(1);
  });
});
