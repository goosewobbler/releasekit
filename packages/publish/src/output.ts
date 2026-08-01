import type { PublishOutput } from './types.js';

/**
 * Did this publish actually publish anything?
 *
 * The registry results are the one honest signal in a {@link PublishOutput}. Release tags are created
 * before the pipeline runs, `git.pushed` is set for any push attempt, and the GitHub-release stage
 * reports `success: true` for an already-existing release — none of those distinguish a real publish
 * from an idempotent no-op. A registry result does: `skipped` and `alreadyPublished` mark the packages
 * that were passed over. Same predicate the verify stage uses to pick what to verify.
 *
 * Answers `changed` for both the `publish` CLI and `standing-pr publish`, which is why it lives here
 * rather than in either caller.
 */
export function publishDidChange(output: PublishOutput | null | undefined): boolean {
  if (!output || output.dryRun) return false;
  // Tolerate absent registry arrays: this also runs on the partial output of a failed pipeline, and
  // throwing here would replace the publish error the caller needs with a TypeError about our own shape.
  const results = [...(output.npm ?? []), ...(output.cargo ?? []), ...(output.pub ?? [])];
  return results.some((r) => r.success && !r.skipped && !r.alreadyPublished);
}
