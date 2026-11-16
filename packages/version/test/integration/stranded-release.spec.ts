/**
 * A merged release whose publish failed leaves its version bump on the branch without a tag.
 * Requires `pnpm build` in @releasekit/version first.
 */

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { VersionOutput } from '@releasekit/core';
import { afterEach, describe, expect, it } from 'vitest';
import { runVersionJson } from '../utils/cli.js';
import { createConventionalCommit } from '../utils/git.js';
import { cleanupTempDir } from '../utils/tempFixture.js';
import { createWorkspaceRepo } from '../utils/workspace.js';

let tempDir: string;

function createRepo(config: Record<string, unknown>, tags: string[], packages = ['pkg-a'], version = '1.2.0') {
  tempDir = createWorkspaceRepo('rk-stranded-', {
    packages: Object.fromEntries(packages.map((pkg) => [pkg, pkg])),
    version,
    config: { preset: 'conventionalcommits', versionPrefix: 'v', ...config },
    tags,
  });
}

const perPackage = { sync: false, packageSpecificTags: true, tagTemplate: '${packageName}@v${version}' };

function commitTo(dir: string, type: string, message: string, breaking = false) {
  writeFileSync(join(tempDir, dir, 'index.js'), `// ${message}\n`);
  createConventionalCommit(tempDir, type, message, undefined, breaking, [dir]);
}

/** Sets each directory's manifest version in one commit, as merging a standing PR does. */
function commitVersions(versions: Record<string, string>, subject: string) {
  for (const [dir, version] of Object.entries(versions)) {
    const manifestPath = join(tempDir, dir, 'package.json');
    writeFileSync(manifestPath, JSON.stringify({ ...JSON.parse(readFileSync(manifestPath, 'utf-8')), version }));
    execSync(`git add ${dir}`, { cwd: tempDir });
  }
  execSync(`git commit -m "${subject}"`, { cwd: tempDir });
}

function strand(versions: Record<string, string>) {
  commitVersions(versions, 'chore: release 1 package(s) (#12)');
}

function changelogOf(output: VersionOutput, packageName: string) {
  return output.changelogs.find((c) => c.packageName === packageName);
}

