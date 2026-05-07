import type { VersionOutput } from '@releasekit/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDefaultConfig } from '../../src/config.js';
import { PipelineError } from '../../src/errors/index.js';
import { runPipeline } from '../../src/pipeline/index.js';
import type { PublishCliOptions } from '../../src/types.js';

vi.mock('../../src/stages/prepare.js', () => ({
  runPrepareStage: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../src/stages/git-commit.js', () => ({
  runGitCommitStage: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../src/stages/npm-publish.js', () => ({
  runNpmPublishStage: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../src/stages/cargo-publish.js', () => ({
  runCargoPublishStage: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../src/stages/verify.js', () => ({
  runVerifyStage: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../src/stages/git-push.js', () => ({
  runGitPushStage: vi.fn().mockResolvedValue(undefined),
  pushPackageTag: vi.fn().mockResolvedValue(undefined),
  preparePushSetup: vi.fn().mockResolvedValue({
    pushRemote: 'origin',
    remote: 'origin',
    branch: 'main',
    dryRun: false,
  }),
}));
vi.mock('../../src/stages/github-release.js', () => ({
  runGithubReleaseStage: vi.fn().mockResolvedValue(undefined),
}));

const defaultOptions: PublishCliOptions = {
  registry: 'all',
  npmAuth: 'auto',
  dryRun: false,
  skipGit: false,
  skipPublish: false,
  skipGithubRelease: false,
  skipVerification: false,

  json: false,
  verbose: false,
};

const minimalInput: VersionOutput = {
  dryRun: false,
  updates: [],
  changelogs: [],
  tags: [],
};

