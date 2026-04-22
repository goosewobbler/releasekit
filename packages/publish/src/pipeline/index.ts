import type { VersionOutput } from '@releasekit/core';
import { BasePublishError, PipelineError } from '../errors/index.js';
import { runCargoPublishStage } from '../stages/cargo-publish.js';
import { runGitCommitStage } from '../stages/git-commit.js';
import { preparePushSetup, pushPackageTag, runGitPushStage } from '../stages/git-push.js';
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
    releaseNotes: options.releaseNotes,
    additionalFiles: options.additionalFiles,
    output: {
      dryRun: options.dryRun,
      git: { committed: false, tags: [], pushed: false },
      npm: [],
      cargo: [],
      verification: [],
      githubReleases: [],
      publishSucceeded: false,
    },
  };

  // Per-package mode: when every package has its own tag (async or sync+packageSpecificTags),
  // push each tag immediately after that package publishes rather than all at the end.
  // In sync mode with a single shared tag no update carries a tag, so batch mode is used.
  const perPackageMode = input.updates.some((u) => !!u.tag);

  try {
    // Stage 2: Prepare (copy files, update Cargo.toml)
    await runPrepareStage(ctx);

    // Stage 3: Git commit + tag
    // When skipGitCommit is set, the caller already created the commit and tags.
    // Pre-populate the output so push and github-release stages work.
    if (options.skipGitCommit && !options.skipGit) {
      ctx.output.git.committed = !!input.commitMessage;
      ctx.output.git.tags = [...input.tags];
    } else if (!options.skipGit) {
      await runGitCommitStage(ctx);
    }

    // Stage 4+5: Registry publishing
    if (!options.skipPublish) {
      if (!perPackageMode) {
        // Batch mode: publish all, verify all, push all at the end (existing behavior).
        if (options.registry === 'all' || options.registry === 'npm') {
          await runNpmPublishStage(ctx);
        }
        if (options.registry === 'all' || options.registry === 'cargo') {
          await runCargoPublishStage(ctx);
        }
      } else {
        // Per-package mode: for each update, publish → verify → push its tag.
        // Uses a single-update context so existing stage logic is fully reused.
        // Prepare push setup once to avoid redundant method detection and branch resolution per package.
        const pushSetup = !options.skipGit ? await preparePushSetup(ctx) : null;

        for (const update of input.updates) {
          const singleCtx: PipelineContext = {
            ...ctx,
            input: { ...ctx.input, updates: [update] },
            output: {
              dryRun: ctx.output.dryRun,
              git: ctx.output.git, // shared so pushPackageTag accumulates into ctx.output.git
              npm: [],
              cargo: [],
              verification: [],
              githubReleases: [],
              publishSucceeded: false,
            },
          };

          if (options.registry === 'all' || options.registry === 'npm') {
            await runNpmPublishStage(singleCtx);
            ctx.output.npm.push(...singleCtx.output.npm);
          }
          if (options.registry === 'all' || options.registry === 'cargo') {
            await runCargoPublishStage(singleCtx);
            ctx.output.cargo.push(...singleCtx.output.cargo);
          }

          if (!options.skipVerification) {
            await runVerifyStage(singleCtx);
            ctx.output.verification.push(...singleCtx.output.verification);
          }

          // Compute publish success for this package before pushing its tag
          singleCtx.output.publishSucceeded =
            singleCtx.output.npm.every((r) => r.success) && singleCtx.output.cargo.every((r) => r.success);

          // Push tag after publish/verify (or if skipping publish, still push because commit is ready).
          // Gate on same condition as batch mode: push if we're skipping publish OR publish succeeded.
          if (!options.skipGit && update.tag && (options.skipPublish || singleCtx.output.publishSucceeded)) {
            await pushPackageTag(update.tag, ctx, pushSetup || undefined);
          }
        }
      }

      // Stages throw on first failure (fail-fast), so reaching here means all packages succeeded.
      // Only relevant for batch mode; per-package mode sets publishSucceeded per-loop but doesn't accumulate.
      if (!perPackageMode) {
        ctx.output.publishSucceeded =
          ctx.output.npm.every((r) => r.success) && ctx.output.cargo.every((r) => r.success);
      }
    }

    // Stage 6: Verification (batch mode only — per-package mode verified inline above)
    if (!options.skipVerification && !options.skipPublish && !perPackageMode) {
      await runVerifyStage(ctx);
    }

    // Stage 7: Git push (batch mode only — per-package mode pushed inline above)
    if (!options.skipGit && !perPackageMode && (options.skipPublish || ctx.output.publishSucceeded)) {
      await runGitPushStage(ctx);
    }

    // Stage 8: GitHub release — only if the push stage confirmed the tag landed on GitHub.
    if (!options.skipGithubRelease && ctx.output.git.pushed) {
      await runGithubReleaseStage(ctx);
    }
  } catch (error) {
    const stageName = inferStageName(error);
    const message = error instanceof Error ? error.message : String(error);
    throw new PipelineError(message, stageName, ctx.output, error instanceof Error ? error : undefined);
  }

  return ctx.output;
}
