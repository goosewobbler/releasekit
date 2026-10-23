import { debug, info, success, warn } from '@releasekit/core';
import { createPublishError } from '../errors/index.js';
import type { PipelineContext, PublishResult } from '../types.js';
import { getExecErrorOutput } from '../utils/exec.js';
import { classifyPublishError, withPublishRetry } from '../utils/publish-retry.js';
import type { Registry, RegistryTarget } from './types.js';

const PUBLISH_RETRY = { maxAttempts: 3, initialDelay: 1000 } as const;

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

  // Discover before authenticating so an enabled registry with nothing to publish (e.g. no crates) no-ops
  // rather than failing on a missing registry token.
  const targets = await registry.discover(ctx);
  if (targets.length === 0) {
    debug(`[${registry.id}] No targets found, nothing to publish`);
    return;
  }

  const session = await registry.authCheck(ctx);

  try {
    await registry.prepare?.(ctx, session);

    for (const target of targets) {
      const result: PublishResult = {
        packageName: target.packageName,
        updatePackageName: target.updatePackageName,
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
        if (skip.alreadyPublished) {
          result.alreadyPublished = true;
        }
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
          // Never retry an already-published conflict - it resolves as a skip below.
          shouldRetry: (error) =>
            !registry.alreadyPublishedPattern.test(getExecErrorOutput(error)) &&
            classifyPublishError(error) === 'transient',
          // Via callback, not the return value, so the failure paths below still carry the attempt count.
          onAttempt: (attempt) => {
            result.attempts = attempt;
          },
        });

        result.success = true;
        if (!dryRun) {
          success(`Published ${target.packageName}@${target.version} to ${registry.displayName}`);
        }
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
    await registry.dispose?.(session);
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
