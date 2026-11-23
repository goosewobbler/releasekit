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

  describe('commit message', () => {
    const modes = {
      sync: { sync: true },
      async: { sync: false, packageSpecificTags: true },
      group: { sync: false, packageSpecificTags: true, groups: { all: { packages: ['pkg-*'], sync: 'fixed' } } },
    };

    function releaseBoth(config: Record<string, unknown>) {
      tempDir = createWorkspaceRepo('rk-release-commits-', {
        packages: { 'pkg-a': 'pkg-a', 'pkg-b': 'pkg-b' },
        config: { preset: 'angular', versionPrefix: 'v', ...config },
      });
      for (const pkg of ['pkg-a', 'pkg-b']) {
        writeFileSync(join(tempDir, 'packages', pkg, 'index.js'), '// changed\n');
      }
      createConventionalCommit(tempDir, 'feat', 'add a feature', undefined, false, ['packages']);
      return runVersionJson(tempDir).commitMessage;
    }

    it.each(Object.entries(modes))('should give %s releases the same default message', (_mode, config) => {
      expect(releaseBoth(config)).toBe('chore: release pkg-a, pkg-b v0.2.0');
    });

    it.each(Object.entries(modes))('should fill a template the same way in %s releases', (_mode, config) => {
      expect(releaseBoth({ ...config, commitMessage: 'release ${packageName} at ${version}' })).toBe(
        'release pkg-a, pkg-b at 0.2.0',
      );
    });

    it('should list each version when the released versions differ', () => {
      tempDir = createWorkspaceRepo('rk-release-commits-', {
        packages: { 'pkg-a': 'pkg-a', 'pkg-b': 'pkg-b' },
        config: { preset: 'angular', versionPrefix: 'v', ...modes.async },
      });
      createPackageJson(join(tempDir, 'packages', 'pkg-b'), 'pkg-b', '1.0.0');
      execSync('git add . && git commit -q -m "chore: set pkg-b to 1.0.0"', { cwd: tempDir });
      for (const pkg of ['pkg-a', 'pkg-b']) {
        writeFileSync(join(tempDir, 'packages', pkg, 'index.js'), '// changed\n');
      }
      createConventionalCommit(tempDir, 'feat', 'add a feature', undefined, false, ['packages']);

      expect(runVersionJson(tempDir).commitMessage).toBe('chore: release pkg-a@0.2.0, pkg-b@1.1.0');
    });
  });
});
