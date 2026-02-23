import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  cleanupRepo,
  createGitRepo,
  createMonorepoPackage,
  createPackageJson,
  createPnpmWorkspace,
  createVersionConfig,
  gitCommit,
  runCLI,
} from './utils/e2e-helpers.js';

describe.skip('E2E: Monorepo', () => {
  let repoDir: string;

  beforeEach(async () => {
    repoDir = await createGitRepo();

    await createPackageJson(repoDir, 'test-monorepo', '1.0.0');

    await createPnpmWorkspace(repoDir, ['packages/*']);

    await createVersionConfig(repoDir, {
      preset: 'angular',
      packages: ['packages/*'],
      sync: true,
    });

    await createMonorepoPackage(repoDir, 'pkg-a', '0.1.0');
    await createMonorepoPackage(repoDir, 'pkg-b', '0.1.0');

    await gitCommit(repoDir, 'chore: initial commit');
  });

  afterEach(async () => {
    await cleanupRepo(repoDir);
  });

  it('runs full pipeline with sync versioning', async () => {
    await gitCommit(repoDir, 'feat: add feature');

    const version = await runCLI('releasekit-version', ['--dry-run'], repoDir);
    expect(version.exitCode).toBe(0);

    const versionOutput = JSON.parse(version.stdout);

    expect(versionOutput.updates[0].newVersion).toBe('0.2.0');
    expect(versionOutput.updates[1].newVersion).toBe('0.2.0');
  });
});
