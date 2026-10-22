import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EXIT_CODES } from '@releasekit/core';
import type { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createReleaseCommand } from '../../../src/commands/release-command.js';
import { createStandingPRCommand } from '../../../src/commands/standing-pr-command.js';

describe('an unsupported version.preset', () => {
  let dir: string;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'rk-preset-'));
    writeFileSync(join(dir, 'releasekit.config.json'), JSON.stringify({ version: { preset: 'nonsense' } }));
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(dir, { recursive: true, force: true });
  });

  it.each<[string, () => Command, string[]]>([
    ['release', createReleaseCommand, ['release']],
    ['standing-pr update', createStandingPRCommand, ['standing-pr', 'update']],
  ])('should fail %s with a CONFIG_ERROR envelope listing the supported presets', async (_name, create, args) => {
    const output = join(dir, 'out.json');

    await create().parseAsync(['node', ...args, '--json', '--output', output, '--project-dir', dir]);

    const envelope = JSON.parse(readFileSync(output, 'utf-8'));
    expect(envelope.errors).toMatchObject([
      { code: 'CONFIG_ERROR', message: expect.stringMatching(/version\.preset:.*"angular".*"conventionalcommits"/) },
    ]);
    expect(exitSpy).toHaveBeenCalledWith(EXIT_CODES.CONFIG_ERROR);
  });
});
