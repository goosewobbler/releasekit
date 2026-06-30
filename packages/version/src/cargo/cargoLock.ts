import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { findCargoLockfile } from '@releasekit/core';
import { log } from '../utils/logging.js';

/**
 * Sync a crate's `Cargo.lock` self-version entry after its `Cargo.toml` version was bumped, so a
 * committed lock doesn't drift from the manifest (which breaks `cargo build --locked`/`--frozen` and
 * leaks a spurious lock diff into later builds). The bump only rewrites `Cargo.toml`, so without this
 * the lock's own `[[package]]` entry stays at the old version.
 *
 * The refresh is surgical and offline: `cargo update --workspace --offline` moves only the workspace
 * members' own lock entries to match their manifests, never re-resolving registry dependencies, so it
 * can't reintroduce a dependency-cascade. We never create a lock that wasn't already committed.
 *
 * Returns the lock path when it was refreshed (so the caller can stage it), or `undefined` when there
 * is no committed lock, under dry-run, or when cargo is unavailable / the refresh fails. A failure is
 * logged but never thrown: the version bump itself already succeeded and must not be blocked by a
 * lockfile fix-up — surfacing the drift loudly is enough.
 */
export function syncCargoLockfile(cargoTomlPath: string, dryRun = false): string | undefined {
  const crateDir = path.dirname(cargoTomlPath);
  const lockPath = findCargoLockfile(crateDir);
  if (!lockPath) {
    log(`No Cargo.lock found above ${crateDir}; nothing to sync`, 'debug');
    return undefined;
  }

  if (dryRun) {
    log(`[DRY RUN] Would refresh Cargo.lock at ${lockPath}`, 'info');
    return undefined;
  }

  try {
    execFileSync('cargo', ['update', '--workspace', '--offline'], { cwd: crateDir, stdio: 'pipe' });
    log(`Synced Cargo.lock at ${lockPath}`, 'success');
    return lockPath;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      log(
        `cargo not found on PATH — Cargo.lock at ${lockPath} may drift from the bumped version. ` +
          'Install the Rust toolchain in the release environment, or set version.cargo.enabled to false.',
        'warning',
      );
    } else {
      const stderr = (error as { stderr?: Buffer | string }).stderr;
      const detail = stderr ? stderr.toString().trim() : error instanceof Error ? error.message : String(error);
      log(`Failed to refresh Cargo.lock at ${lockPath}: ${detail}`, 'warning');
    }
    return undefined;
  }
}
