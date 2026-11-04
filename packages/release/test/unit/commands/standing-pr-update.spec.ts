import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EXIT_CODES } from '@releasekit/core';
import { FakeGit } from '@releasekit/git';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStandingPRCommand } from '../../../src/commands/standing-pr-command.js';
import { runNotesStep, runVersionStep } from '../../../src/steps.js';

let fakeGit: FakeGit;
vi.mock('@releasekit/git', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@releasekit/git')>()),
  createGitCli: () => fakeGit,
}));

vi.mock('../../../src/steps.js', () => ({
  runVersionStep: vi.fn(),
  runNotesStep: vi.fn(),
  runPublishStep: vi.fn(),
}));

describe('standing-pr update', () => {
  let dir: string;
  let output: string;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'rk-update-'));
    output = join(dir, 'out.json');
    writeFileSync(join(dir, 'releasekit.config.json'), '{}');
    fakeGit = new FakeGit({ status: ' M package.json' });
    vi.mocked(runVersionStep).mockResolvedValue({
      dryRun: false,
      updates: [{ packageName: 'pkg', newVersion: '1.1.0', filePath: 'package.json' }],
      changelogs: [],
      tags: ['v1.1.0'],
      commitMessage: 'chore: release v1.1.0',
    } as Awaited<ReturnType<typeof runVersionStep>>);
    vi.mocked(runNotesStep).mockResolvedValue({ packageNotes: {}, releaseNotes: {}, files: [] });
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    rmSync(dir, { recursive: true, force: true });
  });

  async function update(): Promise<Record<string, unknown>> {
    await createStandingPRCommand().parseAsync([
      'node',
      'standing-pr',
      'update',
      '--json',
      '--output',
      output,
      '--project-dir',
      dir,
    ]);
    return JSON.parse(readFileSync(output, 'utf-8'));
  }

  it.each([
    { context: 'no GitHub context', repository: '', token: '' },
    { context: 'no GITHUB_TOKEN', repository: 'owner/repo', token: '' },
    { context: 'a GITHUB_REPOSITORY without owner/repo', repository: 'owner', token: 'token' },
  ])(
    'should fail with a GitHub error and leave the release branch alone given $context',
    async ({ repository, token }) => {
      vi.stubEnv('GITHUB_REPOSITORY', repository);
      vi.stubEnv('GITHUB_TOKEN', token);

      const envelope = await update();

      expect(envelope).toMatchObject({ status: 'error', changed: false });
      expect(envelope.errors).toMatchObject([
        { code: 'GITHUB_ERROR', category: 'github', message: expect.stringMatching(/No GitHub context/) },
      ]);
      expect(exitSpy).toHaveBeenCalledWith(EXIT_CODES.GITHUB_ERROR);
      expect(fakeGit.resetTo).toEqual([]);
      expect(fakeGit.committed).toEqual([]);
      expect(fakeGit.pushed).toEqual([]);
    },
  );
});
