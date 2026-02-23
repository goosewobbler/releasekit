import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  cleanupRepo,
  createGitRepo,
  createPackageJson,
  createVersionConfig,
  gitCommit,
  runCLI,
} from './utils/e2e-helpers.js';

describe('E2E: Single package', () => {
  let repoDir: string;

  beforeEach(async () => {
    repoDir = await createGitRepo();
    await createPackageJson(repoDir, 'test-single-package', '0.1.0');
    await createVersionConfig(repoDir, {
      preset: 'angular',
      packages: ['./'],
    });

    await gitCommit(repoDir, 'chore: initial commit');
  });

  afterEach(async () => {
    await cleanupRepo(repoDir);
  });

  it('handles fix commits with patch version bump', async () => {
    await gitCommit(repoDir, 'fix: resolve bug');

    const version = await runCLI('releasekit-version', ['--dry-run'], repoDir);
    expect(version.exitCode).toBe(0);
    expect(version.stderr).toBe('');

    const versionOutput = JSON.parse(version.stdout);
    expect(versionOutput.updates[0].newVersion).toBe('0.1.1');
  });
});
