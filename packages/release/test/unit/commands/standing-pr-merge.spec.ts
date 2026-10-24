import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EXIT_CODES } from '@releasekit/core';
import { createFakeForge } from '@releasekit/forge';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStandingPRCommand } from '../../../src/commands/standing-pr-command.js';
import { forgeFor } from '../../../src/github.js';

vi.mock('../../../src/github.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/github.js')>()),
  forgeFor: vi.fn(),
}));

describe('standing-pr merge', () => {
  let dir: string;
  let output: string;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'rk-merge-'));
    output = join(dir, 'out.json');
    writeFileSync(
      join(dir, 'releasekit.config.json'),
      JSON.stringify({ ci: { standingPr: { deleteBranchOnMerge: false } } }),
    );
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    rmSync(dir, { recursive: true, force: true });
  });

  async function merge(): Promise<Record<string, unknown>> {
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
    return JSON.parse(readFileSync(output, 'utf-8'));
  }

  it('should report a merge without --publish as changed', async () => {
    vi.stubEnv('GITHUB_REPOSITORY', 'owner/repo');
    vi.stubEnv('GITHUB_TOKEN', 'token');
    const forge = createFakeForge({
      standingPR: { number: 42, url: 'https://github.com/owner/repo/pull/42', labels: [] },
    });
    vi.mocked(forgeFor).mockReturnValue(forge);

    const envelope = await merge();

    expect(envelope).toMatchObject({ status: 'success', changed: true, data: { merged: true, prNumber: 42 } });
    expect(forge.mergedPullRequests).toEqual([{ prNumber: 42, method: 'merge' }]);
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('should fail with a GitHub error envelope when there is no GitHub context', async () => {
    vi.stubEnv('GITHUB_REPOSITORY', '');
    vi.stubEnv('GITHUB_TOKEN', '');

    const envelope = await merge();

    expect(envelope).toMatchObject({ status: 'error', changed: false });
    expect(envelope.errors).toMatchObject([
      { code: 'GITHUB_ERROR', category: 'github', message: expect.stringMatching(/No GitHub context/) },
    ]);
    expect(exitSpy).toHaveBeenCalledWith(EXIT_CODES.GITHUB_ERROR);
  });
});
