/**
 * Runs the built CLI against a temp git repo with a tag on a branch HEAD can't reach.
 * Requires `pnpm build` in @releasekit/version first.
 */
import { execSync, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { VersionOutput } from '@releasekit/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { executeCliCommand, readVersionOutput, runVersionJson } from '../utils/cli.js';
import { createConventionalCommit } from '../utils/git.js';
import { createPackageJson } from '../utils/package.js';
import { cleanupTempDir } from '../utils/tempFixture.js';
import { createWorkspaceRepo, writeVersionConfig } from '../utils/workspace.js';

let tempDir: string;

const git = (args: string) => execSync(`git ${args}`, { cwd: tempDir, encoding: 'utf8' }).trim();

/** Tags a commit on a branch HEAD never merges. */
function tagOnSideBranch(tag: string): void {
  const mainBranch = git('rev-parse --abbrev-ref HEAD');
  git('checkout -q -b side');
  createConventionalCommit(tempDir, 'feat', 'side work');
  git(`tag ${tag}`);
  git(`checkout -q ${mainBranch}`);
}

/** Runs the version engine the way the release preview does, with a PR's base commit as `baseRef`. */
function runVersionEngine(cwd: string, baseRef: string): VersionOutput {
  const script = `
    import { VersionEngine, enableJsonOutput, getJsonData, loadConfig } from ${JSON.stringify(join(process.cwd(), 'dist/index.js'))};
    enableJsonOutput(true);
    const engine = new VersionEngine(loadConfig(), { dryRun: true, baseRef: ${JSON.stringify(baseRef)} });
    engine.setStrategy('sync');
    await engine.run(await engine.getWorkspacePackages());
    process.stdout.write(JSON.stringify(getJsonData()));
  `;
  const result = spawnSync('node', ['--input-type=module', '-e', script], { cwd, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`version engine failed:\n${result.stderr}`);
  }
  return JSON.parse(result.stdout) as VersionOutput;
}

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

  function setUpStrictWithUnreachableTag(): void {
    writeVersionConfig(tempDir, { preset: 'angular', packages: ['packages/core'], sync: true, strictReachable: true });
    git('commit -q -am "chore: strict"');
    git('tag -d v1.0.0');
    tagOnSideBranch('v1.0.0');
  }

  it('should fail when strictReachable is set and no shared tag is reachable from HEAD', () => {
    setUpStrictWithUnreachableTag();

    const result = executeCliCommand('--json', tempDir);

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain(
      "No release tag is reachable from the current commit, but 'v1.0.0' exists",
    );
  });

  it('should not fail under strictReachable when a PR preview sets baseRef', () => {
    setUpStrictWithUnreachableTag();
    const baseRef = git('rev-parse HEAD');
    writeFileSync(join(tempDir, 'packages/core/index.js'), '// changed\n');
    createConventionalCommit(tempDir, 'fix', 'patch core', 'core', false, ['packages/core']);

    const output = runVersionEngine(tempDir, baseRef);

    expect(output.updates.find((u) => u.packageName === '@test/core')?.newVersion).toBe('1.0.1');
    expect(output.changelogs[0]?.revisionRange).toBe(`${baseRef}..HEAD`);
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

    it.each([false, true])('should ignore a newer tag on an unmerged branch (strictReachable: %s)', (strict) => {
      setUp(strict);

      const output = runVersionJson(tempDir);

      expect(output.updates.find((u) => u.packageName === '@test/core')?.newVersion).toBe('1.0.1');
      expect(output.tags).toEqual(['test-core@v1.0.1']);
      expect(output.changelogs[0]).toMatchObject({
        previousVersion: 'test-core@v1.0.0',
        revisionRange: 'test-core@v1.0.0..HEAD',
      });
    });

    it.each([
      ['one package', ['packages/core']],
      ['several packages', ['packages/core', 'packages/utils']],
    ])(
      'should fail when strictReachable is set and the only package tag is on an unmerged branch (%s)',
      (_, packages) => {
        git('tag -d v1.0.0');
        mkdirSync(join(tempDir, 'packages/utils'), { recursive: true });
        createPackageJson(join(tempDir, 'packages/utils'), '@test/utils', '1.0.0');
        writeConfig(true, packages);
        tagOnSideBranch('test-core@v1.0.0');

        const result = executeCliCommand('--json', tempDir);

        expect(result.status).not.toBe(0);
        expect(`${result.stdout}${result.stderr}`).toContain(
          "No release tag for @test/core is reachable from the current commit, but 'test-core@v1.0.0' exists",
        );
      },
    );

    it('should warn and version from the manifest without strictReachable when the only package tag is unreachable', () => {
      git('tag -d v1.0.0');
      writeConfig(false);
      tagOnSideBranch('test-core@v1.0.0');
      writeFileSync(join(tempDir, 'packages/core/index.js'), '// changed\n');
      createConventionalCommit(tempDir, 'fix', 'patch core', 'core', false, ['packages/core']);

      const result = executeCliCommand('--json', tempDir);

      expect(result.status).toBe(0);
      expect(readVersionOutput(result.stdout).tags).toEqual(['test-core@v1.0.1']);
      expect(result.stderr).toContain(
        "No release tag for @test/core is reachable from the current commit, but 'test-core@v1.0.0' exists. Versioning from the manifest.",
      );
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
