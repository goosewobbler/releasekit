/**
 * Runs the built CLI against a temp git repo.
 * Requires `pnpm build` in @releasekit/version first.
 */
import { execFileSync, execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runVersionJson } from '../utils/cli.js';
import { createConventionalCommit } from '../utils/git.js';
import { cleanupTempDir } from '../utils/tempFixture.js';
import { createWorkspaceRepo } from '../utils/workspace.js';

let tempDir: string;

function commitChange(type: string, message: string, breaking = false) {
  writeFileSync(join(tempDir, 'packages/core/index.js'), `// ${message}\n`);
  createConventionalCommit(tempDir, type, message, undefined, breaking, ['packages/core']);
}

function revertHead() {
  execSync('git revert --no-edit HEAD', { cwd: tempDir });
}

describe('reverted commits', () => {
  afterEach(() => {
    cleanupTempDir(tempDir);
  });

  it('should leave a commit reverted in the same release, and its revert, out of the changelog', () => {
    tempDir = createWorkspaceRepo('rk-reverts-', {
      packages: { core: '@test/core' },
      version: '1.4.2',
      config: { preset: 'conventionalcommits', sync: true, versionPrefix: 'v' },
      tags: ['v1.4.2'],
    });
    commitChange('fix', 'handle empty input');
    commitChange('feat', 'drop Node 18', true);
    revertHead();

    const output = runVersionJson(tempDir);
    expect(output.updates.find((u) => u.packageName === '@test/core')?.newVersion).toBe('1.4.3');
    const entries = output.changelogs.flatMap((c) => c.entries);
    expect(entries.map((e) => e.description)).toEqual(['handle empty input']);
  });

  // Git 2.43+ titles the second revert `Reapply "feat!: drop Node 18 (#12)"`. Each revert toggles the one before it.
  const fix = { description: 'handle empty input' };
  const breakingFeat = { description: 'drop Node 18', breaking: true, prNumber: '#12' };
  it.each([
    { reverts: 2, version: '2.0.0', entries: [breakingFeat, fix] },
    { reverts: 3, version: '1.4.3', entries: [fix] },
    { reverts: 4, version: '2.0.0', entries: [breakingFeat, fix] },
  ])(
    'should resolve a commit reverted $reverts times in the same release by the last revert',
    ({ reverts, version, entries }) => {
      tempDir = createWorkspaceRepo('rk-reverts-', {
        packages: { core: '@test/core' },
        version: '1.4.2',
        config: { preset: 'conventionalcommits', sync: true, versionPrefix: 'v' },
        tags: ['v1.4.2'],
      });
      commitChange('fix', 'handle empty input');
      commitChange('feat', 'drop Node 18 (#12)', true);
      for (let i = 0; i < reverts; i++) {
        revertHead();
      }

      const output = runVersionJson(tempDir);
      expect(output.updates.find((u) => u.packageName === '@test/core')?.newVersion).toBe(version);
      expect(output.changelogs.flatMap((c) => c.entries)).toMatchObject(entries);
    },
  );

  it('should keep a squash-merged revert, as the bump does', () => {
    tempDir = createWorkspaceRepo('rk-reverts-', {
      packages: { core: '@test/core' },
      version: '1.4.2',
      config: { preset: 'conventionalcommits', sync: true, versionPrefix: 'v' },
      tags: ['v1.4.2'],
    });
    commitChange('feat', 'drop Node 18 (#12)', true);
    const reverted = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: tempDir, encoding: 'utf-8' }).trim();
    writeFileSync(join(tempDir, 'packages/core/index.js'), '// reverted\n');
    execFileSync('git', ['add', 'packages/core'], { cwd: tempDir });
    const message = `Revert "feat!: drop Node 18 (#12)" (#13)\n\nThis reverts commit ${reverted}.`;
    execFileSync('git', ['commit', '-q', '-m', message], { cwd: tempDir });

    const output = runVersionJson(tempDir);
    expect(output.updates.find((u) => u.packageName === '@test/core')?.newVersion).toBe('2.0.0');
    const entries = output.changelogs.flatMap((c) => c.entries);
    expect(entries.find((e) => e.description === 'drop Node 18')?.breaking).toBe(true);
  });

  // Git 2.43+ titles a revert of a revert `Reapply "…"`; older git titles it `Revert "Revert "…""`.
  it.each(['Reapply "feat!: drop Node 18"', 'Revert "Revert "feat!: drop Node 18""'])(
    'should release %s whose revert shipped in an earlier release as the commit it reapplies',
    (title) => {
      tempDir = createWorkspaceRepo('rk-reverts-', {
        packages: { core: '@test/core' },
        version: '1.4.2',
        config: { preset: 'conventionalcommits', sync: true, versionPrefix: 'v' },
      });
      commitChange('feat', 'drop Node 18', true);
      revertHead();
      execSync('git tag v1.4.2', { cwd: tempDir });
      const revert = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: tempDir, encoding: 'utf-8' }).trim();
      writeFileSync(join(tempDir, 'packages/core/index.js'), '// reapplied\n');
      execFileSync('git', ['add', 'packages/core'], { cwd: tempDir });
      execFileSync('git', ['commit', '-q', '-m', `${title}\n\nThis reverts commit ${revert}.`], { cwd: tempDir });

      const output = runVersionJson(tempDir);
      expect(output.updates.find((u) => u.packageName === '@test/core')?.newVersion).toBe('2.0.0');
      expect(output.changelogs.flatMap((c) => c.entries)).toMatchObject([
        { type: 'added', description: 'drop Node 18', breaking: true },
      ]);
    },
  );

  it('should keep a revert of a commit from an earlier release', () => {
    tempDir = createWorkspaceRepo('rk-reverts-', {
      packages: { core: '@test/core' },
      version: '1.4.2',
      config: { preset: 'conventionalcommits', sync: true, versionPrefix: 'v' },
    });
    commitChange('feat', 'add a flag');
    execSync('git tag v1.4.2', { cwd: tempDir });
    revertHead();
    commitChange('fix', 'handle empty input');

    const output = runVersionJson(tempDir);
    expect(output.updates.find((u) => u.packageName === '@test/core')?.newVersion).toBe('1.4.3');
    const entries = output.changelogs.flatMap((c) => c.entries);
    expect(entries.map((e) => e.description)).toEqual(['handle empty input', 'Revert "feat: add a flag"']);
  });
});
