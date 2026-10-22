import fs from 'node:fs';
import { type CargoLockBump, findCommittedCargoLockfiles, planCargoLockUpdates } from '@releasekit/core';
import { createGitCli, type Git } from '@releasekit/git';
import { CargoLockSyncError } from '../errors/cargoLockSyncError.js';
import { recordPendingWrite } from '../utils/jsonOutput.js';
import { log } from '../utils/logging.js';

const recordedBumps: CargoLockBump[] = [];

/** Note a `Cargo.toml` version bump for the Cargo.lock sync at the end of the run. */
export function recordCargoBump(bump: CargoLockBump): void {
  recordedBumps.push(bump);
}

/** Drop bumps recorded outside a version run, so a run never syncs another run's bumps. */
export function clearCargoBumps(): void {
  recordedBumps.length = 0;
}

/**
 * Sync every Cargo.lock that records a crate bumped since the last sync, so no committed lock is left
 * at the old version (which breaks `cargo build --locked` and leaks a lock diff into later builds). The
 * candidates are every Cargo.lock tracked by git — apps that use a crate through a path dependency
 * have their own — plus each crate's own lock; see core's `planCargoLockUpdates`. We never create a lock.
 *
 * Under dry-run the edits are still worked out, so an unsyncable lock fails the dry run too, and are
 * recorded as pending writes (flushed with the manifests by `release`) instead of written.
 *
 * Returns every lock that lists a bumped crate, changed or not, so a caller can stage them. Throws a
 * {@link CargoLockSyncError} when a lock can't be read, edited or written; every edit is worked out
 * before the first write, so a lock that can't be edited leaves all of them untouched.
 */
export async function syncCargoLockfiles(cwd: string, dryRun: boolean, git: Git = createGitCli()): Promise<string[]> {
  const bumps = recordedBumps.splice(0);
  if (bumps.length === 0) {
    return [];
  }

  try {
    const updates = planCargoLockUpdates(bumps, await findCommittedCargoLockfiles(git, cwd));
    for (const { lockPath, content, changed } of updates) {
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
    return updates.map(({ lockPath }) => lockPath);
  } catch (error) {
    throw new CargoLockSyncError(error instanceof Error ? error.message : String(error));
  }
}
