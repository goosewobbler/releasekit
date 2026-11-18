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
});
