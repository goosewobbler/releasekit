/**
 * Runs the built CLI against a temp git repo whose newest tag sits on a branch HEAD can't reach.
 * Requires `pnpm build` in @releasekit/version first.
 */
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { executeCliCommand, runVersionJson } from '../utils/cli.js';
import { createConventionalCommit } from '../utils/git.js';
import { createPackageJson } from '../utils/package.js';
import { cleanupTempDir } from '../utils/tempFixture.js';
import { createWorkspaceRepo, writeVersionConfig } from '../utils/workspace.js';

let tempDir: string;

const git = (args: string) => execSync(`git ${args}`, { cwd: tempDir, encoding: 'utf8' }).trim();

describe('baseline tag reachability', () => {
  beforeEach(() => {
    tempDir = createWorkspaceRepo('rk-reachable-', {
      packages: { core: '@test/core' },
      version: '1.0.0',
      config: { preset: 'angular', packages: ['packages/core'], sync: true, versionPrefix: 'v' },
      tags: ['v1.0.0'],
    });
  });

  afterEach(() => {
    cleanupTempDir(tempDir);
  });

  it('should bump from the latest tag reachable from HEAD, ignoring a newer tag on an unmerged branch', () => {
    const mainBranch = git('rev-parse --abbrev-ref HEAD');
    git('checkout -q -b side');
    createConventionalCommit(tempDir, 'feat', 'side work');
    git('tag v3.0.0');
    git(`checkout -q ${mainBranch}`);

    writeFileSync(join(tempDir, 'packages/core/index.js'), '// changed\n');
    createConventionalCommit(tempDir, 'fix', 'patch core', 'core', false, ['packages/core']);

    const output = runVersionJson(tempDir);

    expect(output.updates.find((u) => u.packageName === '@test/core')?.newVersion).toBe('1.0.1');
    expect(output.tags).toEqual(['v1.0.1']);
    // Picking v3.0.0 would still give 1.0.1, since the resolver falls back to the nearest reachable tag. Only
    // previousVersion shows the difference.
    expect(output.changelogs[0]).toMatchObject({ previousVersion: 'v1.0.0', revisionRange: 'v1.0.0..HEAD' });
  });

  describe('with package-specific tags', () => {
    function writeConfig(strictReachable: boolean, packages = ['packages/core']): void {
      writeVersionConfig(tempDir, {
        preset: 'angular',
        packages,
        sync: false,
        packageSpecificTags: true,
        versionPrefix: 'v',
        strictReachable,
      });
      git('add releasekit.config.json');
      git('commit -q -m "chore: package tags"');
    }

    function setUp(strictReachable: boolean): void {
      writeConfig(strictReachable);
      git('tag test-core@v1.0.0');
      const mainBranch = git('rev-parse --abbrev-ref HEAD');
      git('checkout -q -b side');
      createConventionalCommit(tempDir, 'feat', 'side work');
      // Dated after test-core@v1.0.0, which it would otherwise tie with on creation time.
      execSync('git tag -a -m side test-core@v3.0.0', {
        cwd: tempDir,
        env: { ...process.env, GIT_COMMITTER_DATE: '2099-01-01T00:00:00Z' },
      });
      git(`checkout -q ${mainBranch}`);
      writeFileSync(join(tempDir, 'packages/core/index.js'), '// changed\n');
      createConventionalCommit(tempDir, 'fix', 'patch core', 'core', false, ['packages/core']);
    }

    it('should fail when strictReachable is set and the latest tag is on an unmerged branch', () => {
      setUp(true);

      const result = executeCliCommand('--json', tempDir);

      expect(result.status).not.toBe(0);
      expect(`${result.stdout}${result.stderr}`).toContain("Git tag 'test-core@v3.0.0' is not reachable");
    });

    it('should fall back without strictReachable', () => {
      setUp(false);

      const output = runVersionJson(tempDir);

      expect(output.updates.find((u) => u.packageName === '@test/core')?.newVersion).toBe('1.0.1');
      expect(output.tags).toEqual(['test-core@v1.0.1']);
      expect(output.changelogs[0]?.revisionRange).toBe('test-core@v1.0.0..HEAD');
    });

    it("should release a package's first version from its manifest when strictReachable is set", () => {
      git('tag -d v1.0.0');
      // A second package makes this a multi-package run, which bases an untagged package on its manifest version.
      mkdirSync(join(tempDir, 'packages/utils'), { recursive: true });
      createPackageJson(join(tempDir, 'packages/utils'), '@test/utils', '1.0.0');
      writeConfig(true, ['packages/core', 'packages/utils']);
      writeFileSync(join(tempDir, 'packages/core/index.js'), '// changed\n');
      createConventionalCommit(tempDir, 'fix', 'patch core', 'core', false, ['packages/core']);

      const output = runVersionJson(tempDir);

      expect(output.updates.find((u) => u.packageName === '@test/core')?.newVersion).toBe('1.0.1');
      expect(output.tags).toContain('test-core@v1.0.1');
    });
  });
});
