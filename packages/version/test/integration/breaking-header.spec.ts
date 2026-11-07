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

function createRepoAt(version: string, preset: string) {
  tempDir = mkdtempSync(join(tmpdir(), 'rk-breaking-'));
  writeFileSync(join(tempDir, 'package.json'), JSON.stringify({ name: 'monorepo', version, private: true }));
  writeFileSync(join(tempDir, 'pnpm-workspace.yaml'), 'packages:\n  - "packages/*"\n');
  mkdirSync(join(tempDir, 'packages/core'), { recursive: true });
  createPackageJson(join(tempDir, 'packages/core'), '@test/core', version);
  writeFileSync(
    join(tempDir, 'releasekit.config.json'),
    JSON.stringify({ version: { preset, packages: ['packages/core'], sync: true, versionPrefix: 'v' } }),
  );
  symlinkNodeModules(tempDir);
  initGitRepo(tempDir);
  execSync(`git tag v${version}`, { cwd: tempDir });
}

function runVersion() {
  const result = executeCliCommand('--json', tempDir);
  expect(result.status).toBe(0);
  return readVersionOutput(result.stdout);
}

describe('breaking-change syntax', () => {
  afterEach(() => {
    cleanupTempDir(tempDir);
  });

  it.each([
    ['angular', '0.42.1', '0.43.0'],
    ['conventionalcommits', '0.42.1', '0.43.0'],
    ['angular', '1.4.2', '2.0.0'],
  ])('should treat a `type!:` header as breaking with the %s preset (%s → %s)', (preset, from, to) => {
    createRepoAt(from, preset);
    writeFileSync(join(tempDir, 'packages/core/index.js'), '// changed\n');
    createConventionalCommit(tempDir, 'fix', 'drop the old flag', 'core', true, ['packages/core']);

    const output = runVersion();
    expect(output.updates.find((u) => u.packageName === '@test/core')?.newVersion).toBe(to);
    // The bump and the changelog must agree it's breaking.
    const entry = output.changelogs.flatMap((c) => c.entries).find((e) => e.description === 'drop the old flag');
    expect(entry?.breaking).toBe(true);
  });

  it('should not read `)!: ` inside a subject as breaking with the angular preset', () => {
    createRepoAt('1.4.2', 'angular');
    writeFileSync(join(tempDir, 'packages/core/index.js'), '// changed\n');
    createConventionalCommit(tempDir, 'fix', 'accept foo(x)!: y', 'core', false, ['packages/core']);

    const output = runVersion();
    expect(output.updates.find((u) => u.packageName === '@test/core')?.newVersion).toBe('1.4.3');
    const entry = output.changelogs.flatMap((c) => c.entries).find((e) => e.description === 'accept foo(x)!: y');
    expect(entry?.breaking).toBeFalsy();
  });
});
