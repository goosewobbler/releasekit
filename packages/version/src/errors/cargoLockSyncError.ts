import { VersionError } from './versionError.js';

/** Fatal on purpose: a lock left at the old version breaks every later `cargo --locked` run. */
export class CargoLockSyncError extends VersionError {
  constructor(details: string) {
    super(`Failed to sync Cargo.lock: ${details}`, 'CARGO_LOCK_SYNC_ERROR', [
      'If the lock also lists the crate from a registry or git source, sync it with cargo (`cargo update` with the new version in Cargo.toml) and commit it, or drop the second source',
    ]);
  }
}
