import { debug, info, success, warn } from '@releasekit/core';
import { createPublishError } from '../errors/index.js';
import type { PipelineContext, PublishResult } from '../types.js';
import { getExecErrorOutput } from '../utils/exec.js';
import { classifyPublishError, withPublishRetry } from '../utils/publish-retry.js';
import type { Registry, RegistryTarget } from './types.js';

/** Bounded auto-retry for transient registry blips: initial attempt + 2 retries. */
const PUBLISH_RETRY = { maxAttempts: 3, initialDelay: 1000 } as const;

/**
 * Drive one registry through the shared publish lifecycle. Every registry-specific decision lives
 * behind the `Registry` interface; this function owns what they all share — the per-target result,
 * the already-published idempotency handling, bounded retry for transient blips, the fail-fast
 * throw on a real failure, and accumulation into `ctx.output`.
 */
export async function runPublishStage<T extends RegistryTarget, S>(
  registry: Registry<T, S>,
  ctx: PipelineContext,
): Promise<void> {
  if (!registry.isEnabled(ctx.config)) {
    const { level, message } = registry.disabledLog;
    (level === 'info' ? info : debug)(message);
    return;
  }

  const dryRun = ctx.cliOptions.dryRun;
  const results = ctx.output[registry.id];
  const session = await registry.authCheck(ctx);

  try {
    const targets = await registry.discover(ctx, session);
    if (targets.length > 0) await registry.prepare?.(ctx, session);

    for (const target of targets) {
      const result: PublishResult = {
        packageName: target.packageName,
        version: target.version,
        registry: registry.id,
        success: false,
        skipped: false,
      };

      const skip = registry.precheckSkip?.(target, ctx, session);
      if (skip) {
        result.skipped = true;
        result.success = true;
        result.reason = skip.reason;
        if (skip.alreadyPublished) result.alreadyPublished = true;
        results.push(result);
        continue;
      }

      if (await registry.isPublished(target, ctx, session)) {
        markAlreadyPublished(result, registry.alreadyPublishedNote);
        results.push(result);
        warn(skipMessage(target, registry.alreadyPublishedNote));
        continue;
      }

      await registry.prePublish?.(target, ctx, session);

      try {
        await withPublishRetry(() => registry.publish(target, ctx, session), {
          ...PUBLISH_RETRY,
          label: `${target.packageName}@${target.version}`,
          // Never retry an already-published conflict — it resolves as a skip below.
          shouldRetry: (error) =>
            !registry.alreadyPublishedPattern.test(getExecErrorOutput(error)) &&
            classifyPublishError(error) === 'transient',
          // Recorded via callback (not the return value) so the failure paths below — including
          // exhaustion — still carry the attempt count.
          onAttempt: (attempt) => {
            result.attempts = attempt;
          },
        });

        result.success = true;
        if (!dryRun) success(`Published ${target.packageName}@${target.version} to ${registry.displayName}`);
        results.push(result);
      } catch (error) {
        // A surfaced already-published conflict (a publish that landed but whose response was lost,
        // or a pre-check that lagged the registry index) resolves as an idempotent skip so re-runs
        // of a partially-failed release don't fail.
        if (registry.alreadyPublishedPattern.test(getExecErrorOutput(error))) {
          markAlreadyPublished(result, registry.alreadyPublishedNote, ' (detected from publish error)');
          results.push(result);
          warn(skipMessage(target, registry.alreadyPublishedNote));
          continue;
        }
        result.reason = error instanceof Error ? error.message : String(error);
        results.push(result);
        throw createPublishError(
          registry.publishErrorCode,
          `${target.packageName}@${target.version}: ${result.reason}`,
        );
      }
    }
  } finally {
    registry.dispose?.(session);
  }
}

function markAlreadyPublished(result: PublishResult, note: string, suffix = ''): void {
  result.alreadyPublished = true;
  result.skipped = true;
  result.success = true;
  result.reason = `Already published${note}${suffix}`;
}

function skipMessage(target: RegistryTarget, note: string): string {
  return `${target.packageName}@${target.version} is already published${note}, skipping`;
}
