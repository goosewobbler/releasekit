import * as path from 'node:path';
import type { VersionPackageUpdate } from '@releasekit/core';
import { cargoPublishRanks } from '../registry/cargo.js';
import { orderNpmUpdates } from '../registry/npm.js';
import { pubPublishRanks } from '../registry/pub.js';
import type { PublishCliOptions, PublishConfig } from '../types.js';

/**
 * Applies the batch stages' publish order to per-package mode, which publishes one update at a time. Crates, then pub
 * packages, are reordered among the positions npm order gave them, so a hybrid can land after an npm package that
 * depends on it: npm accepts that, where cargo rejects a crate published before its path dependency.
 */
export function orderVersionUpdates(
  updates: VersionPackageUpdate[],
  config: PublishConfig,
  registry: PublishCliOptions['registry'],
  cwd: string,
): VersionPackageUpdate[] {
  let ordered = orderNpmUpdates(updates, config.npm.publishOrder, cwd);
  if (config.cargo.enabled && (registry === 'all' || registry === 'cargo')) {
    ordered = reorderAmongOwnPositions(ordered, cargoPublishRanks(updates, config.cargo.publishOrder, cwd), cwd);
  }
  if (config.pub.enabled && (registry === 'all' || registry === 'pub')) {
    ordered = reorderAmongOwnPositions(ordered, pubPublishRanks(updates, config.pub.publishOrder, cwd), cwd);
  }
  return ordered;
}

function reorderAmongOwnPositions(
  updates: VersionPackageUpdate[],
  rankByDir: Map<string, number>,
  cwd: string,
): VersionPackageUpdate[] {
  const rankOf = (u: VersionPackageUpdate) => rankByDir.get(path.dirname(path.resolve(cwd, u.filePath)));
  const ranked = updates.filter((u) => rankOf(u) !== undefined).sort((a, b) => (rankOf(a) ?? 0) - (rankOf(b) ?? 0));
  let next = 0;
  return updates.map((u) => (rankOf(u) === undefined ? u : (ranked[next++] ?? u)));
}
