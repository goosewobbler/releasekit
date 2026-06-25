import { info } from '@releasekit/core';

/**
 * Run a git WRITE through the `@releasekit/git` seam while honouring dry-run.
 *
 * The seam has no dry-run concept (it always executes), so callers must gate writes here. This
 * preserves the `execCommand` behaviour the seam migration replaced: in a dry run, log
 * `[DRY RUN] Would execute: <label>` and return without touching the repository. `label` MUST use
 * the remote NAME, never an authed push URL — a token must never reach the logs.
 */
export async function runGit(dryRun: boolean, label: string, op: () => Promise<void>): Promise<void> {
  if (dryRun) {
    info(`[DRY RUN] Would execute: ${label}`);
    return;
  }
  await op();
}
