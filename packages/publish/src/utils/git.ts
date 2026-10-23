import { info } from '@releasekit/core';

/**
 * The `@releasekit/git` seam has no dry-run concept, so git writes must be gated here. `label` MUST use
 * the remote NAME, never an authed push URL - a token must never reach the logs.
 */
export async function runGit(dryRun: boolean, label: string, op: () => Promise<void>): Promise<void> {
  if (dryRun) {
    info(`[DRY RUN] Would execute: ${label}`);
    return;
  }
  await op();
}
