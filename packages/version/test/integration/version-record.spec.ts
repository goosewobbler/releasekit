/**
 * Runs the built CLI against a temp git repo.
 * Requires `pnpm build` in @releasekit/version first.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { executeCliCommand, runVersionJson } from '../utils/cli.js';
import { createConventionalCommit } from '../utils/git.js';
import { createPackageJson } from '../utils/package.js';
import { cleanupTempDir, symlinkNodeModules } from '../utils/tempFixture.js';
import { createWorkspaceRepo } from '../utils/workspace.js';

let tempDir: string;
let cloneDir: string | undefined;

const git = (...args: string[]) => execFileSync('git', args, { cwd: tempDir, encoding: 'utf-8' }).trim();

const readRecord = () => JSON.parse(readFileSync(join(tempDir, 'releasekit.versions.json'), 'utf-8'));

function writeRecord(record: Record<string, unknown>) {
  writeFileSync(join(tempDir, 'releasekit.versions.json'), JSON.stringify(record));
}

/** Commits a feature to `pkg`, with the record if there is one. */
function commitFeature(pkg: string) {
  writeFileSync(join(tempDir, 'packages', pkg, 'index.js'), `// ${Date.now()}\n`);
  git('add', '-A');
  createConventionalCommit(tempDir, 'feat', `add a feature to ${pkg}`, undefined, false, ['.']);
}

function versions(output: ReturnType<typeof runVersionJson>): Record<string, string> {
  return Object.fromEntries(output.updates.map((u) => [u.packageName, u.newVersion]));
}

