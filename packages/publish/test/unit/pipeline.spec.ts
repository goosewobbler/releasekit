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
    vi.clearAllMocks();
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
    vi.mocked(runGitPushStage).mockImplementation(async () => {
      callOrder.push('git-push');
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

  it('should skip git stages when --skip-git', async () => {
    const { runGitCommitStage } = await import('../../src/stages/git-commit.js');
    const { runGitPushStage } = await import('../../src/stages/git-push.js');

    await runPipeline(minimalInput, getDefaultConfig(), { ...defaultOptions, skipGit: true });

    expect(runGitCommitStage).not.toHaveBeenCalled();
    expect(runGitPushStage).not.toHaveBeenCalled();
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
      commitMessage: 'chore(release): v1.0.0',
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
});
