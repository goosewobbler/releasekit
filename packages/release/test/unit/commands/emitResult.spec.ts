import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { emitResult } from '../../../src/commands/emitResult.js';

describe('emitResult', () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
    dirs.length = 0;
    vi.restoreAllMocks();
  });

  it('should write the JSON result to the output file when --output is set', () => {
    const dir = mkdtempSync(join(tmpdir(), 'emit-result-'));
    dirs.push(dir);
    const file = join(dir, 'out.json');
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    emitResult({ versionOutput: { tags: ['v1.2.3'] } }, { json: true, output: file });

    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ versionOutput: { tags: ['v1.2.3'] } });
    expect(log).not.toHaveBeenCalled();
  });

  it('should print to stdout when --json is set and no --output', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    emitResult({ a: 1 }, { json: true });

    expect(log).toHaveBeenCalledWith(JSON.stringify({ a: 1 }, null, 2));
  });

  it('should do nothing when neither --json nor --output is set', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    emitResult({ a: 1 }, {});
    expect(log).not.toHaveBeenCalled();
  });

  it('should do nothing for a null or undefined result', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    emitResult(undefined, { json: true });
    emitResult(null, { json: true });
    expect(log).not.toHaveBeenCalled();
  });
});
