/**
 * Runs the built CLI against a temp git repo.
 * Requires `pnpm build` in @releasekit/version first.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { executeCliCommand } from '../utils/cli.js';
import { createConventionalCommit } from '../utils/git.js';
import { cleanupTempDir } from '../utils/tempFixture.js';
import { createWorkspaceRepo } from '../utils/workspace.js';

let tempDir: string;

describe('the version record', () => {
  afterEach(() => {
    cleanupTempDir(tempDir);
  });

  it('should be updated by a run without --json', () => {
    tempDir = createWorkspaceRepo('rk-version-record-', {
      packages: { 'pkg-a': 'pkg-a', 'pkg-b': 'pkg-b' },
      config: { versionPrefix: 'v', sync: false, packageSpecificTags: true },
      tags: ['pkg-a@v0.1.0', 'pkg-b@v0.1.0'],
    });
    const migratedAt = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: tempDir, encoding: 'utf-8' }).trim();
    const migrated = {
      'packages/pkg-a': { name: 'pkg-a', version: '0.1.0', at: migratedAt },
      'packages/pkg-b': { name: 'pkg-b', version: '0.1.0', at: migratedAt },
    };
    writeFileSync(join(tempDir, 'releasekit.versions.json'), JSON.stringify(migrated));
    writeFileSync(join(tempDir, 'packages', 'pkg-a', 'index.js'), '// changed\n');
    createConventionalCommit(tempDir, 'feat', 'add a feature', undefined, false, [
      'packages/pkg-a',
      'releasekit.versions.json',
    ]);
    const at = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: tempDir, encoding: 'utf-8' }).trim();

    const result = executeCliCommand('--config releasekit.config.json', tempDir, false);

    expect(result.status).toBe(0);
    expect(JSON.parse(readFileSync(join(tempDir, 'releasekit.versions.json'), 'utf-8'))).toEqual({
      ...migrated,
      'packages/pkg-a': { name: 'pkg-a', version: '0.2.0', at },
    });
  });
});
