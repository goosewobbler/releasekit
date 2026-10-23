import * as path from 'node:path';
import { buildDependencyGraph, type VersionOutput, type VersionPackageUpdate } from '@releasekit/core';
import { BasePublishError, PipelineError } from '../errors/index.js';
import { cargoRegistry, cratePathDeps } from '../registry/cargo.js';
import { npmRegistry, readNpmWorkspaceDeps } from '../registry/npm.js';
import { pubRegistry } from '../registry/pub.js';
import type { RegistryId, RegistryTarget } from '../registry/types.js';
import { runCargoPublishStage } from '../stages/cargo-publish.js';
import { runGitCommitStage } from '../stages/git-commit.js';
import { preparePushSetup, pushPackageTag, runGitPushStage } from '../stages/git-push.js';
import { runGithubReleaseStage } from '../stages/github-release.js';
import { runNpmPublishStage } from '../stages/npm-publish.js';
import { runPrepareStage } from '../stages/prepare.js';
import { runPubPublishStage } from '../stages/pub-publish.js';
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
      PUB_PUBLISH_ERROR: 'pub-publish',
      PUB_AUTH_ERROR: 'pub-publish',
      PUBSPEC_YAML_ERROR: 'prepare',
      VERIFICATION_FAILED: 'verify',
      GIT_PUSH_ERROR: 'git-push',
      GITHUB_RELEASE_ERROR: 'github-release',
    };
    return codeToStage[error.code] ?? 'unknown';
  }
  return 'unknown';
}

type OrderEdge = [before: string, after: string];

/** A configured `publishOrder`, as batch mode applies it: listed targets in order, then the rest. */
function configuredOrderEdges(
  targets: Pick<RegistryTarget, 'packageName' | 'updatePackageName'>[],
  explicitOrder: string[],
): OrderEdge[] {
  const listed = explicitOrder.flatMap((name) => targets.filter((t) => t.packageName === name));
  const edges: OrderEdge[] = [];
  let previous: string | undefined;
  for (const target of listed) {
    if (previous !== undefined) {
      edges.push([previous, target.updatePackageName]);
    }
    previous = target.updatePackageName;
  }
  const last = previous;
  if (last !== undefined) {
    for (const target of targets.filter((t) => !listed.includes(t))) {
      edges.push([last, target.updatePackageName]);
    }
  }
  return edges;
}

/**
 * Per-package mode hands each stage one update, so no registry can order its targets. Order the updates by every
 * selected registry's constraints at once, since a hybrid update publishes to several registries in one step. Only
 * real dependencies and configured `publishOrder`s constrain: an arbitrary order would contradict another registry's.
 */
