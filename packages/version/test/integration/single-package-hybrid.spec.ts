/**
 * Runs the built CLI against a temp git repo whose root is its only package. Requires `pnpm build` in
 * @releasekit/version first.
 */
import { mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { executeCliCommand, readVersionOutput } from '../utils/cli.js';
import { createConventionalCommit, initGitRepo } from '../utils/git.js';
import { createPackageJson } from '../utils/package.js';
import { cleanupTempDir, symlinkNodeModules } from '../utils/tempFixture.js';

let tempDir: string;

describe('single-package hybrid', () => {
  beforeEach(() => {
    tempDir = realpathSync(mkdtempSync(join(tmpdir(), 'rk-single-hybrid-')));
    createPackageJson(tempDir, 'my-app');
    writeFileSync(join(tempDir, 'Cargo.toml'), '[package]\nname = "my_crate"\nversion = "0.1.0"\n');
    writeFileSync(
      join(tempDir, 'releasekit.config.json'),
      JSON.stringify({ version: { preset: 'angular', sync: true, npm: { enabled: false } } }),
    );
    symlinkNodeModules(tempDir);
    initGitRepo(tempDir);
  });

  afterEach(() => {
    cleanupTempDir(tempDir);
  });

  it('should record the Cargo.toml bump under the package.json name when npm versioning is off', () => {
    createConventionalCommit(tempDir, 'feat', 'add feature');

    const result = executeCliCommand('--json', tempDir);

    expect(result.status).toBe(0);
    const output = readVersionOutput(result.stdout);
    expect(output.updates).toEqual([
      expect.objectContaining({ packageName: 'my-app', newVersion: '0.2.0', files: [join(tempDir, 'Cargo.toml')] }),
    ]);
    expect(output.tags).toEqual(['v0.2.0']);
  });
});
