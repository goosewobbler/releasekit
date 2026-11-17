import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@releasekit/version', () => ({
  loadConfig: vi.fn(() => ({ preset: 'conventionalcommits' })),
  isGroupMode: vi.fn(() => false),
  resolveCommitScope: vi.fn((dir: string) => ({ scope: [dir] })),
  VersionEngine: class {
    getWorkspacePackages = async () => ({ root: process.cwd(), packages: [] });
  },
}));
vi.mock('@releasekit/notes', () => ({
  loadConfig: vi.fn(() => ({ releaseNotes: false })),
  runPipeline: vi.fn(),
  versionOutputToChangelogInput: vi.fn(),
}));
vi.mock('@releasekit/publish', () => ({ loadConfig: vi.fn(() => ({ githubRelease: {} })) }));
vi.mock('../../../src/backfill/reconstruct.js', () => ({ reconstructChangelogs: vi.fn(async () => []) }));

import { NOTES_MARKER } from '@releasekit/core';
import { loadConfig as loadNotesConfig, runPipeline, versionOutputToChangelogInput } from '@releasekit/notes';
import { loadConfig as loadPublishConfig } from '@releasekit/publish';
import { loadConfig as loadVersionConfig } from '@releasekit/version';
import { reconstructChangelogs } from '../../../src/backfill/reconstruct.js';
import { createBackfillCommand } from '../../../src/commands/backfill-command.js';

describe('backfill command', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('should load the publish config from --config', async () => {
    vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('exit');
    });

    await expect(createBackfillCommand().parseAsync(['--config', 'custom.json'], { from: 'user' })).rejects.toThrow(
      'exit',
    );

    expect(loadPublishConfig).toHaveBeenCalledWith({ cwd: process.cwd(), configPath: 'custom.json' });
  });

  it('should skip a package listed in skipPackages under the name its tags use', async () => {
    vi.mocked(loadNotesConfig).mockReturnValueOnce({ releaseNotes: {} } as never);
    vi.mocked(loadPublishConfig).mockReturnValueOnce({ githubRelease: { skipPackages: ['scope-pkg'] } } as never);
    vi.mocked(reconstructChangelogs).mockResolvedValueOnce([{ tag: 'scope-pkg@v1.0.0', changelog: {} } as never]);

    await createBackfillCommand().parseAsync(['--package', '@scope/pkg', '--path', 'missing', '--update-releases'], {
      from: 'user',
    });

    expect(runPipeline).not.toHaveBeenCalled();
  });

  it('should look up v-prefixed tags when the config leaves versionPrefix unset', async () => {
    const actual = await vi.importActual<typeof import('@releasekit/version')>('@releasekit/version');
    vi.mocked(loadVersionConfig).mockImplementationOnce(actual.loadConfig);
    vi.mocked(loadNotesConfig).mockReturnValueOnce({ releaseNotes: {} } as never);
    const dir = mkdtempSync(join(tmpdir(), 'rk-backfill-'));
    const configPath = join(dir, 'releasekit.config.json');
    writeFileSync(configPath, JSON.stringify({ version: { sync: true } }));

    try {
      await createBackfillCommand().parseAsync(
        ['--package', 'pkg', '--path', dir, '--update-releases', '--config', configPath],
        { from: 'user' },
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }

    expect(reconstructChangelogs).toHaveBeenCalledWith(expect.objectContaining({ versionPrefix: 'v' }));
  });

  it('should pass the release body to gh edit through a notes file', async () => {
    vi.mocked(loadNotesConfig).mockReturnValueOnce({ releaseNotes: {} } as never);
    vi.mocked(reconstructChangelogs).mockResolvedValueOnce([{ tag: 'v1.0.0', changelog: { entries: [] } } as never]);
    vi.mocked(versionOutputToChangelogInput).mockReturnValueOnce({ packages: [{}] } as never);
    vi.mocked(runPipeline).mockResolvedValueOnce({ files: [], releaseNotes: { pkg: 'Notes body' } } as never);
    const bin = mkdtempSync(join(tmpdir(), 'rk-fake-gh-'));
    const gh = join(bin, 'gh');
    writeFileSync(
      gh,
      [
        '#!/bin/sh',
        `if [ "$2" = view ]; then echo '{"isDraft":false,"body":""}'; exit 0; fi`,
        `printf '%s\\n' "$@" > "${bin}/args"`,
        `cat "$5" > "${bin}/notes"`,
      ].join('\n'),
    );
    chmodSync(gh, 0o755);
    vi.stubEnv('PATH', `${bin}:${process.env.PATH}`);

    try {
      await createBackfillCommand().parseAsync(
        ['--package', 'pkg', '--path', 'missing', '--update-releases', '--apply'],
        {
          from: 'user',
        },
      );

      const [action, verb, tag, flag, notesPath] = readFileSync(join(bin, 'args'), 'utf8').trim().split('\n');
      expect([action, verb, tag, flag]).toEqual(['release', 'edit', 'v1.0.0', '--notes-file']);
      expect(readFileSync(join(bin, 'notes'), 'utf8')).toBe(`${NOTES_MARKER}\n\nNotes body\n`);
      expect(existsSync(notesPath as string)).toBe(false);
    } finally {
      rmSync(bin, { recursive: true, force: true });
    }
  });
});
