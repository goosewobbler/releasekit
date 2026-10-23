import type { VersionPackageUpdate } from '@releasekit/core';
import { orderCargoVersionUpdates } from '../registry/cargo.js';
import { orderNpmUpdates } from '../registry/npm.js';
import type { PublishConfig } from '../types.js';

/** Same dependency ordering batch publish stages use, for per-package mode's update loop. */
export function orderVersionUpdates(
  updates: VersionPackageUpdate[],
  config: PublishConfig,
  cwd: string,
): VersionPackageUpdate[] {
  const npmOrdered = orderNpmUpdates(updates, config.npm.publishOrder, cwd);
  // Hybrids use package.json paths but still need cargo dependency order across the full set.
  return orderCargoVersionUpdates(npmOrdered, config.cargo.publishOrder, cwd);
}
