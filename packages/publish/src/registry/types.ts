import type { PublishErrorCode } from '../errors/index.js';
import type { PipelineContext, PublishConfig } from '../types.js';

export type RegistryId = 'npm' | 'cargo' | 'pub';

/** The minimum a publishable unit must expose for the shared dispatcher. */
export interface RegistryTarget {
  packageName: string;
  version: string;
}

/** A pre-publish decision to skip a target without attempting a publish. */
export interface SkipDecision {
  reason: string;
  /** True when the skip is because the version is already on the registry (idempotency). */
  alreadyPublished?: boolean;
}

/**
 * A publish target (npm package, cargo crate, pub package) behind one interface so a single
 * dispatcher can drive all three. Adapters hold only what genuinely differs — discovery,
 * the publish command, the already-published signature — while the dispatcher owns the shared
 * lifecycle: per-target results, the already-published idempotency check, bounded retry, the
 * fail-fast throw, and accumulation into `ctx.output`.
 *
 * `S` is an opaque per-run session produced by `authCheck` and threaded to every later call
 * (npm env isolation, cargo dirty-state, …); `T` is the adapter's target shape.
 */
export interface Registry<T extends RegistryTarget = RegistryTarget, S = unknown> {
  readonly id: RegistryId;
  /** Registry name in the success log line ("npm" | "crates.io" | "pub.dev"). */
  readonly displayName: string;
  /** Suffix on "already published" prose ("" | " on crates.io" | " on pub.dev"). */
  readonly alreadyPublishedNote: string;
  /** How a disabled stage is logged — npm is enabled by default so surfaces at info, not debug. */
  readonly disabledLog: { level: 'info' | 'debug'; message: string };
  /** Error raised on a hard publish failure (fail-fast). */
  readonly publishErrorCode: PublishErrorCode;
  /**
   * Single source for this registry's "already on the registry" error signature. The dispatcher
   * uses it both to keep an already-published conflict out of the retry loop and to resolve a
   * surfaced conflict as an idempotent skip — so the idempotency concept lives in one place.
   */
  readonly alreadyPublishedPattern: RegExp;

  isEnabled(config: PublishConfig): boolean;

  /**
   * Auth pre-flight plus setup that must exist for the whole run (npm env isolation). Throws a
   * createPublishError on missing auth. Returns the session threaded to every later call and
   * disposed when the stage ends.
   */
  authCheck(ctx: PipelineContext): Promise<S>;

  /** This registry's manifests from `ctx.input.updates`, already in publish order. */
  discover(ctx: PipelineContext, session: S): Promise<T[]>;

  /**
   * One-time setup that should run only when there is at least one target — so an enabled-but-empty
   * stage stays side-effect-free (cargo working-dir dirty check, pub token registration).
   */
  prepare?(ctx: PipelineContext, session: S): Promise<void>;

  /**
   * Pre-publish skips that are not idempotency-related (npm: non-npm manifest, private package).
   * Returns undefined to proceed to the already-published check.
   */
  precheckSkip?(target: T, ctx: PipelineContext, session: S): SkipDecision | undefined;

  /** Registry-side already-published check (npm view, crates.io / pub.dev REST API). */
  isPublished(target: T, ctx: PipelineContext, session: S): Promise<boolean>;

  /** Run-once pre-publish side effects that must not be retried (npm diagnostics, cargo clean). */
  prePublish?(target: T, ctx: PipelineContext, session: S): Promise<void>;

  /** Publish one target. Honours dryRun via execCommand and throws on failure. */
  publish(target: T, ctx: PipelineContext, session: S): Promise<void>;

  /** Teardown for `authCheck`'s setup (npm env isolation). */
  dispose?(session: S): void;
}
