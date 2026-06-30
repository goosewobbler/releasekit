import fs from 'node:fs';
import path from 'node:path';

/**
 * Find the `Cargo.lock` that governs a crate at `startDir` by walking up to the nearest ancestor
 * that has one — for a workspace member the lock lives at the workspace root, not the member dir.
 *
 * Returns `undefined` when no committed lock exists above `startDir`. That is deliberate: libraries
 * commonly don't commit a lock, and we must never *create* one as a side effect of a version bump —
 * only sync an existing committed lock so it doesn't drift.
 */
export function findCargoLockfile(startDir: string): string | undefined {
  let dir = path.resolve(startDir);
  while (true) {
    const lockPath = path.join(dir, 'Cargo.lock');
    if (fs.existsSync(lockPath)) return lockPath;
    const parent = path.dirname(dir);
    if (parent === dir) return undefined; // reached the filesystem root
    dir = parent;
  }
}
