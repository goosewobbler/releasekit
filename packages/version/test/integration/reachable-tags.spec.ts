/**
 * Runs the built CLI against a temp git repo whose newest tag sits on a branch HEAD can't reach.
 * Requires `pnpm build` in @releasekit/version first.
 */
import { execSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { executeCliCommand, readVersionOutput } from '../utils/cli.js';
import { createConventionalCommit, initGitRepo } from '../utils/git.js';
import { createPackageJson } from '../utils/package.js';
import { cleanupTempDir, symlinkNodeModules } from '../utils/tempFixture.js';

let tempDir: string;

const git = (args: string) => execSync(`git ${args}`, { cwd: tempDir, encoding: 'utf8' }).trim();

describe('baseline tag reachability', () => {
  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'rk-reachable-'));
    writeFileSync(join(tempDir, 'package.json'), JSON.stringify({ name: 'monorepo', version: '1.0.0', private: true }));
    writeFileSync(join(tempDir, 'pnpm-workspace.yaml'), 'packages:\n  - "packages/*"\n');
    mkdirSync(join(tempDir, 'packages/core'), { recursive: true });
    createPackageJson(join(tempDir, 'packages/core'), '@test/core', '1.0.0');
    writeFileSync(
      join(tempDir, 'releasekit.config.json'),
      JSON.stringify({ version: { preset: 'angular', packages: ['packages/core'], sync: true, versionPrefix: 'v' } }),
    );
    symlinkNodeModules(tempDir);
    initGitRepo(tempDir);
    git('tag v1.0.0');
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

    const result = executeCliCommand('--json', tempDir);
    expect(result.status).toBe(0);
    const output = readVersionOutput(result.stdout);

    expect(output.updates.find((u) => u.packageName === '@test/core')?.newVersion).toBe('1.0.1');
    expect(output.tags).toEqual(['v1.0.1']);
    // An unreachable baseline also yields 1.0.1 (the resolver floors the range at the nearest reachable tag), but
    // loses the previous version.
    expect(output.changelogs[0]).toMatchObject({ previousVersion: 'v1.0.0', revisionRange: 'v1.0.0..HEAD' });
  });
});
