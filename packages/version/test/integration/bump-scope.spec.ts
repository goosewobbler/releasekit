/**
 * Runs the built CLI against a temp git repo, so the bump goes through the real conventional-commits presets.
 * Requires `pnpm build` in @releasekit/version first.
 */

import { execSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import type { VersionOutput } from '@releasekit/core';
import { afterEach, describe, expect, it } from 'vitest';
import { executeCliCommand, readVersionOutput } from '../utils/cli.js';
import { createConventionalCommit, initGitRepo } from '../utils/git.js';
import { createPackageJson } from '../utils/package.js';
import { cleanupTempDir, symlinkNodeModules } from '../utils/tempFixture.js';

let tempDir: string;

interface RepoOptions {
  /** Where the workspace sits inside the git repository. */
  workspaceDir?: string;
  sync?: boolean;
  workspaceGlobs?: string[];
  packages?: string[];
  version?: Record<string, unknown>;
}

function createRepo({
  workspaceDir = '.',
  sync = false,
  workspaceGlobs = ['packages/*'],
  packages = ['pkg-a', 'pkg-b'],
  version = {},
}: RepoOptions = {}) {
  tempDir = mkdtempSync(join(tmpdir(), 'rk-bump-scope-'));
  const ws = join(tempDir, workspaceDir);
  mkdirSync(ws, { recursive: true });
  writeFileSync(join(ws, 'package.json'), JSON.stringify({ name: 'monorepo', version: '1.0.0', private: true }));
  writeFileSync(join(ws, 'pnpm-workspace.yaml'), `packages:\n${workspaceGlobs.map((g) => `  - "${g}"\n`).join('')}`);
  for (const pkg of packages) {
    mkdirSync(join(ws, 'packages', pkg), { recursive: true });
    createPackageJson(join(ws, 'packages', pkg), basename(pkg), '1.0.0');
  }
  writeFileSync(
    join(ws, 'releasekit.config.json'),
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
  symlinkNodeModules(ws);
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

function runVersion(workspaceDir = '.'): VersionOutput {
  const result = executeCliCommand('--json', join(tempDir, workspaceDir));
  expect(result.status).toBe(0);
  return readVersionOutput(result.stdout);
}

function newVersions(workspaceDir = '.'): Record<string, string | undefined> {
  return Object.fromEntries(runVersion(workspaceDir).updates.map((u) => [u.packageName, u.newVersion]));
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

  it('should bump and note a synced release from a commit outside a nested workspace', () => {
    createRepo({ workspaceDir: 'js', sync: true });
    mkdirSync(join(tempDir, 'native'));
    commitTo('native', 'feat', 'drop the old native API', true);

    const output = runVersion('js');

    expect(output.updates.map((u) => u.newVersion)).toEqual(['2.0.0', '2.0.0', '2.0.0']);
    expect(output.changelogs.flatMap((c) => c.entries.map((e) => e.description))).toContain('drop the old native API');
  });

  it('should bump a single released package from commits to a nested package it bundles', () => {
    createRepo({ workspaceGlobs: ['packages/*', 'packages/*/plugin'], packages: ['host', 'host/plugin'] });
    // Private, so `host` is the only package released and the single-package strategy runs.
    writeFileSync(
      join(tempDir, 'packages', 'host', 'plugin', 'package.json'),
      JSON.stringify({ name: 'plugin', version: '1.0.0', private: true }),
    );
    execSync('git commit -qam "chore: make plugin private" && git tag -f host@v1.0.0', { cwd: tempDir });
    commitTo('packages/host/plugin', 'feat', 'drop the old plugin API', true);

    expect(newVersions()).toEqual({ host: '2.0.0' });
  });

  it('should not bump a targeted package from a nested package that releases on its own', () => {
    createRepo({ workspaceGlobs: ['packages/*', 'packages/*/plugin'], packages: ['host', 'host/plugin'] });
    commitTo('packages/host/plugin', 'feat', 'drop the old plugin API', true);
    commitTo('packages/host', 'fix', 'correct a typo');

    const result = executeCliCommand('--json --target host', tempDir);
    expect(result.status).toBe(0);
    const versions = Object.fromEntries(
      readVersionOutput(result.stdout).updates.map((u) => [u.packageName, u.newVersion]),
    );

    expect(versions).toEqual({ host: '1.0.1' });
  });

  it('should fail before writing any version when a cargo.paths entry leaves the repository', () => {
    createRepo({ packages: ['app'], version: { cargo: { paths: ['../../..'] } } });
    commitTo('packages/app', 'fix', 'correct a typo');

    const result = executeCliCommand('--json', tempDir, false);

    expect(result.status).not.toBe(0);
    expect(execSync('git status --porcelain --untracked-files=no', { cwd: tempDir, encoding: 'utf-8' })).toBe('');
  });
});
