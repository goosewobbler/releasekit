/**
 * Runs the built CLI against temp git repos to check tag names, and that the next run finds the tags the previous
 * one created. Requires `pnpm build` in @releasekit/version first.
 */
import { execSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { VersionOutput } from '@releasekit/core';
import { afterEach, describe, expect, it } from 'vitest';
import { executeCliCommand, readVersionOutput } from '../utils/cli.js';
import { createConventionalCommit, initGitRepo } from '../utils/git.js';
import { createPackageJson } from '../utils/package.js';
import { cleanupTempDir, symlinkNodeModules } from '../utils/tempFixture.js';

let tempDir: string;

const git = (args: string) => execSync(`git ${args}`, { cwd: tempDir, encoding: 'utf8' }).trim();

function createRepo(kind: 'monorepo' | 'single', versionConfig: Record<string, unknown>) {
  tempDir = mkdtempSync(join(tmpdir(), 'rk-tag-naming-'));
  if (kind === 'monorepo') {
    writeFileSync(
      join(tempDir, 'package.json'),
      JSON.stringify({ name: 'test-monorepo', version: '0.1.0', private: true }),
    );
    writeFileSync(join(tempDir, 'pnpm-workspace.yaml'), 'packages:\n  - "packages/*"\n');
    for (const name of ['pkg-a', 'pkg-b']) {
      mkdirSync(join(tempDir, 'packages', name), { recursive: true });
      createPackageJson(join(tempDir, 'packages', name), `@test/${name}`);
    }
  } else {
    createPackageJson(tempDir, 'single-pkg');
  }
  const packages = kind === 'monorepo' ? ['packages/pkg-a', 'packages/pkg-b'] : ['./'];
  writeFileSync(
    join(tempDir, 'releasekit.config.json'),
    JSON.stringify({ version: { preset: 'angular', packages, ...versionConfig } }),
  );
  symlinkNodeModules(tempDir);
  initGitRepo(tempDir);
}

function feat(...pkgs: string[]) {
  if (pkgs.length === 0) {
    createConventionalCommit(tempDir, 'feat', 'add feature');
    return;
  }
  for (const pkg of pkgs) {
    writeFileSync(join(tempDir, 'packages', pkg, 'index.js'), `// ${Date.now()}\n`);
  }
  createConventionalCommit(
    tempDir,
    'feat',
    'add feature',
    undefined,
    false,
    pkgs.map((pkg) => `packages/${pkg}`),
  );
}

function version(dryRun = true): VersionOutput {
  const result = executeCliCommand('--json', tempDir, dryRun);
  expect(result.status).toBe(0);
  return readVersionOutput(result.stdout);
}

/** Writes the bump and tags it, as publish would. */
function release(): VersionOutput {
  const output = version(false);
  git('add -A');
  git('commit -q -m "chore: release"');
  for (const tag of output.tags) {
    git(`tag ${tag}`);
  }
  return output;
}

describe('tag naming', () => {
  afterEach(() => {
    cleanupTempDir(tempDir);
  });

  describe.each([
    { mode: 'sync', kind: 'monorepo', config: { sync: true } },
    { mode: 'single', kind: 'single', config: { sync: false } },
    { mode: 'async', kind: 'monorepo', config: { sync: false } },
  ] as const)('versionPrefix in $mode mode', ({ kind, config }) => {
    it.each([
      { versionPrefix: '', label: '""', tag: '0.2.0' },
      { versionPrefix: undefined, label: 'unset', tag: 'v0.2.0' },
    ])('should tag $tag when versionPrefix is $label', ({ versionPrefix, tag }) => {
      createRepo(kind, { ...config, versionPrefix });
      feat(...(kind === 'monorepo' && !config.sync ? ['pkg-a'] : []));

      expect(version().tags).toContain(tag);
    });
  });

  describe('packageSpecificTags', () => {
    it('should tag each package by default and find those tags on the next sync run', () => {
      createRepo('monorepo', { sync: true, packageSpecificTags: true });
      feat();

      expect(release().tags).toEqual(['test-pkg-a@v0.2.0', 'test-pkg-b@v0.2.0']);

      feat();
      const next = version();

      expect(next.tags).toEqual(['test-pkg-a@v0.3.0', 'test-pkg-b@v0.3.0']);
      expect(next.changelogs[0]).toMatchObject({
        previousVersion: 'test-pkg-a@v0.2.0',
        revisionRange: 'test-pkg-a@v0.2.0..HEAD',
      });
    });

    it('should tag each package by default and find its tag on the next async run', () => {
      createRepo('monorepo', { sync: false, packageSpecificTags: true });
      feat('pkg-a', 'pkg-b');

      expect(release().tags).toEqual(['test-pkg-a@v0.2.0', 'test-pkg-b@v0.2.0']);

      feat('pkg-a');
      const next = version();

      expect(next.tags).toEqual(['test-pkg-a@v0.3.0']);
      expect(next.changelogs[0]).toMatchObject({
        previousVersion: 'test-pkg-a@v0.2.0',
        revisionRange: 'test-pkg-a@v0.2.0..HEAD',
      });
    });

    it('should name the tag after the package in a single-package repo', () => {
      createRepo('single', { packageSpecificTags: true });
      feat();

      expect(version().tags).toEqual(['single-pkg@v0.2.0']);
    });

    it('should reject a tagTemplate without ${packageName}', () => {
      createRepo('monorepo', { packageSpecificTags: true, tagTemplate: '${prefix}${version}' });

      const result = executeCliCommand('--json', tempDir);

      expect(result.status).not.toBe(0);
      expect(result.stdout + result.stderr).toMatch(/tagTemplate must contain \$\{packageName\}/);
    });
  });

  describe('tagTemplate in single mode', () => {
    it('should find its own template tag on the next run', () => {
      createRepo('single', { sync: false, tagTemplate: 'release-${version}' });
      feat();
      expect(release().tags).toEqual(['release-0.2.0']);

      feat();

      expect(version().changelogs[0]).toMatchObject({
        previousVersion: 'release-0.2.0',
        revisionRange: 'release-0.2.0..HEAD',
      });
    });
  });

  describe('tagTemplate in sync mode', () => {
    it('should tag with the template and bump from that tag on the next run', () => {
      createRepo('monorepo', { sync: true, tagTemplate: 'release-${version}' });
      feat();
      expect(release().tags).toEqual(['release-0.2.0']);

      feat();
      const next = version();

      expect(next.updates.find((u) => u.packageName === '@test/pkg-a')?.newVersion).toBe('0.3.0');
      expect(next.tags).toEqual(['release-0.3.0']);
      expect(next.changelogs[0]).toMatchObject({
        previousVersion: 'release-0.2.0',
        revisionRange: 'release-0.2.0..HEAD',
      });
    });

    it('should graduate with a changelog from the last stable tag of the template', () => {
      createRepo('monorepo', { sync: true, tagTemplate: 'release-${version}' });
      feat();
      release();
      feat();
      const prerelease = executeCliCommand('--json --prerelease next', tempDir, false);
      expect(prerelease.status).toBe(0);
      git('add -A');
      git('commit -q -m "chore: release"');
      for (const tag of readVersionOutput(prerelease.stdout).tags) {
        git(`tag ${tag}`);
      }
      feat();

      const result = executeCliCommand('--json --stable', tempDir, true);
      expect(result.status).toBe(0);

      expect(readVersionOutput(result.stdout).changelogs[0]?.revisionRange).toBe('release-0.2.0..HEAD');
    });
  });
});
