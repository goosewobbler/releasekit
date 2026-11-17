import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { error, info } from '@releasekit/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { editReleaseBody, getReleaseInfo } from '../../../src/backfill/github-release.js';
import { createBackfillCommand } from '../../../src/commands/backfill-command.js';

vi.mock('../../../src/backfill/github-release.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/backfill/github-release.js')>()),
  getReleaseInfo: vi.fn(() => ({ isDraft: false, body: '' })),
  editReleaseBody: vi.fn(),
}));

vi.mock('@releasekit/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@releasekit/core')>()),
  error: vi.fn(),
  info: vi.fn(),
  success: vi.fn(),
  warn: vi.fn(),
}));

function git(dir: string, ...args: string[]): void {
  execFileSync('git', args, { cwd: dir });
}

function write(dir: string, file: string, content: string): void {
  mkdirSync(join(dir, file, '..'), { recursive: true });
  writeFileSync(join(dir, file), content);
}

function commit(dir: string, file: string, message: string): void {
  write(dir, file, `// ${message}\n`);
  git(dir, 'add', file);
  git(dir, 'commit', '-q', '-m', message);
}

describe('backfill --all with shared tags', () => {
  let dir: string;
  let originalCwd: string;

  beforeEach(() => {
    vi.clearAllMocks();
    originalCwd = process.cwd();
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    dir = realpathSync(mkdtempSync(join(tmpdir(), 'rk-backfill-shared-')));
    git(dir, 'init', '-q', '-b', 'main');
    git(dir, 'config', 'user.email', 'test@example.com');
    git(dir, 'config', 'user.name', 'Test');
    git(dir, 'config', 'commit.gpgsign', 'false');
    git(dir, 'config', 'tag.gpgsign', 'false');
    write(
      dir,
      'package.json',
      JSON.stringify({ name: 'root', private: true, repository: 'https://github.com/owner/repo.git' }),
    );
    write(dir, 'pnpm-workspace.yaml', 'packages:\n  - "packages/*"\n');
    process.chdir(dir);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    // Windows can't remove the process's current directory.
    process.chdir(originalCwd);
    rmSync(dir, { recursive: true, force: true });
  });

  function createRepo(version: Record<string, unknown>): void {
    for (const name of ['app', 'lib']) {
      write(dir, join('packages', name, 'package.json'), JSON.stringify({ name, version: '1.0.0' }));
    }
    write(
      dir,
      'releasekit.config.json',
      JSON.stringify({
        version: { packageSpecificTags: false, tagTemplate: 'v${version}', ...version },
        notes: { releaseNotes: { file: { dir: 'release-notes' } } },
      }),
    );
    git(dir, 'add', '.');
    git(dir, 'commit', '-q', '-m', 'chore: init');
    git(dir, 'tag', 'v1.0.0');
    commit(dir, 'packages/lib/index.js', 'feat: add a lib API');
    commit(dir, 'packages/app/index.js', 'fix: correct a typo');
    git(dir, 'tag', 'v1.1.0');
  }

  async function backfill(...args: string[]): Promise<void> {
    await createBackfillCommand().parseAsync(['--all', '--update-releases', '--no-llm', ...args], { from: 'user' });
  }

  it('should edit each release once with the whole repository in its body', async () => {
    createRepo({ sync: true });

    await backfill('--apply');

    expect(vi.mocked(editReleaseBody).mock.calls.map(([tag]) => tag)).toEqual(['v1.0.0', 'v1.1.0']);
    const body = vi.mocked(editReleaseBody).mock.calls[1]?.[1];
    expect(body).toContain('add a lib API');
    expect(body).toContain('correct a typo');
    expect(body).toContain('https://github.com/owner/repo');
  });

  it('should list one update per tag in a dry run', async () => {
    createRepo({ sync: true });

    await backfill();

    const updates = vi
      .mocked(info)
      .mock.calls.map(([message]) => message)
      .filter((message) => message.includes('would update release body'));
    expect(updates).toEqual(['  v1.0.0: would update release body', '  v1.1.0: would update release body']);
    expect(editReleaseBody).not.toHaveBeenCalled();
  });

  it('should write per-version files under the name a live sync release uses', async () => {
    createRepo({ sync: true });

    await backfill('--apply');

    expect(existsSync(join(dir, 'release-notes', 'monorepo', '1.1.0.md'))).toBe(true);
  });

  it('should name the target after mainPackage', async () => {
    createRepo({ sync: true, mainPackage: 'app' });

    await backfill('--apply');

    const notes = readFileSync(join(dir, 'release-notes', 'app', '1.1.0.md'), 'utf-8');
    expect(notes).toContain('add a lib API');
    expect(editReleaseBody).toHaveBeenCalledTimes(2);
  });

  it('should refuse to backfill unsynced packages that share tags', async () => {
    createRepo({ sync: false });
    vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('exit');
    });

    await expect(backfill()).rejects.toThrow('exit');

    expect(process.exit).toHaveBeenCalledWith(1);
    expect(vi.mocked(error).mock.calls[0]?.[0]).toMatch(/app, lib/);
    expect(getReleaseInfo).not.toHaveBeenCalled();
  });

  it('should not refuse unsynced packages in version groups, which tag each member', async () => {
    createRepo({ sync: false, groups: { core: { packages: ['app', 'lib'], sync: 'fixed' } } });
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('exit');
    });

    await backfill();

    expect(exit).not.toHaveBeenCalled();
  });
});
