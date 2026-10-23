import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { devNull, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const RELEASEKIT = fileURLToPath(new URL('../../packages/release/dist/dispatcher.js', import.meta.url));

// Ignore the developer's git config (signing, hooks) and any CI GitHub context.
const env = {
  ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GITHUB_'))),
  GIT_CONFIG_GLOBAL: devNull,
  GIT_CONFIG_NOSYSTEM: '1',
};

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8', env }).trim();
}

const manifest = (version: string): string => `{ "name": "rk-resume", "version": "${version}" }\n`;

describe('resuming a partial publish', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'rk-resume-publish-'));
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it.each([
    ['a one-line release message', 'chore: release rk-resume v0.2.0'],
    ['a release message with a second line', 'chore: release rk-resume v0.2.0\n[skip ci]'],
  ])('should reuse the release commit and push the branch and tag after a failed push, with %s', (_label, commitMessage) => {
    const repo = join(dir, 'repo');
    const remote = join(dir, 'remote.git');
    const input = join(dir, 'version.json');
    const result = join(dir, 'result.json');

    mkdirSync(repo);
    writeFileSync(join(repo, 'package.json'), manifest('0.1.0'));
    writeFileSync(
      join(repo, 'releasekit.config.json'),
      JSON.stringify({ publish: { npm: { enabled: false }, githubRelease: { enabled: false } } }),
    );
    git(repo, 'init', '-q', '-b', 'main');
    git(repo, 'config', 'user.name', 'test');
    git(repo, 'config', 'user.email', 'test@example.com');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-qm', 'chore: init');
    git(dir, 'init', '-q', '--bare', remote);
    git(repo, 'remote', 'add', 'origin', join(dir, 'missing.git'));

    writeFileSync(join(repo, 'package.json'), manifest('0.2.0'));
    writeFileSync(
      input,
      JSON.stringify({
        dryRun: false,
        updates: [{ packageName: 'rk-resume', newVersion: '0.2.0', filePath: 'package.json' }],
        changelogs: [],
        commitMessage,
        tags: ['v0.2.0'],
      }),
    );

    const publish = () =>
      spawnSync(process.execPath, [RELEASEKIT, 'publish', '--input', input, '--output', result], {
        cwd: repo,
        encoding: 'utf-8',
        env,
      });

    const failed = publish();
    expect(failed.status, `${failed.stdout}\n${failed.stderr}`).toBe(9);
    expect(JSON.parse(readFileSync(result, 'utf-8'))).toMatchObject({ status: 'error', changed: true });

    git(repo, 'remote', 'set-url', 'origin', remote);
    const resumed = publish();
    expect(resumed.status, `${resumed.stdout}\n${resumed.stderr}`).toBe(0);
    expect(JSON.parse(readFileSync(result, 'utf-8'))).toMatchObject({ status: 'success', changed: false });

    expect(git(repo, 'rev-list', '--count', 'HEAD')).toBe('2');
    const head = git(repo, 'rev-parse', 'HEAD');
    expect(git(remote, 'rev-parse', 'refs/heads/main')).toBe(head);
    expect(git(remote, 'rev-parse', 'v0.2.0^{commit}')).toBe(head);
  });
});
