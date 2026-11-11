import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { devNull, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const RELEASEKIT = fileURLToPath(new URL('../../packages/release/dist/dispatcher.js', import.meta.url));

// Ignore the developer's git config and any CI GitHub context.
const env = {
  ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GITHUB_'))),
  GIT_CONFIG_GLOBAL: devNull,
  GIT_CONFIG_NOSYSTEM: '1',
};

describe('version and publish run separately', () => {
  let repo: string;

  const git = (...args: string[]): string => execFileSync('git', args, { cwd: repo, encoding: 'utf-8', env }).trim();
  const write = (relativePath: string, content: string): void => {
    mkdirSync(dirname(join(repo, relativePath)), { recursive: true });
    writeFileSync(join(repo, relativePath), content);
  };
  const releasekit = (...args: string[]) => {
    const result = spawnSync(process.execPath, [RELEASEKIT, ...args], { cwd: repo, encoding: 'utf-8', env });
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
  };

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), 'rk-version-then-publish-'));
  });

  afterEach(() => rmSync(repo, { recursive: true, force: true }));

  it.each([
    [
      'its own Cargo.toml',
      '',
      '\n[dependencies]\nbridge = { path = "../bridge", version = "1.0.0" }\n',
      'crates/driver/Cargo.toml',
    ],
    [
      "the root's [workspace.dependencies]",
      '\n[workspace.dependencies]\nbridge = { path = "crates/bridge", version = "1.0.0" }\n',
      '\n[dependencies]\nbridge.workspace = true\n',
      'Cargo.toml',
    ],
  ])(
    "should commit a non-releasing dependent's raised requirement in %s",
    (_where, rootExtra, driverExtra, raisedManifest) => {
      write('package.json', '{ "name": "rk-fixture", "private": true }\n');
      write('Cargo.toml', `[workspace]\nmembers = ["crates/bridge", "crates/driver"]\n${rootExtra}`);
      write('crates/bridge/Cargo.toml', '[package]\nname = "bridge"\nversion = "1.0.0"\n');
      write('crates/bridge/src/lib.rs', '');
      write('crates/driver/Cargo.toml', `[package]\nname = "driver"\nversion = "1.0.0"\n${driverExtra}`);
      write('crates/driver/src/lib.rs', '');
      write(
        'releasekit.config.json',
        JSON.stringify({
          version: {
            preset: 'conventionalcommits',
            sync: false,
            versionPrefix: 'v',
            packageSpecificTags: true,
            tagTemplate: '${packageName}@v${version}',
          },
          publish: {
            npm: { enabled: false },
            cargo: { enabled: false },
            git: { push: false },
            githubRelease: { enabled: false },
          },
        }),
      );
      git('init', '-q');
      git('config', 'user.name', 'test');
      git('config', 'user.email', 'test@example.com');
      git('add', '-A');
      git('commit', '-qm', 'chore: init');
      git('tag', 'bridge@v1.0.0');
      git('tag', 'driver@v1.0.0');
      write('crates/bridge/src/lib.rs', '// replace the IPC API\n');
      git('commit', '-qam', 'feat(bridge)!: replace the IPC API');

      releasekit('version', '--json', '--output', 'version.json');
      releasekit('publish', '--input', 'version.json', '--skip-verification');

      expect(git('show', '--name-only', '--format=', 'HEAD').split('\n')).toContain(raisedManifest);
      expect(git('status', '--porcelain', '--', '*.toml')).toBe('');
    },
  );
});
