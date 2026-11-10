import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EXIT_CODES } from '@releasekit/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createReleaseCommand } from '../../../src/commands/release-command.js';
import { runRelease } from '../../../src/release.js';

vi.mock('../../../src/release.js', () => ({ runRelease: vi.fn() }));

describe('release --draft / --from-draft', () => {
  let dir: string;
  let output: string;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'rk-draft-'));
    output = join(dir, 'out.json');
    writeFileSync(join(dir, 'releasekit.config.json'), '{}');
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.stubEnv('GITHUB_REPOSITORY', 'owner/repo');
    vi.stubEnv('GITHUB_TOKEN', '');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    rmSync(dir, { recursive: true, force: true });
  });

  it.each([
    { flags: ['--draft'], consequence: 'a release draft cannot be created' },
    { flags: ['--from-draft', '9'], consequence: 'release draft #9 cannot be published' },
  ])('should fail $flags with a GitHub error before computing the release', async ({ flags, consequence }) => {
    await createReleaseCommand().parseAsync([
      'node',
      'release',
      ...flags,
      '--json',
      '--output',
      output,
      '--project-dir',
      dir,
    ]);
    const envelope = JSON.parse(readFileSync(output, 'utf-8'));

    expect(envelope).toMatchObject({ status: 'error', changed: false });
    expect(envelope.errors).toMatchObject([
      {
        code: 'GITHUB_ERROR',
        category: 'github',
        message: `No GitHub context: GITHUB_TOKEN is not set, so ${consequence}. Set GITHUB_TOKEN to a token with access to owner/repo.`,
      },
    ]);
    expect(exitSpy).toHaveBeenCalledWith(EXIT_CODES.GITHUB_ERROR);
    expect(runRelease).not.toHaveBeenCalled();
  });
});
