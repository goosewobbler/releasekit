/**
 * Runs the built CLI against a temp git repo on a stable version, so the bump goes through the real presets.
 * Requires `pnpm build` in @releasekit/version first.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runVersionJson } from '../utils/cli.js';
import { createConventionalCommit } from '../utils/git.js';
import { cleanupTempDir } from '../utils/tempFixture.js';
import { createWorkspaceRepo } from '../utils/workspace.js';

let tempDir: string;

function createRepoAt(version: string, config: Record<string, unknown> = {}) {
  tempDir = createWorkspaceRepo('rk-stable-', {
    packages: { core: '@test/core' },
    version,
    config: { preset: 'conventionalcommits', packages: ['packages/core'], sync: true, versionPrefix: 'v', ...config },
    tags: [`v${version}`],
  });
}

function commitToCore(type: string, message: string, breaking = false) {
  writeFileSync(join(tempDir, 'packages/core/index.js'), `// ${message}\n`);
  createConventionalCommit(tempDir, type, message, 'core', breaking, ['packages/core']);
}

function newVersion(args = ''): string | undefined {
  return runVersionJson(tempDir, args).updates.find((u) => u.packageName === '@test/core')?.newVersion;
}

describe('stable-line bumps', () => {
  afterEach(() => {
    cleanupTempDir(tempDir);
  });

  it.each([
    ['minor', '1.5.0'],
    ['major', '2.0.0'],
    ['patch', '1.4.3'],
  ])('should give a stable version for --bump %s on 1.4.2 (%s)', (bump, expected) => {
    createRepoAt('1.4.2');
    commitToCore('fix', 'correct a typo');

    expect(newVersion(`--bump ${bump}`)).toBe(expected);
  });

  it('should give a stable version for a feat when a prerelease identifier is configured but not requested', () => {
    createRepoAt('1.4.2', { prereleaseIdentifier: 'next' });
    commitToCore('feat', 'add a flag');

    expect(newVersion()).toBe('1.5.0');
  });

  it("should take a breaking change on 0.x to 1.0.0 with zeroMajor: 'strict'", () => {
    createRepoAt('0.42.1', { zeroMajor: 'strict' });
    commitToCore('feat', 'drop the old flag', true);

    expect(newVersion()).toBe('1.0.0');
  });
});
