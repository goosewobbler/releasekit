import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { executeCliCommand, readVersionOutput } from '../utils/cli.js';
import { createConventionalCommit, initGitRepo } from '../utils/git.js';
import { cleanupTempDir, symlinkNodeModules } from '../utils/tempFixture.js';

let tempDir: string;

function writePackageJson(dir: string, manifest: Record<string, unknown>) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify(manifest, null, 2));
}

function writeVersionConfig(dir: string, versionConfig: Record<string, unknown>) {
  writeFileSync(
    join(dir, 'releasekit.config.json'),
    JSON.stringify(
      {
        version: {
          preset: 'angular',
          sync: true,
          versionPrefix: 'v',
          packageSpecificTags: true,
          tagTemplate: '${packageName}-v${version}',
          ...versionConfig,
        },
      },
      null,
      2,
    ),
  );
}

describe('private packages in version.packages', () => {
  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'rk-private-'));
    writePackageJson(tempDir, { name: 'test-monorepo', version: '0.1.0', private: true });
    writeFileSync(join(tempDir, 'pnpm-workspace.yaml'), 'packages:\n  - "packages/*"\n');
    writePackageJson(join(tempDir, 'packages/pkg-a'), { name: '@test/pkg-a', version: '0.1.0', private: true });
    writePackageJson(join(tempDir, 'packages/pkg-b'), { name: '@test/pkg-b', version: '0.1.0', private: true });
    symlinkNodeModules(tempDir);
    initGitRepo(tempDir);
  });

  afterEach(() => {
    cleanupTempDir(tempDir);
  });

  it('should version private packages listed by exact directory path', () => {
    writeVersionConfig(tempDir, { packages: ['packages/pkg-a', './packages/pkg-b/'] });
    createConventionalCommit(tempDir, 'feat', 'add new feature');

    const result = executeCliCommand('--json', tempDir);

    expect(result.status).toBe(0);
    const output = readVersionOutput(result.stdout);
    expect(output.updates.map((u) => u.packageName).sort()).toEqual(['@test/pkg-a', '@test/pkg-b', 'test-monorepo']);
    expect(output.tags).toEqual(['test-pkg-a-v0.2.0', 'test-pkg-b-v0.2.0']);
  });

  it('should name private packages matched only by a glob and fail instead of bumping the root alone', () => {
    writeVersionConfig(tempDir, { packages: ['packages/*'] });
    createConventionalCommit(tempDir, 'feat', 'add new feature');

    const result = executeCliCommand('--json', tempDir);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Skipping private packages matched by version.packages: @test/pkg-a, @test/pkg-b.');
    expect(result.stderr).not.toContain('No packages matched');
    expect(JSON.parse(result.stdout).errors).toMatchObject([{ message: 'No packages found in workspace' }]);
  });
});
