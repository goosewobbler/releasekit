import * as path from 'node:path';
import type { VersionPackageUpdate } from '@releasekit/core';
import { cargoUpdateDirs, orderCargoVersionUpdates } from '../registry/cargo.js';
import { orderNpmUpdates } from '../registry/npm.js';
import type { PublishConfig } from '../types.js';

/**
 * npm order is the base, so an npm dependency stays ahead of a hybrid that depends on it.
 * Cargo updates, including hybrids, are reordered only within the slots npm order gave them.
 */
export function orderVersionUpdates(
  updates: VersionPackageUpdate[],
  config: PublishConfig,
  cwd: string,
): VersionPackageUpdate[] {
  const npmOrdered = orderNpmUpdates(updates, config.npm.publishOrder, cwd);
  const cargoDirs = cargoUpdateDirs(updates, cwd);
  if (cargoDirs.size <= 1) {
    return npmOrdered;
  }
  const cargoRank = new Map(
    orderCargoVersionUpdates(updates, config.cargo.publishOrder, cwd)
      .filter((u) => cargoDirs.has(path.dirname(path.resolve(cwd, u.filePath))))
      .map((u, index) => [path.dirname(path.resolve(cwd, u.filePath)), index]),
  );
  const slots: number[] = [];
  npmOrdered.forEach((u, index) => {
    if (cargoDirs.has(path.dirname(path.resolve(cwd, u.filePath)))) {
      slots.push(index);
    }
  });
  const cargoInNpmOrder = slots.map((index) => npmOrdered[index]).filter((u): u is VersionPackageUpdate => !!u);
  cargoInNpmOrder.sort(
    (a, b) =>
      (cargoRank.get(path.dirname(path.resolve(cwd, a.filePath))) ?? 0) -
      (cargoRank.get(path.dirname(path.resolve(cwd, b.filePath))) ?? 0),
  );
  const result = [...npmOrdered];
  slots.forEach((index, i) => {
    const next = cargoInNpmOrder[i];
    if (next) {
      result[index] = next;
    }
  });
  return result;
}
