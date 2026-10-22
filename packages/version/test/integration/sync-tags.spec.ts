/**
 * Integration test: sync strategy JSON output
 *
 * Runs the actual CLI binary against a real temp git repository and asserts
 * that the JSON output contains the expected per-package tags when
 * packageSpecificTags is enabled. This catches regressions that unit tests
 * (which mock addTag) cannot detect.
 *
 * Requires: `pnpm build` in @releasekit/version before running.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { VersionOutput } from '@releasekit/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { executeCliCommand } from '../utils/cli.js';
import { createConventionalCommit, initGitRepo } from '../utils/git.js';
import { createPackageJson } from '../utils/package.js';
import { cleanupTempDir, symlinkNodeModules } from '../utils/tempFixture.js';

let tempDir: string;

function writeReleaseKitConfig(dir: string, versionConfig: Record<string, unknown>) {
  // The CLI reads releasekit.config.json
  writeFileSync(join(dir, 'releasekit.config.json'), JSON.stringify({ version: versionConfig }, null, 2));
}

function createMonorepoFixture(dir: string) {
  // Root package.json (no workspaces field — @manypkg discovers packages via pnpm-workspace.yaml)
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ name: 'test-monorepo', version: '0.1.0', private: true }, null, 2),
  );
  // pnpm-workspace.yaml is detected by @manypkg without requiring node_modules installation
  writeFileSync(join(dir, 'pnpm-workspace.yaml'), 'packages:\n  - "packages/*"\n');
  mkdirSync(join(dir, 'packages/pkg-a'), { recursive: true });
  mkdirSync(join(dir, 'packages/pkg-b'), { recursive: true });
  createPackageJson(join(dir, 'packages/pkg-a'), '@test/pkg-a');
  createPackageJson(join(dir, 'packages/pkg-b'), '@test/pkg-b');
}

const SYNCED_RELEASE = { 'test-monorepo': '0.2.0', '@test/pkg-a': '0.2.0', '@test/pkg-b': '0.2.0' };

function releasedVersions(output: VersionOutput) {
  return Object.fromEntries(output.updates.map((u) => [u.packageName, u.newVersion]));
}

describe('sync strategy — JSON tag output', () => {
  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'rk-sync-'));
    createMonorepoFixture(tempDir);
    symlinkNodeModules(tempDir);
    initGitRepo(tempDir);
  });

  afterEach(() => {
    cleanupTempDir(tempDir);
  });

  it('should produce per-package tags when packageSpecificTags is true', () => {
    writeReleaseKitConfig(tempDir, {
      preset: 'angular',
      packages: ['packages/pkg-a', 'packages/pkg-b'],
      sync: true,
      versionPrefix: 'v',
      packageSpecificTags: true,
      tagTemplate: '${packageName}-v${version}',
    });

    createConventionalCommit(tempDir, 'feat', 'add new feature');

    const result = executeCliCommand('--json', tempDir);

    expect(result.status).toBe(0);
    const output: VersionOutput = JSON.parse(result.stdout);

    expect(releasedVersions(output)).toEqual(SYNCED_RELEASE);
    // @test/pkg-a is sanitized to test-pkg-a (@ stripped, / replaced with -)
    expect(output.tags).toEqual(['test-pkg-a-v0.2.0', 'test-pkg-b-v0.2.0']);
  });

  it('should produce a single root tag when packageSpecificTags is false', () => {
    writeReleaseKitConfig(tempDir, {
      preset: 'angular',
      packages: ['packages/pkg-a', 'packages/pkg-b'],
      sync: true,
      versionPrefix: 'v',
      packageSpecificTags: false,
    });

    createConventionalCommit(tempDir, 'feat', 'add new feature');

    const result = executeCliCommand('--json', tempDir);

    expect(result.status).toBe(0);
    const output: VersionOutput = JSON.parse(result.stdout);

    expect(releasedVersions(output)).toEqual(SYNCED_RELEASE);
    expect(output.tags).toEqual(['v0.2.0']);
  });
});
