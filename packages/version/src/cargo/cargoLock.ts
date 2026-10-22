import path from 'node:path';
import { parseCargoToml } from '@releasekit/config';
import { findCargoLockfile, syncCargoLockVersion } from '@releasekit/core';
import { log } from '../utils/logging.js';

/**
 * Sync a crate's own `[[package]]` entry in its committed `Cargo.lock` to the version now in its
 * `Cargo.toml`, so the lock doesn't drift from the manifest (which breaks `cargo build --locked`/
 * `--frozen` and leaks a spurious lock diff into later builds). The edit is core's
 * `syncCargoLockVersion`, which never runs cargo. We never create a lock that wasn't already committed.
 *
 * Returns the lock path when it lists the crate at the manifest's version (so the caller can stage it),
 * or `undefined` when no committed lock lists the crate, under dry-run (the manifest hasn't been written
 * yet), or when the sync fails. A failure is logged but never thrown: the version bump itself already
 * succeeded and must not be blocked by a lockfile fix-up — surfacing the drift loudly is enough.
 */
export function syncCargoLockfile(cargoTomlPath: string, dryRun = false): string | undefined {
  const crateDir = path.dirname(cargoTomlPath);
  if (dryRun) {
    const lockPath = findCargoLockfile(crateDir);
    if (lockPath) {
      log(`[DRY RUN] Would sync Cargo.lock at ${lockPath}`, 'info');
    }
    return undefined;
  }

  try {
    const { name, version } = parseCargoToml(cargoTomlPath).package ?? {};
    if (!name || typeof version !== 'string') {
      log(`No package name and version in ${cargoTomlPath}; Cargo.lock not synced`, 'debug');
      return undefined;
    }
    const result = syncCargoLockVersion(crateDir, name, version);
    if (!result) {
      log(`No committed Cargo.lock lists ${name}; nothing to sync`, 'debug');
      return undefined;
    }
    if (result.changed) {
      log(`Synced Cargo.lock at ${result.lockPath} (${name} ${version})`, 'success');
    }
    return result.lockPath;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    log(
      `Failed to sync Cargo.lock for ${cargoTomlPath}: ${detail}. The committed lock may drift from the bump.`,
      'warning',
    );
    return undefined;
  }
}
