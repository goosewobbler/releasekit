/**
 * Runs the built CLI against a temp git repo, so the bump goes through the real conventional-commits presets.
 * Requires `pnpm build` in @releasekit/version first.
 */

import { execSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { executeCliCommand, readVersionOutput } from '../utils/cli.js';
import { createConventionalCommit, initGitRepo } from '../utils/git.js';
import { createPackageJson } from '../utils/package.js';
import { cleanupTempDir, symlinkNodeModules } from '../utils/tempFixture.js';

let tempDir: string;

interface RepoOptions {
  sync?: boolean;
  workspaceGlobs?: string[];
  packages?: string[];
  version?: Record<string, unknown>;
}

function createRepo({
  sync = false,
  workspaceGlobs = ['packages/*'],
  packages = ['pkg-a', 'pkg-b'],
  version = {},
}: RepoOptions = {}) {
  tempDir = mkdtempSync(join(tmpdir(), 'rk-bump-scope-'));
  writeFileSync(join(tempDir, 'package.json'), JSON.stringify({ name: 'monorepo', version: '1.0.0', private: true }));
  writeFileSync(
    join(tempDir, 'pnpm-workspace.yaml'),
    `packages:\n${workspaceGlobs.map((g) => `  - "${g}"\n`).join('')}`,
  );
  for (const pkg of packages) {
    mkdirSync(join(tempDir, 'packages', pkg), { recursive: true });
    createPackageJson(join(tempDir, 'packages', pkg), basename(pkg), '1.0.0');
  }
  writeFileSync(
    join(tempDir, 'releasekit.config.json'),
    JSON.stringify({
      version: {
        preset: 'conventionalcommits',
        sync,
        versionPrefix: 'v',
        packageSpecificTags: !sync,
        tagTemplate: sync ? '${prefix}${version}' : '${packageName}@v${version}',
        ...version,
      },
    }),
  );
  symlinkNodeModules(tempDir);
  initGitRepo(tempDir);
  const tags = sync ? ['v1.0.0'] : packages.map((pkg) => `${basename(pkg)}@v1.0.0`);
  for (const tag of tags) {
    execSync(`git tag ${tag}`, { cwd: tempDir });
  }
}

function commitTo(dir: string, type: string, message: string, breaking = false) {
  writeFileSync(join(tempDir, dir, 'index.js'), `// ${message}\n`);
  createConventionalCommit(tempDir, type, message, undefined, breaking, [dir]);
}

function newVersions(): Record<string, string | undefined> {
  const result = executeCliCommand('--json', tempDir);
  expect(result.status).toBe(0);
  const output = readVersionOutput(result.stdout);
  return Object.fromEntries(output.updates.map((u) => [u.packageName, u.newVersion]));
}

describe('bump scope', () => {
  afterEach(() => {
    cleanupTempDir(tempDir);
  });

  it("should bump each package from its own commits, not another package's", () => {
    createRepo();
    commitTo('packages/pkg-a', 'feat', 'drop the old API', true);
    commitTo('packages/pkg-b', 'fix', 'correct a typo');

    const versions = newVersions();

    expect(versions['pkg-a']).toBe('2.0.0');
    expect(versions['pkg-b']).toBe('1.0.1');
  });

  it('should bump synced packages from every commit in the repo', () => {
    createRepo({ sync: true });
    commitTo('packages/pkg-a', 'feat', 'drop the old API', true);
    commitTo('packages/pkg-b', 'fix', 'correct a typo');

    const versions = newVersions();

    expect(versions['pkg-a']).toBe('2.0.0');
    expect(versions['pkg-b']).toBe('2.0.0');
  });

  it('should bump a package from commits to a crate it versions through cargo.paths', () => {
    createRepo({ packages: ['app'], version: { cargo: { paths: ['../../crates/app'] } } });
    mkdirSync(join(tempDir, 'crates', 'app'), { recursive: true });
    // publish = false, so discovery doesn't release the crate as a package of its own.
    writeFileSync(
      join(tempDir, 'crates', 'app', 'Cargo.toml'),
      '[package]\nname = "app"\nversion = "1.0.0"\npublish = false\n',
    );
    execSync('git add crates && git commit -m "chore: add crate"', { cwd: tempDir });
    execSync('git tag -f app@v1.0.0', { cwd: tempDir });
    commitTo('crates/app', 'feat', 'drop the old crate API', true);

    expect(newVersions().app).toBe('2.0.0');
  });

  it("should not bump a package from a nested package's commits", () => {
    createRepo({ workspaceGlobs: ['packages/*', 'packages/*/plugin'], packages: ['host', 'host/plugin'] });
    commitTo('packages/host/plugin', 'feat', 'drop the old plugin API', true);
    commitTo('packages/host', 'fix', 'correct a typo');

    const versions = newVersions();

    expect(versions.plugin).toBe('2.0.0');
    expect(versions.host).toBe('1.0.1');
  });
});
