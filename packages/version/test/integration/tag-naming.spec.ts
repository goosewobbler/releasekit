/**
 * Runs the built CLI against temp git repos to check tag names, and that the next run finds the tags the previous
 * one created. Requires `pnpm build` in @releasekit/version first.
 */
import { execSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { VersionOutput } from '@releasekit/core';
import { afterEach, describe, expect, it } from 'vitest';
import { executeCliCommand, runVersionJson } from '../utils/cli.js';
import { createConventionalCommit, initGitRepo } from '../utils/git.js';
import { createPackageJson } from '../utils/package.js';
import { cleanupTempDir, symlinkNodeModules } from '../utils/tempFixture.js';
import { createWorkspaceRepo, writeVersionConfig } from '../utils/workspace.js';

let tempDir: string;

const git = (args: string) => execSync(`git ${args}`, { cwd: tempDir, encoding: 'utf8' }).trim();

function createRepo(kind: 'monorepo' | 'single', versionConfig: Record<string, unknown>) {
  if (kind === 'monorepo') {
    tempDir = createWorkspaceRepo('rk-tag-naming-', {
      packages: { 'pkg-a': '@test/pkg-a', 'pkg-b': '@test/pkg-b' },
      config: { preset: 'angular', packages: ['packages/pkg-a', 'packages/pkg-b'], ...versionConfig },
    });
    return;
  }
  tempDir = mkdtempSync(join(tmpdir(), 'rk-tag-naming-'));
  createPackageJson(tempDir, 'single-pkg');
  writeVersionConfig(tempDir, { preset: 'angular', packages: ['./'], ...versionConfig });
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
  return runVersionJson(tempDir, '', dryRun);
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
    it('should find a template tag that names the package on the next run', () => {
      createRepo('single', { sync: false, tagTemplate: '${packageName}-v${version}' });
      feat();
      expect(release().tags).toEqual(['single-pkg-v0.2.0']);

      feat();

      expect(version().changelogs[0]).toMatchObject({ previousVersion: 'single-pkg-v0.2.0' });
    });

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
      const prerelease = runVersionJson(tempDir, '--prerelease next', false);
      git('add -A');
      git('commit -q -m "chore: release"');
      for (const tag of prerelease.tags) {
        git(`tag ${tag}`);
      }
      feat();

      expect(runVersionJson(tempDir, '--stable').changelogs[0]?.revisionRange).toBe('release-0.2.0..HEAD');
    });
  });
});
