/**
 * Runs the built CLI against a temp git repo.
 * Requires `pnpm build` in @releasekit/version first.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { executeCliCommand, readVersionOutput } from '../utils/cli.js';
import { createConventionalCommit, initGitRepo } from '../utils/git.js';
import { createPackageJson } from '../utils/package.js';
import { cleanupTempDir, symlinkNodeModules } from '../utils/tempFixture.js';

let tempDir: string;

function createRepo(packages: string[], version: Record<string, unknown>) {
  tempDir = mkdtempSync(join(tmpdir(), 'rk-changelog-tags-'));
  writeFileSync(join(tempDir, 'package.json'), JSON.stringify({ name: 'monorepo', version: '0.1.0', private: true }));
  writeFileSync(join(tempDir, 'pnpm-workspace.yaml'), 'packages:\n  - "packages/*"\n');
  for (const pkg of packages) {
    mkdirSync(join(tempDir, 'packages', pkg), { recursive: true });
    createPackageJson(join(tempDir, 'packages', pkg), pkg);
  }
  writeFileSync(
    join(tempDir, 'releasekit.config.json'),
    JSON.stringify({ version: { preset: 'angular', versionPrefix: 'v', ...version } }),
  );
  symlinkNodeModules(tempDir);
  initGitRepo(tempDir);
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

    const result = executeCliCommand('--json', tempDir);

    expect(result.status).toBe(0);
    const output = readVersionOutput(result.stdout);
    expect(output.strategy).toBe(strategy);
    expect(Object.fromEntries(output.changelogs.map((c) => [c.packageName, c.tag]))).toEqual(expected);
    expect(output.tags).toEqual(Object.values(expected));
  });
});
