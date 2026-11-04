/**
 * Runs the built CLI against a temp git repo, so the bump goes through the real conventional-commits presets.
 * Requires `pnpm build` in @releasekit/version first.
 */

import { execSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { executeCliCommand, readVersionOutput } from '../utils/cli.js';
import { createConventionalCommit, initGitRepo } from '../utils/git.js';
import { createPackageJson } from '../utils/package.js';
import { cleanupTempDir, symlinkNodeModules } from '../utils/tempFixture.js';

let tempDir: string;

function createRepo(sync: boolean) {
  tempDir = mkdtempSync(join(tmpdir(), 'rk-bump-scope-'));
  writeFileSync(join(tempDir, 'package.json'), JSON.stringify({ name: 'monorepo', version: '1.0.0', private: true }));
  writeFileSync(join(tempDir, 'pnpm-workspace.yaml'), 'packages:\n  - "packages/*"\n');
  for (const name of ['pkg-a', 'pkg-b']) {
    mkdirSync(join(tempDir, 'packages', name), { recursive: true });
    createPackageJson(join(tempDir, 'packages', name), name, '1.0.0');
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
      },
    }),
  );
  symlinkNodeModules(tempDir);
  initGitRepo(tempDir);
  const tags = sync ? ['v1.0.0'] : ['pkg-a@v1.0.0', 'pkg-b@v1.0.0'];
  for (const tag of tags) {
    execSync(`git tag ${tag}`, { cwd: tempDir });
  }
}

function commitTo(pkg: string, type: string, message: string, breaking = false) {
  writeFileSync(join(tempDir, 'packages', pkg, 'index.js'), `// ${message}\n`);
  createConventionalCommit(tempDir, type, message, pkg, breaking, [`packages/${pkg}`]);
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
    createRepo(false);
    commitTo('pkg-a', 'feat', 'drop the old API', true);
    commitTo('pkg-b', 'fix', 'correct a typo');

    const versions = newVersions();

    expect(versions['pkg-a']).toBe('2.0.0');
    expect(versions['pkg-b']).toBe('1.0.1');
  });

  it('should bump synced packages from every commit in the repo', () => {
    createRepo(true);
    commitTo('pkg-a', 'feat', 'drop the old API', true);
    commitTo('pkg-b', 'fix', 'correct a typo');

    const versions = newVersions();

    expect(versions['pkg-a']).toBe('2.0.0');
    expect(versions['pkg-b']).toBe('2.0.0');
  });
});
