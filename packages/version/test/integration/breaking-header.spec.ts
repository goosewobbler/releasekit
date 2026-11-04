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

function coreVersion(): string | undefined {
  const result = executeCliCommand('--json', tempDir);
  expect(result.status).toBe(0);
  return readVersionOutput(result.stdout).updates.find((u) => u.packageName === '@test/core')?.newVersion;
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

    expect(coreVersion()).toBe(to);
  });

  it('should treat a `BREAKING-CHANGE:` footer as breaking with the angular preset', () => {
    createRepoAt('1.4.2', 'angular');
    writeFileSync(join(tempDir, 'packages/core/index.js'), '// changed\n');
    execSync('git add . && git commit -m "fix(core): drop the old flag" -m "BREAKING-CHANGE: the flag is gone"', {
      cwd: tempDir,
    });

    expect(coreVersion()).toBe('2.0.0');
  });
});
