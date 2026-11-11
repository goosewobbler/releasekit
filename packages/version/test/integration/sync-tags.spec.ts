/**
 * Runs the built CLI against a real temp git repo, catching tag-output regressions that unit tests (which
 * mock addTag) can't. Requires `pnpm build` in @releasekit/version first.
 */
import type { VersionOutput } from '@releasekit/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runVersionJson } from '../utils/cli.js';
import { createConventionalCommit } from '../utils/git.js';
import { cleanupTempDir } from '../utils/tempFixture.js';
import { createWorkspaceRepo, writeVersionConfig } from '../utils/workspace.js';

let tempDir: string;

const SYNCED_RELEASE = { monorepo: '0.2.0', '@test/pkg-a': '0.2.0', '@test/pkg-b': '0.2.0' };

function releasedVersions(output: VersionOutput) {
  return Object.fromEntries(output.updates.map((u) => [u.packageName, u.newVersion]));
}

describe('sync strategy — JSON tag output', () => {
  beforeEach(() => {
    tempDir = createWorkspaceRepo('rk-sync-', { packages: { 'pkg-a': '@test/pkg-a', 'pkg-b': '@test/pkg-b' } });
  });

  afterEach(() => {
    cleanupTempDir(tempDir);
  });

  it('should produce per-package tags when packageSpecificTags is true', () => {
    writeVersionConfig(tempDir, {
      preset: 'angular',
      packages: ['packages/pkg-a', 'packages/pkg-b'],
      sync: true,
      versionPrefix: 'v',
      packageSpecificTags: true,
      tagTemplate: '${packageName}-v${version}',
    });

    createConventionalCommit(tempDir, 'feat', 'add new feature');

    const output = runVersionJson(tempDir);

    expect(releasedVersions(output)).toEqual(SYNCED_RELEASE);
    // @test/pkg-a is sanitized to test-pkg-a (@ stripped, / replaced with -)
    expect(output.tags).toEqual(['test-pkg-a-v0.2.0', 'test-pkg-b-v0.2.0']);
  });

  it('should produce a single root tag when packageSpecificTags is false', () => {
    writeVersionConfig(tempDir, {
      preset: 'angular',
      packages: ['packages/pkg-a', 'packages/pkg-b'],
      sync: true,
      versionPrefix: 'v',
      packageSpecificTags: false,
    });

    createConventionalCommit(tempDir, 'feat', 'add new feature');

    const output = runVersionJson(tempDir);

    expect(releasedVersions(output)).toEqual(SYNCED_RELEASE);
    expect(output.tags).toEqual(['v0.2.0']);
  });
});
