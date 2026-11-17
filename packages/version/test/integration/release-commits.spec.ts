/**
 * Runs the built CLI against a temp git repo.
 * Requires `pnpm build` in @releasekit/version first.
 */
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runVersionJson } from '../utils/cli.js';
import { createConventionalCommit } from '../utils/git.js';
import { createPackageJson } from '../utils/package.js';
import { cleanupTempDir } from '../utils/tempFixture.js';
import { createWorkspaceRepo } from '../utils/workspace.js';

let tempDir: string;

describe('release commits', () => {
  afterEach(() => {
    cleanupTempDir(tempDir);
  });

  it('should leave an untagged release commit out of the changelog', () => {
    tempDir = createWorkspaceRepo('rk-release-commits-', {
      packages: { 'pkg-a': 'pkg-a' },
      config: { preset: 'angular', versionPrefix: 'v', sync: true },
      tags: ['v0.1.0'],
    });
    writeFileSync(join(tempDir, 'packages', 'pkg-a', 'index.js'), '// changed\n');
    createConventionalCommit(tempDir, 'feat', 'add a feature', undefined, false, ['packages/pkg-a']);
    // A merged release whose publish failed: its bump is on the branch, but it has no tag.
    createPackageJson(join(tempDir, 'packages', 'pkg-a'), 'pkg-a', '0.2.0');
    execSync('git add . && git commit -q -m "chore: release v0.2.0 (#42)"', { cwd: tempDir });

    const output = runVersionJson(tempDir);
    expect(output.updates.find((u) => u.packageName === 'pkg-a')?.newVersion).toBe('0.3.0');
    expect(output.changelogs.flatMap((c) => c.entries.map((e) => e.description))).toEqual(['add a feature']);
  });
});
