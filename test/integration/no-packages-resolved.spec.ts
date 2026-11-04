import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { devNull, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const VERSION_CLI = fileURLToPath(new URL('../../packages/version/dist/cli.js', import.meta.url));
const RELEASE_CLI = fileURLToPath(new URL('../../packages/release/dist/cli.js', import.meta.url));

// Ignore the developer's git config (signing, hooks) and any CI GitHub context (PR label lookups).
const env = {
  ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GITHUB_'))),
  GIT_CONFIG_GLOBAL: devNull,
  GIT_CONFIG_NOSYSTEM: '1',
};

function write(path: string, content: string): void {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, content);
}

function run(cli: string, args: string[], cwd: string) {
  const result = spawnSync(process.execPath, [cli, ...args, '--dry-run', '--json'], { cwd, encoding: 'utf-8', env });
  return { status: result.status, errors: JSON.parse(result.stdout).errors };
}

describe('no packages resolved', () => {
  let repo: string;

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), 'rk-no-packages-'));
    write(join(repo, 'package.json'), '{ "name": "rk-fixture", "version": "0.1.0", "private": true }\n');
    write(join(repo, 'pnpm-workspace.yaml'), 'packages:\n  - "packages/*"\n');
    write(join(repo, 'packages', 'a', 'package.json'), '{ "name": "rk-a", "version": "0.1.0", "private": true }\n');
    write(join(repo, 'packages', 'b', 'package.json'), '{ "name": "rk-b", "version": "0.1.0", "private": true }\n');
  });

  afterEach(() => rmSync(repo, { recursive: true, force: true }));

  it.each([true, false])('should fail releasekit-version and releasekit release alike (sync: %s)', (sync) => {
    write(
      join(repo, 'releasekit.config.json'),
      JSON.stringify({ version: { preset: 'angular', sync, versionPrefix: 'v', packages: ['packages/*'] } }),
    );
    execFileSync('git', ['init', '-q'], { cwd: repo, env });
    execFileSync('git', ['add', '-A'], { cwd: repo, env });
    execFileSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.com', 'commit', '-qm', 'feat: init'], {
      cwd: repo,
      env,
    });

    const version = run(VERSION_CLI, [], repo);
    const release = run(RELEASE_CLI, ['release', '--skip-notes', '--skip-publish'], repo);

    expect(version.status).not.toBe(0);
    expect(version.errors).toMatchObject([{ message: 'No packages found in workspace' }]);
    expect(release.status).toBe(version.status);
    expect(release.errors).toEqual(version.errors);
  });
});
