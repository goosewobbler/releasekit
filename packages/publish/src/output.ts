import type { PublishOutput } from './types.js';

/**
 * Whether this run changed anything: a registry publish, or a release commit it created (never on a
 * re-run or under `standing-pr publish`). Tags, `git.pushed` and GitHub releases report success for a
 * no-op, so they don't count.
 */
export function publishDidChange(output: PublishOutput | null | undefined): boolean {
  if (!output || output.dryRun) {
    return false;
  }
  if (output.git.committed) {
    return true;
  }
  return [...output.npm, ...output.cargo, ...output.pub].some((r) => r.success && !r.skipped && !r.alreadyPublished);
}
