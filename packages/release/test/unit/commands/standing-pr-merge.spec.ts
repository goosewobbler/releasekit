import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EXIT_CODES } from '@releasekit/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStandingPRCommand } from '../../../src/commands/standing-pr-command.js';

describe('standing-pr merge without a GitHub context', () => {
  let dir: string;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'rk-merge-'));
    writeFileSync(join(dir, 'releasekit.config.json'), '{}');
    vi.stubEnv('GITHUB_REPOSITORY', '');
    vi.stubEnv('GITHUB_TOKEN', '');
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    rmSync(dir, { recursive: true, force: true });
  });

  it('should fail with an error envelope instead of reporting a no-op', async () => {
    const output = join(dir, 'out.json');

    await createStandingPRCommand().parseAsync([
      'node',
      'standing-pr',
      'merge',
      '--json',
      '--output',
      output,
      '--project-dir',
      dir,
    ]);

    const envelope = JSON.parse(readFileSync(output, 'utf-8'));
    expect(envelope).toMatchObject({ status: 'error', changed: false });
    expect(envelope.errors).toMatchObject([{ message: expect.stringMatching(/No GitHub context/) }]);
    expect(exitSpy).toHaveBeenCalledWith(EXIT_CODES.GENERAL_ERROR);
  });
});
