import fs from 'node:fs';
import path from 'node:path';

/** A `Cargo.toml` declares a workspace when it has a `[workspace]` (or `[workspace.*]`) table. */
function isWorkspaceManifest(cargoTomlPath: string): boolean {
  try {
    return /^\s*\[workspace[\].]/m.test(fs.readFileSync(cargoTomlPath, 'utf8'));
  } catch {
    return false;
  }
}

/**
 * Find the `Cargo.lock` that governs a crate at `startDir` — the one `cargo update --workspace`
 * rewrites — by walking up from `startDir`:
 *
 * - If an ancestor `Cargo.toml` declares a `[workspace]`, that's the workspace root and its
 *   `Cargo.lock` is authoritative. A workspace member's own (stray) lock is ignored by cargo, so we
 *   must not target it — only the root lock actually moves.
 * - Otherwise (a standalone crate, no workspace) the nearest committed `Cargo.lock` governs.
 *
 * Returns `undefined` when no committed lock governs the crate. That is deliberate: libraries
 * commonly don't commit a lock, and a version bump must never *create* one as a side effect — only
 * sync an existing committed lock so it doesn't drift.
 */
export function findCargoLockfile(startDir: string): string | undefined {
  let dir = path.resolve(startDir);
  let nearestLock: string | undefined;
  while (true) {
    const lockPath = path.join(dir, 'Cargo.lock');
    const hasLock = fs.existsSync(lockPath);
    if (hasLock && !nearestLock) nearestLock = lockPath;

    const cargoToml = path.join(dir, 'Cargo.toml');
    if (fs.existsSync(cargoToml) && isWorkspaceManifest(cargoToml)) {
      // Workspace root: its lock is the one cargo updates (or none, if no lock is committed).
      return hasLock ? lockPath : undefined;
    }

    const parent = path.dirname(dir);
    if (parent === dir) break; // reached the filesystem root
    dir = parent;
  }
  return nearestLock;
}
