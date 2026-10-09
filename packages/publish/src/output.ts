import type { PublishOutput } from './types.js';

/**
 * Did this publish change anything?
 *
 * Two honest signals. A registry result is one: `skipped` and `alreadyPublished` mark the packages
 * that were passed over. The release commit is the other: `git.committed` is only set when the
 * git-commit stage created a new commit, so it is never true on an idempotent re-run — and never true
 * under `standing-pr publish`, whose merge already made the commit (`skipGitCommit`). Release tags,
 * `git.pushed` (set for any push attempt), and the GitHub-release stage (which reports `success: true`
 * for an already-existing release) can't distinguish a real publish from a no-op, so they don't count.
 *
 * Answers `changed` for both the `publish` CLI and `standing-pr publish`, which is why it lives here
 * rather than in either caller.
 */
export function publishDidChange(output: PublishOutput | null | undefined): boolean {
  if (!output || output.dryRun) return false;
  if (output.git?.committed) return true;
  // Tolerate absent registry arrays: this also runs on the partial output of a failed pipeline, and
  // throwing here would replace the publish error the caller needs with a TypeError about our own shape.
  const results = [...(output.npm ?? []), ...(output.cargo ?? []), ...(output.pub ?? [])];
  return results.some((r) => r.success && !r.skipped && !r.alreadyPublished);
}