describe('pipeline', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('should run all stages in order', async () => {
    const callOrder: string[] = [];

    const { runPrepareStage } = await import('../../src/stages/prepare.js');
    const { runGitCommitStage } = await import('../../src/stages/git-commit.js');
    const { runNpmPublishStage } = await import('../../src/stages/npm-publish.js');
    const { runCargoPublishStage } = await import('../../src/stages/cargo-publish.js');
    const { runVerifyStage } = await import('../../src/stages/verify.js');
    const { runGitPushStage } = await import('../../src/stages/git-push.js');
    const { runGithubReleaseStage } = await import('../../src/stages/github-release.js');

    vi.mocked(runPrepareStage).mockImplementation(async () => {
      callOrder.push('prepare');
    });
    vi.mocked(runGitCommitStage).mockImplementation(async () => {
      callOrder.push('git-commit');
    });
    vi.mocked(runNpmPublishStage).mockImplementation(async () => {
      callOrder.push('npm-publish');
    });
    vi.mocked(runCargoPublishStage).mockImplementation(async () => {
      callOrder.push('cargo-publish');
    });
    vi.mocked(runVerifyStage).mockImplementation(async () => {
      callOrder.push('verify');
    });
    vi.mocked(runGitPushStage).mockImplementation(async (ctx) => {
      callOrder.push('git-push');
      ctx.output.git.pushed = true;
    });
    vi.mocked(runGithubReleaseStage).mockImplementation(async () => {
      callOrder.push('github-release');
    });

    await runPipeline(minimalInput, getDefaultConfig(), defaultOptions);

    expect(callOrder).toEqual([
      'prepare',
      'git-commit',
      'npm-publish',
      'cargo-publish',
      'verify',
      'git-push',
      'github-release',
    ]);
  });

  it('should skip git stages and github release when --skip-git', async () => {
    const { runGitCommitStage } = await import('../../src/stages/git-commit.js');
    const { runGitPushStage } = await import('../../src/stages/git-push.js');
    const { runGithubReleaseStage } = await import('../../src/stages/github-release.js');

    await runPipeline(minimalInput, getDefaultConfig(), { ...defaultOptions, skipGit: true });

    expect(runGitCommitStage).not.toHaveBeenCalled();
    expect(runGitPushStage).not.toHaveBeenCalled();
    expect(runGithubReleaseStage).not.toHaveBeenCalled();
  });

  it('should skip github release when config.git.push is false', async () => {
    const { runGitPushStage } = await import('../../src/stages/git-push.js');
    const { runGithubReleaseStage } = await import('../../src/stages/github-release.js');

    const config = getDefaultConfig();
    config.git.push = false;

    await runPipeline(minimalInput, config, defaultOptions);

    expect(runGitPushStage).toHaveBeenCalled();
    expect(runGithubReleaseStage).not.toHaveBeenCalled();
  });

  it('should skip publish stages when --skip-publish', async () => {
    const { runNpmPublishStage } = await import('../../src/stages/npm-publish.js');
    const { runCargoPublishStage } = await import('../../src/stages/cargo-publish.js');
    const { runVerifyStage } = await import('../../src/stages/verify.js');

    await runPipeline(minimalInput, getDefaultConfig(), { ...defaultOptions, skipPublish: true });

    expect(runNpmPublishStage).not.toHaveBeenCalled();
    expect(runCargoPublishStage).not.toHaveBeenCalled();
    expect(runVerifyStage).not.toHaveBeenCalled();
  });

  it('should skip git-commit stage but pre-populate output when skipGitCommit is set', async () => {
    const { runGitCommitStage } = await import('../../src/stages/git-commit.js');
    const { runGitPushStage } = await import('../../src/stages/git-push.js');

    const inputWithCommit: VersionOutput = {
      dryRun: false,
      updates: [],
      changelogs: [],
      commitMessage: 'chore: release v1.0.0',
      tags: ['v1.0.0', 'pkg-a@v1.0.0'],
    };

    const result = await runPipeline(inputWithCommit, getDefaultConfig(), {
      ...defaultOptions,
      skipGitCommit: true,
    });

    expect(runGitCommitStage).not.toHaveBeenCalled();
    expect(runGitPushStage).toHaveBeenCalled();
    expect(result.git.committed).toBe(true);
    expect(result.git.tags).toEqual(['v1.0.0', 'pkg-a@v1.0.0']);
  });

  it('should merge baselineTags into pre-populated git.tags when skipGitCommit is set', async () => {
    // Both consumer tags and baseline tags need to be pushed, but only consumer tags get a
    // GitHub Release (the github-release stage reads input.tags directly).
    const inputWithBaseline: VersionOutput = {
      dryRun: false,
      updates: [],
      changelogs: [],
      commitMessage: 'chore: release v1.0.0',
      tags: ['v1.0.0'],
      baselineTags: ['release/v1.0.0'],
    };

    const result = await runPipeline(inputWithBaseline, getDefaultConfig(), {
      ...defaultOptions,
      skipGitCommit: true,
    });

    expect(result.git.tags).toEqual(['v1.0.0', 'release/v1.0.0']);
  });

  it('should skip github release when --skip-github-release', async () => {
    const { runGithubReleaseStage } = await import('../../src/stages/github-release.js');

    await runPipeline(minimalInput, getDefaultConfig(), { ...defaultOptions, skipGithubRelease: true });

    expect(runGithubReleaseStage).not.toHaveBeenCalled();
  });

  it('should skip verification when --skip-verification', async () => {
    const { runVerifyStage } = await import('../../src/stages/verify.js');

    await runPipeline(minimalInput, getDefaultConfig(), { ...defaultOptions, skipVerification: true });

    expect(runVerifyStage).not.toHaveBeenCalled();
  });

  it('should only publish npm when registry=npm', async () => {
    const { runNpmPublishStage } = await import('../../src/stages/npm-publish.js');
    const { runCargoPublishStage } = await import('../../src/stages/cargo-publish.js');

    await runPipeline(minimalInput, getDefaultConfig(), { ...defaultOptions, registry: 'npm' });

    expect(runNpmPublishStage).toHaveBeenCalled();
    expect(runCargoPublishStage).not.toHaveBeenCalled();
  });

  it('should only publish cargo when registry=cargo', async () => {
    const { runNpmPublishStage } = await import('../../src/stages/npm-publish.js');
    const { runCargoPublishStage } = await import('../../src/stages/cargo-publish.js');

    await runPipeline(minimalInput, getDefaultConfig(), { ...defaultOptions, registry: 'cargo' });

    expect(runNpmPublishStage).not.toHaveBeenCalled();
    expect(runCargoPublishStage).toHaveBeenCalled();
  });

  it('should return PublishOutput', async () => {
    const result = await runPipeline(minimalInput, getDefaultConfig(), defaultOptions);

    expect(result).toMatchObject({
      dryRun: false,
      git: { committed: false, tags: [], pushed: false },
      npm: [],
      cargo: [],
      verification: [],
      githubReleases: [],
      publishSucceeded: true,
    });
  });

  it('should produce PipelineError with partial output when a stage fails', async () => {
    const { runNpmPublishStage } = await import('../../src/stages/npm-publish.js');
    const { runGitCommitStage } = await import('../../src/stages/git-commit.js');

    vi.mocked(runGitCommitStage).mockImplementation(async (ctx) => {
      ctx.output.git.committed = true;
      ctx.output.git.tags = ['v1.0.0'];
    });
    vi.mocked(runNpmPublishStage).mockRejectedValue(new Error('npm registry unavailable'));

    await expect(runPipeline(minimalInput, getDefaultConfig(), defaultOptions)).rejects.toSatisfy((err: unknown) => {
      expect(err).toBeInstanceOf(PipelineError);
      const pipelineErr = err as PipelineError;
      expect(pipelineErr.partialOutput.git.committed).toBe(true);
      expect(pipelineErr.partialOutput.git.tags).toEqual(['v1.0.0']);
      return true;
    });
  });

  it('should include git results in partial output when publish stage fails', async () => {
    const { runGitCommitStage } = await import('../../src/stages/git-commit.js');
    const { runCargoPublishStage } = await import('../../src/stages/cargo-publish.js');
    const { runNpmPublishStage } = await import('../../src/stages/npm-publish.js');

    vi.mocked(runGitCommitStage).mockImplementation(async (ctx) => {
      ctx.output.git.committed = true;
      ctx.output.git.tags = ['pkg-a@v1.0.0'];
    });
    vi.mocked(runNpmPublishStage).mockImplementation(async (ctx) => {
      ctx.output.npm.push({
        packageName: 'pkg-a',
        version: '1.0.0',
        registry: 'npm',
        success: true,
        skipped: false,
      });
    });
    vi.mocked(runCargoPublishStage).mockRejectedValue(new Error('cargo publish failed'));

    await expect(runPipeline(minimalInput, getDefaultConfig(), defaultOptions)).rejects.toSatisfy((err: unknown) => {
      const pipelineErr = err as PipelineError;
      expect(pipelineErr.partialOutput.git.committed).toBe(true);
      expect(pipelineErr.partialOutput.npm).toHaveLength(1);
      expect(pipelineErr.partialOutput.npm[0]?.success).toBe(true);
      return true;
    });
  });

  it('should set publishSucceeded to true when publishing succeeds', async () => {
    const options = { ...defaultOptions, registry: 'npm' as const };
    const result = await runPipeline(minimalInput, getDefaultConfig(), options);
    expect(result.publishSucceeded).toBe(true);
  });

  it('should set publishSucceeded to false when publishing is skipped', async () => {
    const options = { ...defaultOptions, skipPublish: true };
    const result = await runPipeline(minimalInput, getDefaultConfig(), options);
    expect(result.publishSucceeded).toBe(false);
  });

  it('should not run git push when publish fails', async () => {
    const { runGitCommitStage } = await import('../../src/stages/git-commit.js');
    const { runGitPushStage } = await import('../../src/stages/git-push.js');
    const { runNpmPublishStage } = await import('../../src/stages/npm-publish.js');

    vi.mocked(runGitCommitStage).mockImplementation(async (ctx) => {
      ctx.output.git.committed = true;
      ctx.output.git.tags = ['v1.0.0'];
    });
    vi.mocked(runNpmPublishStage).mockRejectedValue(new Error('npm publish failed'));
    vi.mocked(runGitPushStage).mockResolvedValue(undefined);

    await expect(runPipeline(minimalInput, getDefaultConfig(), defaultOptions)).rejects.toThrow();

    expect(runGitPushStage).not.toHaveBeenCalled();
  });

  describe('per-package mode (updates with tag field)', () => {
    const perPackageInput: VersionOutput = {
      dryRun: false,
      updates: [
        { packageName: 'pkg-a', newVersion: '1.1.0', filePath: 'packages/a/package.json', tag: 'pkg-a@v1.1.0' },
        { packageName: 'pkg-b', newVersion: '2.0.0', filePath: 'packages/b/package.json', tag: 'pkg-b@v2.0.0' },
      ],
      changelogs: [],
      tags: ['pkg-a@v1.1.0', 'pkg-b@v2.0.0'],
    };

    it('should call pushPackageTag once per update instead of runGitPushStage', async () => {
      const { runGitPushStage, pushPackageTag } = await import('../../src/stages/git-push.js');
      const { runNpmPublishStage } = await import('../../src/stages/npm-publish.js');

      vi.mocked(runNpmPublishStage).mockImplementation(async (ctx) => {
        for (const update of ctx.input.updates) {
          ctx.output.npm.push({
            packageName: update.packageName,
            version: update.newVersion,
            registry: 'npm',
            success: true,
            skipped: false,
          });
        }
      });

      await runPipeline(perPackageInput, getDefaultConfig(), defaultOptions);

      expect(pushPackageTag).toHaveBeenCalledTimes(2);
      const calls = vi.mocked(pushPackageTag).mock.calls;
      expect(calls[0]?.[0]).toBe('pkg-a@v1.1.0');
      expect(calls[1]?.[0]).toBe('pkg-b@v2.0.0');
      expect(runGitPushStage).not.toHaveBeenCalled();
    });

    it('should call npm-publish once per update with only that update in ctx.input', async () => {
      const { runNpmPublishStage } = await import('../../src/stages/npm-publish.js');

      const seenUpdates: string[][] = [];
      vi.mocked(runNpmPublishStage).mockImplementation(async (ctx) => {
        seenUpdates.push(ctx.input.updates.map((u) => u.packageName));
        for (const update of ctx.input.updates) {
          ctx.output.npm.push({
            packageName: update.packageName,
            version: update.newVersion,
            registry: 'npm',
            success: true,
            skipped: false,
          });
        }
      });

      await runPipeline(perPackageInput, getDefaultConfig(), defaultOptions);

      expect(seenUpdates).toEqual([['pkg-a'], ['pkg-b']]);
    });

    it('should not call pushPackageTag for updates without a tag', async () => {
      const { pushPackageTag } = await import('../../src/stages/git-push.js');
      const { runNpmPublishStage } = await import('../../src/stages/npm-publish.js');

      const mixedInput: VersionOutput = {
        ...perPackageInput,
        updates: [
          { packageName: 'root', newVersion: '1.1.0', filePath: 'package.json' }, // no tag (root pkg in sync+pkgSpecificTags)
          { packageName: 'pkg-a', newVersion: '1.1.0', filePath: 'packages/a/package.json', tag: 'pkg-a@v1.1.0' },
        ],
      };

      vi.mocked(runNpmPublishStage).mockImplementation(async (ctx) => {
        for (const update of ctx.input.updates) {
          ctx.output.npm.push({
            packageName: update.packageName,
            version: update.newVersion,
            registry: 'npm',
            success: true,
            skipped: false,
          });
        }
      });

      await runPipeline(mixedInput, getDefaultConfig(), defaultOptions);

      expect(pushPackageTag).toHaveBeenCalledTimes(1);
      const callsA = vi.mocked(pushPackageTag).mock.calls;
      expect(callsA[0]?.[0]).toBe('pkg-a@v1.1.0');
    });

    it('should stop at the failing package and leave subsequent tags unpushed', async () => {
      const { pushPackageTag } = await import('../../src/stages/git-push.js');
      const { runNpmPublishStage } = await import('../../src/stages/npm-publish.js');

      let callCount = 0;
      vi.mocked(runNpmPublishStage).mockImplementation(async (ctx) => {
        callCount++;
        if (callCount === 2) {
          throw new Error('pkg-b publish failed');
        }
        for (const update of ctx.input.updates) {
          ctx.output.npm.push({
            packageName: update.packageName,
            version: update.newVersion,
            registry: 'npm',
            success: true,
            skipped: false,
          });
        }
      });

      await expect(runPipeline(perPackageInput, getDefaultConfig(), defaultOptions)).rejects.toThrow();

      // Only pkg-a's tag should have been pushed
      expect(pushPackageTag).toHaveBeenCalledTimes(1);
      const callsB = vi.mocked(pushPackageTag).mock.calls;
      expect(callsB[0]?.[0]).toBe('pkg-a@v1.1.0');
    });

    it('should use batch mode when no updates have a tag (sync mode with shared tag)', async () => {
      const { runGitPushStage, pushPackageTag } = await import('../../src/stages/git-push.js');
      const { runNpmPublishStage } = await import('../../src/stages/npm-publish.js');

      vi.mocked(runGitPushStage).mockImplementation(async (ctx) => {
        ctx.output.git.pushed = true;
      });
      vi.mocked(runNpmPublishStage).mockImplementation(async (ctx) => {
        for (const update of ctx.input.updates) {
          ctx.output.npm.push({
            packageName: update.packageName,
            version: update.newVersion,
            registry: 'npm',
            success: true,
            skipped: false,
          });
        }
      });

      const syncInput: VersionOutput = {
        dryRun: false,
        updates: [
          { packageName: 'pkg-a', newVersion: '1.1.0', filePath: 'packages/a/package.json' },
          { packageName: 'pkg-b', newVersion: '1.1.0', filePath: 'packages/b/package.json' },
        ],
        changelogs: [],
        tags: ['v1.1.0'],
      };

      await runPipeline(syncInput, getDefaultConfig(), defaultOptions);

      expect(pushPackageTag).not.toHaveBeenCalled();
      expect(runGitPushStage).toHaveBeenCalledTimes(1);
    });
  });
});