describe('the version record', () => {
  afterEach(() => {
    cleanupTempDir(tempDir);
    if (cloneDir) {
      cleanupTempDir(cloneDir);
      cloneDir = undefined;
    }
  });

  it('should be updated by a run without --json', () => {
    tempDir = createWorkspaceRepo('rk-version-record-', {
      packages: { 'pkg-a': 'pkg-a', 'pkg-b': 'pkg-b' },
      config: { versionPrefix: 'v', sync: false, packageSpecificTags: true },
      tags: ['pkg-a@v0.1.0', 'pkg-b@v0.1.0'],
    });
    const recordedAt = git('rev-parse', 'HEAD');
    const existing = {
      'packages/pkg-a': { name: 'pkg-a', version: '0.1.0', at: recordedAt },
      'packages/pkg-b': { name: 'pkg-b', version: '0.1.0', at: recordedAt },
    };
    writeRecord(existing);
    commitFeature('pkg-a');
    const at = git('rev-parse', 'HEAD');

    const result = executeCliCommand('--config releasekit.config.json', tempDir, false);

    expect(result.status).toBe(0);
    expect(readRecord()).toEqual({
      ...existing,
      'packages/pkg-a': { name: 'pkg-a', version: '0.2.0', at },
    });
  });

  it('should release each package from its entry rather than its tag or manifest', () => {
    tempDir = createWorkspaceRepo('rk-version-record-', {
      packages: { 'pkg-a': 'pkg-a', 'pkg-b': 'pkg-b' },
      config: { versionPrefix: 'v', sync: true },
      tags: ['v0.1.0'],
    });
    const at = git('rev-parse', 'HEAD');
    writeRecord({
      'packages/pkg-a': { name: 'pkg-a', version: '0.3.0', at },
      'packages/pkg-b': { name: 'pkg-b', version: '0.3.0', at },
    });
    commitFeature('pkg-a');

    expect(versions(runVersionJson(tempDir))).toEqual({ monorepo: '0.4.0', 'pkg-a': '0.4.0', 'pkg-b': '0.4.0' });
  });

  it("should start a fixed group member with no entry from the group's version", () => {
    tempDir = createWorkspaceRepo('rk-version-record-', {
      packages: { core: 'core', utils: 'utils' },
      config: { versionPrefix: 'v', sync: false, groups: { lib: { packages: ['core', 'utils'], sync: 'fixed' } } },
    });
    createPackageJson(join(tempDir, 'packages', 'utils'), 'utils', '5.0.0');
    writeRecord({ 'packages/core': { name: 'core', version: '1.0.0', at: git('rev-parse', 'HEAD') } });
    commitFeature('core');

    expect(versions(runVersionJson(tempDir))).toEqual({ core: '1.1.0', utils: '1.1.0' });
  });

  it('should fail in a shallow clone', () => {
    tempDir = createWorkspaceRepo('rk-version-record-', {
      packages: { 'pkg-a': 'pkg-a' },
      config: { versionPrefix: 'v', sync: false },
      tags: ['pkg-a@v0.1.0'],
    });
    commitFeature('pkg-a');
    cloneDir = mkdtempSync(join(tmpdir(), 'rk-version-record-shallow-'));
    execFileSync('git', ['clone', '-q', '--depth', '1', `file://${tempDir}`, cloneDir]);
    symlinkNodeModules(cloneDir);

    const result = executeCliCommand('--json', cloneDir);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('this is a shallow clone');
  });

  it("should fail on a package's tag and manifest mismatch under mismatchStrategy 'error' only when it's versioned", () => {
    tempDir = createWorkspaceRepo('rk-version-record-', {
      packages: { 'pkg-a': 'pkg-a', 'pkg-b': 'pkg-b' },
      config: { versionPrefix: 'v', sync: false, packageSpecificTags: true, mismatchStrategy: 'error' },
      tags: ['pkg-a@v0.1.0', 'pkg-b@v1.0.0'],
    });
    commitFeature('pkg-a');
    commitFeature('pkg-b');

    expect(versions(runVersionJson(tempDir, '--target pkg-a'))).toEqual({ 'pkg-a': '0.2.0' });
    const result = executeCliCommand('--json --target pkg-b', tempDir);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Version mismatch detected');
  });

  it("should fail when an entry's commit isn't in the history of HEAD", () => {
    tempDir = createWorkspaceRepo('rk-version-record-', {
      packages: { 'pkg-a': 'pkg-a' },
      config: { versionPrefix: 'v', sync: false },
    });
    git('checkout', '-qb', 'maintenance');
    createConventionalCommit(tempDir, 'fix', 'a maintenance fix');
    const elsewhere = git('rev-parse', 'HEAD');
    git('checkout', '-q', '-');
    writeRecord({ 'packages/pkg-a': { name: 'pkg-a', version: '0.2.0', at: elsewhere } });
    commitFeature('pkg-a');

    const result = executeCliCommand('--json', tempDir);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(`pkg-a (packages/pkg-a) at ${elsewhere}`);
  });

  it('should move an entry whose package moved to its new path', () => {
    tempDir = createWorkspaceRepo('rk-version-record-', {
      packages: { 'pkg-a': 'pkg-a' },
      config: { versionPrefix: 'v', sync: false },
    });
    writeRecord({ 'packages/old-a': { name: 'pkg-a', version: '0.3.0', at: git('rev-parse', 'HEAD') } });
    commitFeature('pkg-a');
    const at = git('rev-parse', 'HEAD');

    const result = executeCliCommand('--config releasekit.config.json', tempDir, false);

    expect(result.status).toBe(0);
    expect(readRecord()).toEqual({ 'packages/pkg-a': { name: 'pkg-a', version: '0.4.0', at } });
  });

  it("should remove, with a warning, an entry whose package is gone, and keep an excluded package's entry", () => {
    tempDir = createWorkspaceRepo('rk-version-record-', {
      packages: { 'pkg-a': 'pkg-a', 'pkg-b': 'pkg-b' },
      config: { versionPrefix: 'v', sync: false, skip: ['pkg-b'] },
    });
    const recordedAt = git('rev-parse', 'HEAD');
    const kept = { name: 'pkg-b', version: '0.1.0', at: recordedAt };
    writeRecord({
      'packages/gone': { name: 'gone', version: '1.0.0', at: recordedAt },
      'packages/pkg-b': kept,
    });
    commitFeature('pkg-a');
    commitFeature('pkg-b');
    const at = git('rev-parse', 'HEAD');

    const result = executeCliCommand('--config releasekit.config.json', tempDir, false);

    expect(result.status).toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('Removing gone (packages/gone) from releasekit.versions.json');
    expect(readRecord()).toEqual({
      'packages/pkg-a': { name: 'pkg-a', version: '0.2.0', at },
      'packages/pkg-b': kept,
    });
  });
});