describe('stranded release', () => {
  afterEach(() => {
    cleanupTempDir(tempDir);
  });

  describe('per-package', () => {
    it('should propose the stranded version again, without the release commit in its entries', () => {
      createRepo(perPackage, ['pkg-a@v1.2.0']);
      commitTo('packages/pkg-a', 'feat', 'add a widget');
      strand({ 'packages/pkg-a': '1.3.0' });

      const output = runVersionJson(tempDir);

      expect(output.updates.map((u) => [u.packageName, u.newVersion])).toEqual([['pkg-a', '1.3.0']]);
      const changelog = changelogOf(output, 'pkg-a');
      expect(changelog?.entries.map((e) => e.description)).toEqual(['add a widget']);
      expect(changelog?.supersedes).toBe('1.3.0');
    });

    it('should keep the stranded version when a later change needs no more than it', () => {
      createRepo(perPackage, ['pkg-a@v1.2.0']);
      commitTo('packages/pkg-a', 'feat', 'add a widget');
      strand({ 'packages/pkg-a': '1.3.0' });
      commitTo('packages/pkg-a', 'fix', 'mend the widget');

      const output = runVersionJson(tempDir);

      expect(output.updates.map((u) => u.newVersion)).toEqual(['1.3.0']);
      expect(changelogOf(output, 'pkg-a')?.entries.map((e) => e.description)).toEqual([
        'mend the widget',
        'add a widget',
      ]);
    });

    it('should raise the stranded version only to what one release would be', () => {
      createRepo(perPackage, ['pkg-a@v1.2.0']);
      commitTo('packages/pkg-a', 'feat', 'add a widget');
      strand({ 'packages/pkg-a': '1.3.0' });
      commitTo('packages/pkg-a', 'feat', 'drop the old widget', true);

      const output = runVersionJson(tempDir);

      expect(output.updates.map((u) => u.newVersion)).toEqual(['2.0.0']);
      expect(changelogOf(output, 'pkg-a')?.supersedes).toBe('1.3.0');
    });

    it('should propose a stranded major again rather than a second major', () => {
      createRepo(perPackage, ['pkg-a@v1.2.0']);
      commitTo('packages/pkg-a', 'feat', 'drop the old API', true);
      strand({ 'packages/pkg-a': '2.0.0' });

      const output = runVersionJson(tempDir);

      expect(output.updates.map((u) => u.newVersion)).toEqual(['2.0.0']);
      expect(changelogOf(output, 'pkg-a')?.entries.map((e) => e.description)).toEqual(['drop the old API']);
    });

    it('should propose a stranded version again when the release commit is its only change', () => {
      createRepo(perPackage, ['pkg-a@v1.2.0', 'pkg-b@v1.2.0'], ['pkg-a', 'pkg-b']);
      commitTo('packages/pkg-a', 'feat', 'add a widget');
      strand({ 'packages/pkg-a': '1.3.0', 'packages/pkg-b': '1.2.1' });

      const output = runVersionJson(tempDir);

      expect(output.updates.map((u) => [u.packageName, u.newVersion])).toEqual([
        ['pkg-a', '1.3.0'],
        ['pkg-b', '1.2.1'],
      ]);
    });

    it('should keep a stranded graduation stable', () => {
      createRepo(perPackage, ['pkg-a@v1.3.0-beta.1'], ['pkg-a'], '1.3.0-beta.1');
      commitTo('packages/pkg-a', 'fix', 'mend the widget');
      strand({ 'packages/pkg-a': '1.3.0' });

      expect(runVersionJson(tempDir).updates.map((u) => u.newVersion)).toEqual(['1.3.0']);
    });

    it('should keep a stranded first prerelease on its prerelease line', () => {
      createRepo(perPackage, ['pkg-a@v1.2.0']);
      commitTo('packages/pkg-a', 'feat', 'add a widget');
      strand({ 'packages/pkg-a': '1.3.0-next.0' });

      expect(runVersionJson(tempDir).updates.map((u) => u.newVersion)).toEqual(['1.3.0-next.0']);
    });

    it('should bump on top of a version ahead of its tag that no release commit set', () => {
      createRepo(perPackage, ['pkg-a@v1.2.0']);
      commitTo('packages/pkg-a', 'feat', 'add a widget');
      commitVersions({ 'packages/pkg-a': '1.3.0' }, 'chore: set the version by hand');

      const output = runVersionJson(tempDir);

      expect(output.updates.map((u) => u.newVersion)).toEqual(['1.4.0']);
      expect(changelogOf(output, 'pkg-a')?.supersedes).toBeUndefined();
    });
  });

  it('should propose a stranded sync version again for every package', () => {
    createRepo(
      { sync: true, packageSpecificTags: false, tagTemplate: '${prefix}${version}' },
      ['v1.2.0'],
      ['pkg-a', 'pkg-b'],
    );
    commitTo('packages/pkg-a', 'fix', 'correct a typo');
    strand({ '.': '1.2.1', 'packages/pkg-a': '1.2.1', 'packages/pkg-b': '1.2.1' });

    const output = runVersionJson(tempDir);

    expect(output.updates.map((u) => [u.packageName, u.newVersion])).toEqual([
      ['monorepo', '1.2.1'],
      ['pkg-a', '1.2.1'],
      ['pkg-b', '1.2.1'],
    ]);
    expect(output.changelogs.map((c) => c.supersedes)).toEqual(['1.2.1']);
    expect(output.changelogs[0]?.entries.map((e) => e.description)).toEqual(['correct a typo']);
  });

  it('should version a stranded fixed group from its tags', () => {
    createRepo(
      { ...perPackage, groups: { core: { packages: ['pkg-a', 'pkg-b'], sync: 'fixed' } } },
      ['pkg-a@v1.2.0', 'pkg-b@v1.2.0'],
      ['pkg-a', 'pkg-b'],
    );
    commitTo('packages/pkg-a', 'feat', 'add a widget');
    strand({ 'packages/pkg-a': '1.3.0', 'packages/pkg-b': '1.3.0' });

    const output = runVersionJson(tempDir);

    expect(output.updates.map((u) => [u.packageName, u.newVersion])).toEqual([
      ['pkg-a', '1.3.0'],
      ['pkg-b', '1.3.0'],
    ]);
    expect(output.changelogs.map((c) => c.supersedes)).toEqual(['1.3.0', '1.3.0']);
  });
});
