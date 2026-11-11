/**
 * Runs the built CLI against a temp git repo, so the bump goes through the real conventional-commits presets.
 * Requires `pnpm build` in @releasekit/version first.
 */

import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { executeCliCommand, runVersionJson } from '../utils/cli.js';
import { createConventionalCommit } from '../utils/git.js';
import { createPackageJson } from '../utils/package.js';
import { cleanupTempDir } from '../utils/tempFixture.js';
import { createWorkspaceRepo } from '../utils/workspace.js';

let tempDir: string;

interface RepoOptions {
  workspaceDir?: string;
  sync?: boolean;
  workspaceGlobs?: string[];
  packages?: string[];
  version?: Record<string, unknown>;
}

function createRepo({
  workspaceDir = '.',
  sync = false,
  workspaceGlobs,
  packages = ['pkg-a', 'pkg-b'],
  version = {},
}: RepoOptions = {}) {
  tempDir = createWorkspaceRepo('rk-bump-scope-', {
    packages: Object.fromEntries(packages.map((pkg) => [pkg, basename(pkg)])),
    version: '1.0.0',
    config: {
      preset: 'conventionalcommits',
      sync,
      versionPrefix: 'v',
      packageSpecificTags: !sync,
      tagTemplate: sync ? '${prefix}${version}' : '${packageName}@v${version}',
      ...version,
    },
    workspaceGlobs,
    workspaceDir,
    tags: sync ? ['v1.0.0'] : packages.map((pkg) => `${basename(pkg)}@v1.0.0`),
  });
}

function commitTo(dir: string, type: string, message: string, breaking = false) {
  writeFileSync(join(tempDir, dir, 'index.js'), `// ${message}\n`);
  createConventionalCommit(tempDir, type, message, undefined, breaking, [dir]);
}

function newVersions(workspaceDir = '.', args = ''): Record<string, string | undefined> {
  return Object.fromEntries(
    runVersionJson(join(tempDir, workspaceDir), args).updates.map((u) => [u.packageName, u.newVersion]),
  );
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

  it('should not release a synced workspace for a commit elsewhere in the repository', () => {
    createRepo({ workspaceDir: 'js', sync: true });
    mkdirSync(join(tempDir, 'docs'));
    commitTo('docs', 'feat', 'document the API');

    expect(newVersions('js')).toEqual({});
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

    expect(newVersions('.', '--target host')).toEqual({ host: '1.0.1' });
  });

  it('should fail before writing any version when a cargo.paths entry leaves the repository', () => {
    createRepo({ packages: ['app'], version: { cargo: { paths: ['../../..'] } } });
    commitTo('packages/app', 'fix', 'correct a typo');

    const result = executeCliCommand('--json', tempDir, false);

    expect(result.status).not.toBe(0);
    expect(execSync('git status --porcelain --untracked-files=no', { cwd: tempDir, encoding: 'utf-8' })).toBe('');
  });

  it('should release despite a cargo.paths entry that leaves the repository for a package that is not releasing', () => {
    createRepo({
      workspaceGlobs: ['packages/*', 'tools'],
      packages: ['app'],
      version: { cargo: { paths: ['../../crates/app'] } },
    });
    mkdirSync(join(tempDir, 'tools'));
    createPackageJson(join(tempDir, 'tools'), 'tools', '1.0.0');
    execSync('git add tools && git commit -qm "chore: add tools" && git tag tools@v1.0.0 && git tag -f app@v1.0.0', {
      cwd: tempDir,
    });
    commitTo('packages/app', 'fix', 'correct a typo');

    expect(newVersions()).toEqual({ app: '1.0.1' });
  });

  it('should bump a package from nested packages outside version.packages', () => {
    createRepo({
      workspaceGlobs: ['packages/*', 'packages/*/plugin'],
      packages: ['host', 'host/plugin'],
      version: { packages: ['host'] },
    });
    commitTo('packages/host/plugin', 'feat', 'drop the old plugin API', true);

    expect(newVersions()).toEqual({ host: '2.0.0' });
  });

  it('should fail rather than skip a package whose only change is in a crate next to a bad paths entry', () => {
    createRepo({ packages: ['app'], version: { cargo: { paths: ['../../crates/app', '../../..'] } } });
    mkdirSync(join(tempDir, 'crates', 'app'), { recursive: true });
    writeFileSync(
      join(tempDir, 'crates', 'app', 'Cargo.toml'),
      '[package]\nname = "app"\nversion = "1.0.0"\npublish = false\n',
    );
    execSync('git add crates && git commit -qm "chore: add crate" && git tag -f app@v1.0.0', { cwd: tempDir });
    commitTo('crates/app', 'fix', 'correct the crate');

    const result = executeCliCommand('--json', tempDir, false);

    expect(result.status).not.toBe(0);
    expect(execSync('git status --porcelain --untracked-files=no', { cwd: tempDir, encoding: 'utf-8' })).toBe('');
  });

  it('should release despite a malformed Cargo.toml in a package that is not releasing', () => {
    createRepo({ packages: ['app', 'broken'] });
    writeFileSync(join(tempDir, 'packages', 'broken', 'Cargo.toml'), '[package\n');
    execSync(
      'git add packages && git commit -qm "chore: break a manifest" && git tag -f app@v1.0.0 && git tag -f broken@v1.0.0',
      {
        cwd: tempDir,
      },
    );
    commitTo('packages/app', 'fix', 'correct a typo');

    expect(newVersions()).toEqual({ app: '1.0.1' });
    expect(newVersions('.', '--target app --include-prerequisites')).toEqual({ app: '1.0.1' });
  });
});
