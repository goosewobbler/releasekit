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
 * Dry runs still plan the edits, so an unsyncable lock fails them too. Every edit is planned before the
 * first write, so a {@link CargoLockSyncError} leaves all locks untouched.
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
