import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { devNull, tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeForge } from '@releasekit/forge';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStandingPRCommand } from '../../../src/commands/standing-pr-command.js';
import { forgeFor } from '../../../src/github.js';

vi.mock('../../../src/github.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/github.js')>()),
  forgeFor: vi.fn(),
}));

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8' }).trim();
}

describe('standing-pr update after the release branch was deleted on the remote', () => {
  let root: string;
  let repo: string;
  let remote: string;
  let originalCwd: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    vi.stubEnv('GIT_CONFIG_GLOBAL', devNull);
    vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1');
    vi.stubEnv('GITHUB_REPOSITORY', 'owner/repo');
    vi.stubEnv('GITHUB_TOKEN', 'token');
    vi.stubEnv('GITHUB_EVENT_NAME', '');
    vi.stubEnv('GITHUB_EVENT_PATH', '');
    vi.mocked(forgeFor).mockReturnValue(createFakeForge());
    vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    root = realpathSync(mkdtempSync(join(tmpdir(), 'rk-standing-pr-prune-')));
    repo = join(root, 'repo');
    remote = join(root, 'remote.git');
  });

  afterEach(() => {
    process.chdir(originalCwd);
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    rmSync(root, { recursive: true, force: true });
  });

  it('should push the release branch despite a stale remote-tracking ref for it', async () => {
    git(root, 'init', '-q', '--bare', '-b', 'main', remote);
    mkdirSync(repo);
    git(repo, 'init', '-q', '-b', 'main');
    git(repo, 'config', 'user.email', 'test@example.com');
    git(repo, 'config', 'user.name', 'Test');
    writeFileSync(join(repo, 'package.json'), `${JSON.stringify({ name: 'rk-pkg', version: '1.0.0' }, null, 2)}\n`);
    writeFileSync(
      join(repo, 'releasekit.config.json'),
      JSON.stringify({ version: { versionPrefix: 'v' }, ci: { releaseStrategy: 'standing-pr' } }),
    );
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'chore: init');
    git(repo, 'tag', 'v1.0.0');
    git(repo, 'remote', 'add', 'origin', remote);
    git(repo, 'push', '-q', 'origin', 'main', '--tags', 'main:release/next');
    writeFileSync(join(repo, 'feature.txt'), 'feature\n');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'feat: add a feature');
    git(repo, 'push', '-q', 'origin', 'main');
    // A publish deleting the branch leaves this clone's `origin/release/next` behind.
    git(remote, 'branch', '-D', 'release/next');
    // The conventional-commits bumper runs git in the process cwd, not the project dir.
    process.chdir(repo);

    const output = join(root, 'out.json');
    await createStandingPRCommand().parseAsync([
      'node',
      'standing-pr',
      'update',
      '--json',
      '--output',
      output,
      '--project-dir',
      repo,
    ]);

    expect(JSON.parse(readFileSync(output, 'utf-8'))).toMatchObject({ status: 'success', data: { action: 'created' } });
    expect(JSON.parse(git(remote, 'show', 'release/next:package.json')).version).toBe('1.1.0');
  });
});
