import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ENVELOPE_SCHEMA_VERSION } from '@releasekit/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { emitError, emitResult } from '../../../src/commands/emitResult.js';

describe('emitResult', () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
    dirs.length = 0;
    vi.restoreAllMocks();
  });

  it('should write a success envelope wrapping the result to the output file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'emit-result-'));
    dirs.push(dir);
    const file = join(dir, 'out.json');
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    emitResult({ versionOutput: { tags: ['v1.2.3'] } }, { json: true, output: file, changed: true });

    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({
      schemaVersion: ENVELOPE_SCHEMA_VERSION,
      status: 'success',
      changed: true,
      data: { versionOutput: { tags: ['v1.2.3'] } },
      warnings: [],
      errors: [],
    });
    expect(log).not.toHaveBeenCalled();
  });

  it('should print a success envelope to stdout when --json is set and no --output', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    emitResult({ a: 1 }, { json: true });

    const printed = JSON.parse(log.mock.calls[0][0] as string);
    expect(printed.status).toBe('success');
    expect(printed.data).toEqual({ a: 1 });
    expect(printed.changed).toBe(false);
  });

  it('should wrap a null result as an envelope with null data', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    emitResult(null, { json: true });

    const printed = JSON.parse(log.mock.calls[0][0] as string);
    expect(printed.status).toBe('success');
    expect(printed.data).toBeNull();
  });

  it('should do nothing when neither --json nor --output is set', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    emitResult({ a: 1 }, {});
    expect(log).not.toHaveBeenCalled();
  });
});

describe('emitError', () => {
  afterEach(() => vi.restoreAllMocks());

  it('should print an error envelope with a structured error to stdout', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    emitError(new Error('boom'), { json: true });

    const printed = JSON.parse(log.mock.calls[0][0] as string);
    expect(printed.status).toBe('error');
    expect(printed.data).toBeNull();
    expect(printed.errors[0]).toEqual({
      code: 'GENERAL_ERROR',
      category: 'general',
      retryable: false,
      message: 'boom',
    });
  });

  it('should do nothing when neither --json nor --output is set', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    emitError(new Error('boom'), {});
    expect(log).not.toHaveBeenCalled();
  });
});
