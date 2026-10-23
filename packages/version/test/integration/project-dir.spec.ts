import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { executeCliCommand, readVersionOutput } from '../utils/cli.js';
import { createConventionalCommit, initGitRepo } from '../utils/git.js';
import { createPackageJson } from '../utils/package.js';
import { cleanupTempDir, symlinkNodeModules } from '../utils/tempFixture.js';

describe('--project-dir', () => {
  let parentDir: string;

  beforeEach(() => {
    parentDir = mkdtempSync(join(tmpdir(), 'rk-project-dir-'));
    const projectDir = join(parentDir, 'app');
    mkdirSync(projectDir);
    createPackageJson(projectDir, 'app');
    writeFileSync(
      join(projectDir, 'releasekit.config.json'),
      JSON.stringify({ version: { versionPrefix: 'release-' } }, null, 2),
    );
    symlinkNodeModules(projectDir);
    initGitRepo(projectDir);
    createConventionalCommit(projectDir, 'feat', 'add new feature');
  });

  afterEach(() => {
    cleanupTempDir(parentDir);
  });

  it('should load the config from a relative --project-dir', () => {
    const result = executeCliCommand('--json --project-dir app', parentDir);

    expect(result.status).toBe(0);
    expect(readVersionOutput(result.stdout).tags).toEqual(['release-0.2.0']);
  });
});
