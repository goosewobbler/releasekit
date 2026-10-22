import fs from 'node:fs';
import { type CargoLockBump, planCargoLockUpdates } from '@releasekit/core';
import { createGitCli } from '@releasekit/git';
import { CargoLockSyncError } from '../errors/cargoLockSyncError.js';
import { recordPendingWrite } from '../utils/jsonOutput.js';
import { log } from '../utils/logging.js';

const recordedBumps: CargoLockBump[] = [];

export function recordCargoBump(bump: CargoLockBump): void {
  recordedBumps.push(bump);
}

/** Drop bumps recorded outside a version run, so a run never syncs another run's bumps. */
export function clearCargoBumps(): void {
  recordedBumps.length = 0;
}

/**
 * Sync every Cargo.lock that records a crate bumped since the last sync (core's `planCargoLockUpdates`).
 * Under dry-run the edits are still planned, so an unsyncable lock fails the dry run too, and they're
 * recorded as pending writes instead of written.
 *
 * Throws {@link CargoLockSyncError} on a lock it can't read, edit or write; every edit is planned before
 * the first write, so a failure leaves all locks untouched.
 */
export async function syncCargoLockfiles(cwd: string, dryRun: boolean): Promise<void> {
  const bumps = recordedBumps.splice(0);
  if (bumps.length === 0) {
    return;
  }

  try {
    for (const { lockPath, content, changed } of await planCargoLockUpdates(createGitCli(), cwd, bumps)) {
      if (!changed) {
        continue;
      }
      if (dryRun) {
        recordPendingWrite(lockPath, content);
        log(`[DRY RUN] Would sync Cargo.lock at ${lockPath}`, 'info');
      } else {
        fs.writeFileSync(lockPath, content);
        log(`Synced Cargo.lock at ${lockPath}`, 'success');
      }
    }
  } catch (error) {
    throw new CargoLockSyncError(error instanceof Error ? error.message : String(error));
  }
}
