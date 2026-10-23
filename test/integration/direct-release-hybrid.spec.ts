// A hybrid package's update records only its package.json; the release commit must still hold every manifest bumped.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { devNull, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const RELEASE_CLI = fileURLToPath(new URL('../../packages/release/dist/cli.js', import.meta.url));

// Ignore the developer's git config (signing, hooks) and any CI GitHub context (PR label lookups).
const env = {
  ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GITHUB_'))),
  GIT_CONFIG_GLOBAL: devNull,
  GIT_CONFIG_NOSYSTEM: '1',
};

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8', env });
}

function write(path: string, content: string): void {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, content);
}

const lock = (version: string): string => `version = 4\n\n[[package]]\nname = "rk-napi"\nversion = "${version}"\n`;

describe('direct-commit release of hybrid packages', () => {
  let repo: string;

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), 'rk-direct-release-'));
  });

  afterEach(() => rmSync(repo, { recursive: true, force: true }));

  it('should commit the Cargo.toml, Cargo.lock and pubspec.yaml it bumps and leave the tree clean', () => {
    write(join(repo, 'package.json'), '{ "name": "rk-fixture", "private": true }\n');
    write(join(repo, 'pnpm-workspace.yaml'), 'packages:\n  - "packages/*"\n');
    write(
      join(repo, 'releasekit.config.json'),
      JSON.stringify({
        version: {
          preset: 'angular',
          // The sync strategy doesn't bump a pubspec.yaml.
          sync: false,
          versionPrefix: 'v',
          tagTemplate: '${packageName}@v${version}',
          packageSpecificTags: true,
        },
        publish: {
          npm: { enabled: false },
          // As for a napi-rs crate: publish leaves the Cargo.toml alone, so only the version step bumps it.
          cargo: { enabled: false },
          git: { push: false },
          githubRelease: { enabled: false },
        },
      }),
    );
    write(join(repo, 'packages', 'napi', 'package.json'), '{ "name": "rk-napi", "version": "0.1.0" }\n');
    write(
      join(repo, 'packages', 'napi', 'Cargo.toml'),
      '[package]\nname = "rk-napi"\nversion = "0.1.0"\nedition = "2021"\n',
    );
    write(join(repo, 'packages', 'napi', 'Cargo.lock'), lock('0.1.0'));
    write(join(repo, 'packages', 'napi', 'src', 'lib.rs'), '// napi\n');
    write(join(repo, 'packages', 'dart', 'package.json'), '{ "name": "rk-dart", "version": "0.1.0" }\n');
    write(join(repo, 'packages', 'dart', 'pubspec.yaml'), 'name: rk_dart\nversion: 0.1.0\npublish_to: none\n');
    write(join(repo, 'packages', 'dart', 'lib', 'rk_dart.dart'), '// dart\n');

    git(repo, 'init', '-q');
    git(repo, 'config', 'user.name', 'test');
    git(repo, 'config', 'user.email', 'test@example.com');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-qm', 'chore: init');
    git(repo, 'tag', 'rk-napi@v0.1.0');
    git(repo, 'tag', 'rk-dart@v0.1.0');
    write(join(repo, 'packages', 'napi', 'src', 'lib.rs'), '// napi feature\n');
    write(join(repo, 'packages', 'dart', 'lib', 'rk_dart.dart'), '// dart feature\n');
    git(repo, 'commit', '-qam', 'feat: add features');

    const result = spawnSync(
      process.execPath,
      [RELEASE_CLI, 'release', '--skip-notes', '--skip-github-release', '--skip-verification'],
      { cwd: repo, encoding: 'utf-8', env },
    );
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);

    expect(git(repo, 'log', '-1', '--format=%s')).toMatch(/^chore: release /);
    expect(git(repo, 'show', 'HEAD:packages/napi/package.json')).toContain('"version": "0.2.0"');
    expect(git(repo, 'show', 'HEAD:packages/napi/Cargo.toml')).toContain('version = "0.2.0"');
    expect(git(repo, 'show', 'HEAD:packages/napi/Cargo.lock')).toBe(lock('0.2.0'));
    expect(git(repo, 'show', 'HEAD:packages/dart/pubspec.yaml')).toContain('version: 0.2.0');
    expect(git(repo, 'status', '--porcelain')).toBe('');
  });
});
