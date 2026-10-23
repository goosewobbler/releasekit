import type { PublishOutput } from './types.js';

/**
 * True if this run published to a registry or created the release commit. Tags, pushes and GitHub
 * releases don't count: they report success even when nothing changed.
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
