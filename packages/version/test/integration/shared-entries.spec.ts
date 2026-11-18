/**
 * Runs the built CLI against a temp git repo.
 * Requires `pnpm build` in @releasekit/version first.
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runVersionJson } from '../utils/cli.js';
import { createConventionalCommit } from '../utils/git.js';
import { createPackageJson } from '../utils/package.js';
import { cleanupTempDir } from '../utils/tempFixture.js';
import { createWorkspaceRepo } from '../utils/workspace.js';

let tempDir: string;

describe('shared entries', () => {
  afterEach(() => {
    cleanupTempDir(tempDir);
  });

  it('should mark an entry from a shared package, and leave a root-only one repo-level', () => {
    tempDir = createWorkspaceRepo('rk-shared-entries-', {
      packages: { 'pkg-a': 'pkg-a', core: 'core' },
      config: {
        preset: 'angular',
        versionPrefix: 'v',
        sync: false,
        packageSpecificTags: true,
        tagTemplate: '${packageName}/v${version}',
        sharedPackages: ['core'],
      },
      tags: ['pkg-a/v0.1.0', 'core/v0.1.0'],
    });
    writeFileSync(join(tempDir, 'packages', 'pkg-a', 'index.js'), '// a\n');
    createConventionalCommit(tempDir, 'feat', 'add to pkg-a', undefined, false, ['packages/pkg-a']);
    writeFileSync(join(tempDir, 'packages', 'core', 'index.js'), '// core\n');
    createConventionalCommit(tempDir, 'fix', 'fix the shared core', undefined, false, ['packages/core']);
    writeFileSync(join(tempDir, 'README.md'), '# repo\n');
    createConventionalCommit(tempDir, 'docs', 'document the repo', undefined, false, ['README.md']);

    const output = runVersionJson(tempDir);
    const shared = Object.fromEntries((output.sharedEntries ?? []).map((e) => [e.description, e.sharedPackage]));
    expect(shared).toEqual({ 'fix the shared core': true, 'document the repo': undefined });
  });

  it("should record each package's shared-package entries from its own range, leaving out its own commits", () => {
    tempDir = createWorkspaceRepo('rk-shared-entries-', {
      packages: { 'pkg-a': 'pkg-a', 'pkg-b': 'pkg-b', core: 'core' },
      config: {
        preset: 'angular',
        versionPrefix: 'v',
        sync: false,
        packageSpecificTags: true,
        tagTemplate: '${packageName}/v${version}',
        sharedPackages: ['core'],
      },
      tags: ['pkg-a/v0.1.0', 'pkg-b/v0.1.0', 'core/v0.1.0'],
    });
    writeFileSync(join(tempDir, 'packages', 'core', 'index.js'), '// core\n');
    createConventionalCommit(tempDir, 'fix', 'fix the shared core', undefined, false, ['packages/core']);
    // pkg-b released after the core fix; pkg-a didn't.
    createPackageJson(join(tempDir, 'packages', 'pkg-b'), 'pkg-b', '0.2.0');
    execFileSync('git', ['commit', '-qam', 'chore: release pkg-b v0.2.0'], { cwd: tempDir });
    // Dated after pkg-b/v0.1.0, which it would otherwise tie with on creation time.
    execFileSync('git', ['tag', '-a', '-m', 'release', 'pkg-b/v0.2.0'], {
      cwd: tempDir,
      env: { ...process.env, GIT_COMMITTER_DATE: '2099-01-01T00:00:00Z' },
    });
    for (const name of ['pkg-a', 'pkg-b']) {
      writeFileSync(join(tempDir, 'packages', name, 'index.js'), `// ${name}\n`);
      createConventionalCommit(tempDir, 'feat', `add to ${name}`, undefined, false, [`packages/${name}`]);
    }

    const output = runVersionJson(tempDir);
    const shared = Object.fromEntries(
      output.changelogs.map((c) => [c.packageName, (c.sharedPackageEntries ?? []).map((e) => e.description)]),
    );
    expect(shared).toEqual({ 'pkg-a': ['fix the shared core'], 'pkg-b': [], core: [] });
  });
});
