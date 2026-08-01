import type { ReleaseOutput } from '../types.js';

/**
 * Did a `standing-pr publish` actually publish anything?
 *
 * `versionOutput.updates` cannot answer this. The manifest carries the versions the merge already
 * landed on `main`, so it is populated on every run — including a re-run where every package was
 * already published and nothing happened.  Only `publishOutput` records what *this* invocation did.
 *
 * Within `publishOutput`, the registry results are the one honest signal. Release tags are created
 * before the pipeline runs, `git.pushed` is set for any push attempt, and the GitHub-release stage
 * reports `success: true` for an already-existing release — none of those distinguish a real publish
 * from an idempotent no-op. A registry result does: `skipped` and `alreadyPublished` mark the
 * packages that were passed over. Same predicate the verify stage uses to pick what to verify.
 */
export function publishDidChange(result: ReleaseOutput | null | undefined): boolean {
  const output = result?.publishOutput;
  if (!output || output.dryRun) return false;
  return [...output.npm, ...output.cargo, ...output.pub].some((r) => r.success && !r.skipped && !r.alreadyPublished);
}
