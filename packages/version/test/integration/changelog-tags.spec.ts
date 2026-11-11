/**
 * Runs the built CLI against a temp git repo.
 * Requires `pnpm build` in @releasekit/version first.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runVersionJson } from '../utils/cli.js';
import { createConventionalCommit } from '../utils/git.js';
import { cleanupTempDir } from '../utils/tempFixture.js';
import { createWorkspaceRepo } from '../utils/workspace.js';

let tempDir: string;

function createRepo(packages: string[], version: Record<string, unknown>) {
  tempDir = createWorkspaceRepo('rk-changelog-tags-', {
    packages: Object.fromEntries(packages.map((pkg) => [pkg, pkg])),
    config: { preset: 'angular', versionPrefix: 'v', ...version },
  });
  for (const pkg of packages) {
    writeFileSync(join(tempDir, 'packages', pkg, 'index.js'), '// changed\n');
  }
  createConventionalCommit(
    tempDir,
    'feat',
    'add a feature',
    undefined,
    false,
    packages.map((pkg) => `packages/${pkg}`),
  );
}

const perPackageTags = { packageSpecificTags: true, tagTemplate: '${packageName}/v${version}' };
const unsynced = { sync: false, ...perPackageTags };

describe('changelog tags', () => {
  afterEach(() => {
    cleanupTempDir(tempDir);
  });

  it.each([
    ['a sync release with a shared tag', 'sync', ['pkg-a', 'pkg-b'], { sync: true }, { monorepo: 'v0.2.0' }],
    [
      'a sync release with per-package tags',
      'sync',
      ['pkg-a', 'pkg-b'],
      { sync: true, ...perPackageTags },
      { 'pkg-a': 'pkg-a/v0.2.0', 'pkg-b': 'pkg-b/v0.2.0' },
    ],
    ['a single-package release', 'single', ['pkg-a'], unsynced, { 'pkg-a': 'pkg-a/v0.2.0' }],
    ['an async release', 'async', ['pkg-a', 'pkg-b'], unsynced, { 'pkg-a': 'pkg-a/v0.2.0', 'pkg-b': 'pkg-b/v0.2.0' }],
    [
      'a group release with an ungrouped package',
      'group',
      ['pkg-a', 'pkg-b', 'pkg-c'],
      { ...unsynced, groups: { core: { packages: ['pkg-a', 'pkg-b'], sync: 'fixed' } } },
      { 'pkg-a': 'pkg-a/v0.2.0', 'pkg-b': 'pkg-b/v0.2.0', 'pkg-c': 'pkg-c/v0.2.0' },
    ],
  ])('should record the tag each changelog releases in %s', (_, strategy, packages, version, expected) => {
    createRepo(packages, version);

    const output = runVersionJson(tempDir);
    expect(output.strategy).toBe(strategy);
    expect(Object.fromEntries(output.changelogs.map((c) => [c.packageName, c.tag]))).toEqual(expected);
    expect(output.tags).toEqual(Object.values(expected));
  });
});
