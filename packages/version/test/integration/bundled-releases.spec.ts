/**
 * Runs the built CLI against a temp git repo.
 * Requires `pnpm build` in @releasekit/version first.
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { VersionOutput } from '@releasekit/core';
import { afterEach, describe, expect, it } from 'vitest';
import { runVersionJson } from '../utils/cli.js';
import { createConventionalCommit } from '../utils/git.js';
import { cleanupTempDir } from '../utils/tempFixture.js';
import { createWorkspaceRepo, writeVersionConfig } from '../utils/workspace.js';

let tempDir: string;
let tagDay = 1;

interface PackageSpec {
  dependencies?: string[];
  devDependencies?: string[];
}

const baseConfig = {
  preset: 'angular',
  versionPrefix: 'v',
  sync: false,
  packageSpecificTags: true,
  tagTemplate: '${packageName}/v${version}',
};

function writePackage(name: string, version: string, spec: PackageSpec = {}) {
  const deps = (names: string[] = []) => Object.fromEntries(names.map((n) => [n, 'workspace:*']));
  writeFileSync(
    join(tempDir, 'packages', name, 'package.json'),
    JSON.stringify({
      name,
      version,
      dependencies: deps(spec.dependencies),
      devDependencies: deps(spec.devDependencies),
    }),
  );
}

function createRepo(packages: Record<string, PackageSpec>, config: Record<string, unknown>) {
  tagDay = 1;
  tempDir = createWorkspaceRepo('rk-bundled-', {
    packages: Object.fromEntries(Object.keys(packages).map((name) => [name, name])),
    version: '1.0.0',
  });
  writeVersionConfig(tempDir, { ...baseConfig, ...config });
  for (const [name, spec] of Object.entries(packages)) {
    writePackage(name, '1.0.0', spec);
  }
  execFileSync('git', ['add', '-A'], { cwd: tempDir });
  execFileSync('git', ['commit', '-qm', 'chore: set up packages'], { cwd: tempDir });
}

/** Dated a day apart, so tags created in the same second don't tie on creation time. */
function tag(name: string, version: string) {
  execFileSync('git', ['tag', '-a', '-m', 'release', `${name}/v${version}`], {
    cwd: tempDir,
    env: { ...process.env, GIT_COMMITTER_DATE: `2020-01-${String(tagDay++).padStart(2, '0')}T00:00:00Z` },
  });
}

function change(name: string, type: string, message: string) {
  writeFileSync(join(tempDir, 'packages', name, 'index.js'), `// ${message}\n`);
  createConventionalCommit(tempDir, type, message, undefined, false, [`packages/${name}`]);
}

/** Releases `name` at `version` on its own, as an earlier run would have. */
function release(name: string, version: string, spec?: PackageSpec) {
  writePackage(name, version, spec);
  execFileSync('git', ['commit', '-qam', `chore: release ${name} v${version}`], { cwd: tempDir });
  tag(name, version);
}

function bundled(output: VersionOutput): Record<string, unknown> {
  return Object.fromEntries(output.changelogs.filter((c) => c.bundled).map((c) => [c.packageName, c.bundled]));
}

function storedReleases(output: VersionOutput): Record<string, string[]> {
  return Object.fromEntries(
    (output.bundledReleases ?? []).map((r) => [`${r.packageName}@${r.version}`, r.entries.map((e) => e.description)]),
  );
}

describe('bundled releases', () => {
  afterEach(() => {
    cleanupTempDir(tempDir);
  });

  it("should bundle a group-mate's release in this run, leaving out a member with only a placeholder", () => {
    createRepo(
      { app: {}, plugin: {}, extra: {} },
      {
        primaryPackages: ['app'],
        groups: { svc: { packages: ['app', 'plugin', 'extra'], sync: 'fixed' } },
      },
    );
    for (const name of ['app', 'plugin', 'extra']) {
      tag(name, '1.0.0');
    }
    change('app', 'feat', 'add to app');
    change('plugin', 'fix', 'fix plugin');

    const output = runVersionJson(tempDir);

    expect(bundled(output)).toEqual({ app: [{ packageName: 'plugin', versions: ['1.1.0'] }] });
    expect(output.bundledReleases).toBeUndefined();
  });

  it('should bundle a runtime dependency released on its own since the primary, but not a dev dependency', () => {
    createRepo(
      { app: { dependencies: ['lib'], devDependencies: ['tooling'] }, lib: {}, tooling: {} },
      {
        primaryPackages: ['app'],
      },
    );
    for (const name of ['app', 'lib', 'tooling']) {
      tag(name, '1.0.0');
    }
    change('lib', 'fix', 'fix lib');
    release('lib', '1.0.1');
    change('tooling', 'fix', 'fix tooling');
    release('tooling', '1.0.1');
    change('app', 'feat', 'add to app');

    const output = runVersionJson(tempDir);

    expect(bundled(output)).toEqual({ app: [{ packageName: 'lib', versions: ['1.0.1'] }] });
    expect(storedReleases(output)).toEqual({ 'lib@1.0.1': ['fix lib'] });
  });

  it("should give each primary the dependency's releases since its own previous release, storing each once", () => {
    createRepo(
      { app: { dependencies: ['lib'] }, cli: { dependencies: ['lib'] }, lib: {} },
      {
        primaryPackages: ['app', 'cli'],
      },
    );
    for (const name of ['app', 'cli', 'lib']) {
      tag(name, '1.0.0');
    }
    change('lib', 'fix', 'fix lib once');
    release('lib', '1.0.1');
    change('app', 'feat', 'add to app');
    release('app', '1.1.0', { dependencies: ['lib'] });
    change('lib', 'fix', 'fix lib twice');
    release('lib', '1.0.2');
    change('app', 'fix', 'fix app');
    change('cli', 'fix', 'fix cli');

    const output = runVersionJson(tempDir);

    expect(bundled(output)).toEqual({
      app: [{ packageName: 'lib', versions: ['1.0.2'] }],
      cli: [{ packageName: 'lib', versions: ['1.0.1', '1.0.2'] }],
    });
    expect(storedReleases(output)).toEqual({ 'lib@1.0.1': ['fix lib once'], 'lib@1.0.2': ['fix lib twice'] });
  });

  it('should not bundle another primary', () => {
    createRepo({ app: { dependencies: ['cli'] }, cli: {} }, { primaryPackages: ['app', 'cli'] });
    tag('app', '1.0.0');
    tag('cli', '1.0.0');
    change('cli', 'fix', 'fix cli');
    release('cli', '1.0.1');
    change('app', 'feat', 'add to app');

    expect(bundled(runVersionJson(tempDir))).toEqual({});
  });

  it.each([
    ["a primary's first release", {}],
    ['a sync release', { sync: true, packageSpecificTags: false, tagTemplate: 'v${version}' }],
  ])('should bundle nothing for %s', (_, config) => {
    createRepo({ app: { dependencies: ['lib'] }, lib: {} }, { primaryPackages: ['app'], ...config });
    tag('lib', '1.0.0');
    change('lib', 'fix', 'fix lib');
    change('app', 'feat', 'add to app');

    const output = runVersionJson(tempDir);

    expect(bundled(output)).toEqual({});
    expect(output.bundledReleases).toBeUndefined();
  });
});
