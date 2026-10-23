import type { PublishErrorCode } from '../errors/index.js';
import type { PipelineContext, PublishConfig } from '../types.js';

export type RegistryId = 'npm' | 'cargo' | 'pub';

export interface RegistryTarget {
  packageName: string;
  /** The name in `VersionOutput`. Some crates and Dart packages have a different registry `packageName`. */
  updatePackageName: string;
  version: string;
}

export interface SkipDecision {
  reason: string;
  alreadyPublished?: boolean;
}

/**
 * Adapters hold only what genuinely differs between registries; the dispatcher owns the shared
 * lifecycle (per-target results, already-published idempotency, bounded retry, the fail-fast throw,
 * accumulation into `ctx.output`).
 *
 * `S` is an opaque per-run session produced by `authCheck` and threaded to every later call.
 */
export interface Registry<T extends RegistryTarget = RegistryTarget, S = unknown> {
  readonly id: RegistryId;
  readonly displayName: string;
  /** Suffix on "already published" prose ("" | " on crates.io" | " on pub.dev"). */
  readonly alreadyPublishedNote: string;
  /** npm is enabled by default, so its disabled log surfaces at info, not debug. */
  readonly disabledLog: { level: 'info' | 'debug'; message: string };
  readonly publishErrorCode: PublishErrorCode;
  readonly alreadyPublishedPattern: RegExp;

  isEnabled(config: PublishConfig): boolean;

  /** Auth pre-flight plus run-wide setup (npm env isolation). Throws a createPublishError on missing auth. */
  authCheck(ctx: PipelineContext): Promise<S>;

  /** Must return targets already in publish order. */
  discover(ctx: PipelineContext): Promise<T[]>;

  /** Setup that runs only when there is at least one target (cargo dirty check, pub token registration). */
  prepare?(ctx: PipelineContext, session: S): Promise<void>;

  /** Skips unrelated to idempotency (npm: non-npm manifest, private package). */
  precheckSkip?(target: T, ctx: PipelineContext, session: S): SkipDecision | undefined;

  isPublished(target: T, ctx: PipelineContext, session: S): Promise<boolean>;

  /** Run-once pre-publish side effects that must not be retried (npm diagnostics, cargo clean). */
  prePublish?(target: T, ctx: PipelineContext, session: S): Promise<void>;

  /** Honours dryRun via execCommand and throws on failure. */
  publish(target: T, ctx: PipelineContext, session: S): Promise<void>;

  /** Teardown for `authCheck`'s setup. */
  dispose?(session: S): void | Promise<void>;
}
