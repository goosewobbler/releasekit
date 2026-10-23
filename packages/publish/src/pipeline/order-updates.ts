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
  const firstNonNpm = npmOrdered.findIndex((u) => !u.filePath.endsWith('package.json'));
  if (firstNonNpm === -1) {
    return npmOrdered;
  }
  const npmPart = npmOrdered.slice(0, firstNonNpm);
  const rest = npmOrdered.slice(firstNonNpm);
  return [...npmPart, ...orderCargoVersionUpdates(rest, config.cargo.publishOrder, cwd)];
}