async function orderPerPackageUpdates(ctx: PipelineContext): Promise<VersionPackageUpdate[]> {
  const { config, cliOptions, input, cwd } = ctx;
  const selected = (id: RegistryId): boolean => cliOptions.registry === 'all' || cliOptions.registry === id;
  const edges: OrderEdge[] = [];

  if (selected('npm') && npmRegistry.isEnabled(config)) {
    const npmUpdates = input.updates.filter((u) => u.filePath.endsWith('package.json'));
    if (config.npm.publishOrder.length > 0) {
      const targets = npmUpdates.map((u) => ({ packageName: u.packageName, updatePackageName: u.packageName }));
      edges.push(...configuredOrderEdges(targets, config.npm.publishOrder));
    } else {
      for (const u of npmUpdates) {
        for (const dep of readNpmWorkspaceDeps(path.resolve(cwd, u.filePath))) {
          edges.push([dep, u.packageName]);
        }
      }
    }
  }

  if (selected('cargo') && cargoRegistry.isEnabled(config)) {
    const crates = await cargoRegistry.discover(ctx);
    if (config.cargo.publishOrder.length > 0) {
      edges.push(...configuredOrderEdges(crates, config.cargo.publishOrder));
    } else {
      const updateOf = new Map(crates.map((c) => [c.packageName, c.updatePackageName]));
      for (const [crate, deps] of cratePathDeps(crates)) {
        for (const dep of deps) {
          edges.push([updateOf.get(dep) ?? dep, updateOf.get(crate) ?? crate]);
        }
      }
    }
  }

  if (selected('pub') && pubRegistry.isEnabled(config) && config.pub.publishOrder.length > 0) {
    edges.push(...configuredOrderEdges(await pubRegistry.discover(ctx), config.pub.publishOrder));
  }

  const graph = buildDependencyGraph(
    input.updates.map((u) => ({
      name: u.packageName,
      dir: path.dirname(path.resolve(cwd, u.filePath)),
      // topologicalOrder reads only deps.
      ecosystem: 'npm',
      deps: edges.filter(([, after]) => after === u.packageName).map(([before]) => before),
    })),
  );
  const rank = new Map(graph.topologicalOrder(input.updates.map((u) => u.packageName)).map((name, i) => [name, i]));
  return [...input.updates].sort((a, b) => (rank.get(a.packageName) ?? 0) - (rank.get(b.packageName) ?? 0));
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
      pub: [],
      verification: [],
      githubReleases: [],
      publishSucceeded: false,
    },
  };

  // Per-package mode (async, or sync & packageSpecificTags): push each tag right after its package publishes.
  // A single shared sync tag isn't carried on any update, so that falls to batch mode.
  const perPackageMode = input.updates.some((u) => !!u.tag);

  try {
    await runPrepareStage(ctx);

    if (options.skipGitCommit && !options.skipGit) {
      // The caller already created the commit and tags, and the standing-PR squash merge put the commit on the
      // remote. `committed` stays false so the push stage pushes only tags: a branch push is at best a no-op and at
      // worst races a concurrent push whose rejection would strand the tags & GitHub release behind it. Baseline
      // tags are pushed too; github-release filters back to consumer tags via `ctx.input.tags`.
      ctx.output.git.tags = [...input.tags, ...(input.baselineTags ?? [])];
    } else if (!options.skipGit) {
      await runGitCommitStage(ctx);
    }

    if (!options.skipPublish) {
      if (!perPackageMode) {
        // Batch mode: publish all, verify all, push all at the end.
        if (options.registry === 'all' || options.registry === 'npm') {
          await runNpmPublishStage(ctx);
        }
        if (options.registry === 'all' || options.registry === 'cargo') {
          await runCargoPublishStage(ctx);
        }
        if (options.registry === 'all' || options.registry === 'pub') {
          await runPubPublishStage(ctx);
        }
      } else if (!options.skipPublish) {
        const pushSetup = !options.skipGit ? await preparePushSetup(ctx) : null;

        for (const update of await orderPerPackageUpdates(ctx)) {
          const singleCtx: PipelineContext = {
            ...ctx,
            input: { ...ctx.input, updates: [update] },
            output: {
              dryRun: ctx.output.dryRun,
              git: ctx.output.git, // shared so pushPackageTag accumulates into ctx.output.git
              npm: [],
              cargo: [],
              pub: [],
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
          if (options.registry === 'all' || options.registry === 'pub') {
            await runPubPublishStage(singleCtx);
            ctx.output.pub.push(...singleCtx.output.pub);
          }

          if (!options.skipVerification) {
            await runVerifyStage(singleCtx);
            ctx.output.verification.push(...singleCtx.output.verification);
          }

          singleCtx.output.publishSucceeded =
            singleCtx.output.npm.every((r) => r.success) &&
            singleCtx.output.cargo.every((r) => r.success) &&
            singleCtx.output.pub.every((r) => r.success);

          // Tag only after a clean publish.
          if (!options.skipGit && update.tag && singleCtx.output.publishSucceeded) {
            await pushPackageTag(update.tag, ctx, pushSetup || undefined);
          }
        }
      }

      if (!perPackageMode) {
        ctx.output.publishSucceeded =
          ctx.output.npm.every((r) => r.success) &&
          ctx.output.cargo.every((r) => r.success) &&
          ctx.output.pub.every((r) => r.success);
      } else {
        // Stages throw on failure, so reaching here means every package published.
        ctx.output.publishSucceeded = true;
      }
    }

    // Per-package mode verified inline above.
    if (!options.skipVerification && !options.skipPublish && !perPackageMode) {
      await runVerifyStage(ctx);
    }

    // In per-package mode, pushes whatever wasn't pushed inline above.
    if (!options.skipGit && (options.skipPublish || ctx.output.publishSucceeded)) {
      await runGitPushStage(ctx);
    }

    // Only once the push stage confirmed the tags landed on GitHub.
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
