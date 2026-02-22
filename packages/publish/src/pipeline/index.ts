import type { VersionOutput } from '@releasekit/core';
import { BasePublishError, PipelineError } from '../errors/index.js';
import { runCargoPublishStage } from '../stages/cargo-publish.js';
import { runGitCommitStage } from '../stages/git-commit.js';
import { runGitPushStage } from '../stages/git-push.js';
import { runGithubReleaseStage } from '../stages/github-release.js';
import { runNpmPublishStage } from '../stages/npm-publish.js';
import { runPrepareStage } from '../stages/prepare.js';
import { runVerifyStage } from '../stages/verify.js';
import type { PipelineContext, PublishCliOptions, PublishConfig, PublishOutput } from '../types.js';
import { detectPackageManager } from '../utils/package-manager.js';

function inferStageName(error: unknown): string {
  if (error instanceof BasePublishError) {
    const codeToStage: Record<string, string> = {
      FILE_COPY_ERROR: 'prepare',
      CARGO_TOML_ERROR: 'prepare',
      GIT_COMMIT_ERROR: 'git-commit',
      GIT_TAG_ERROR: 'git-commit',
      NPM_PUBLISH_ERROR: 'npm-publish',
      NPM_AUTH_ERROR: 'npm-publish',
      CARGO_PUBLISH_ERROR: 'cargo-publish',
      CARGO_AUTH_ERROR: 'cargo-publish',
      VERIFICATION_FAILED: 'verify',
      GIT_PUSH_ERROR: 'git-push',
      GITHUB_RELEASE_ERROR: 'github-release',
    };
    return codeToStage[error.code] ?? 'unknown';
  }
  return 'unknown';
}

export async function runPipeline(
  input: VersionOutput,
  config: PublishConfig,
  options: PublishCliOptions,
): Promise<PublishOutput> {
  const cwd = process.cwd();
  const ctx: PipelineContext = {
    input,
    config,
    cliOptions: options,
    packageManager: detectPackageManager(cwd),
    cwd,
    output: {
      dryRun: options.dryRun,
      git: { committed: false, tags: [], pushed: false },
      npm: [],
      cargo: [],
      verification: [],
      githubReleases: [],
    },
  };

  try {
    // Stage 2: Prepare (copy files, update Cargo.toml)
    await runPrepareStage(ctx);

    // Stage 3: Git commit + tag
    if (!options.skipGit) {
      await runGitCommitStage(ctx);
    }

    // Stage 4+5: Registry publishing
    if (!options.skipPublish) {
      if (options.registry === 'all' || options.registry === 'npm') {
        await runNpmPublishStage(ctx);
      }
      if (options.registry === 'all' || options.registry === 'cargo') {
        await runCargoPublishStage(ctx);
      }
    }

    // Stage 6: Verification
    if (!options.skipVerification && !options.skipPublish) {
      await runVerifyStage(ctx);
    }

    // Stage 7: Git push (after publish to avoid tagging unpublished versions)
    if (!options.skipGit) {
      await runGitPushStage(ctx);
    }

    // Stage 8: GitHub release
    if (!options.skipGithubRelease) {
      await runGithubReleaseStage(ctx);
    }
  } catch (error) {
    const stageName = inferStageName(error);
    const message = error instanceof Error ? error.message : String(error);
    throw new PipelineError(message, stageName, ctx.output, error instanceof Error ? error : undefined);
  }

  return ctx.output;
}
