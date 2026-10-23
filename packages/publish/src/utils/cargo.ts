import * as fs from 'node:fs';
import type { CargoManifest } from '@releasekit/config';
import { parseCargoToml } from '@releasekit/config';
import { type CargoLockBump, planCargoLockUpdates, warn } from '@releasekit/core';
import { createGitCli } from '@releasekit/git';
import * as TOML from 'smol-toml';
import { createPublishError, PublishErrorCode } from '../errors/index.js';

export type { CargoManifest };
export { parseCargoToml };

/**
 * Returns every lock that records a bumped crate, changed or not, so the caller stages them all.
 *
 * Logs rather than throws: in the standing-PR flow this runs after the merge, and a lock fix-up mustn't
 * strand a release already on the base branch. The version step fails on an unsyncable lock instead.
 */
export async function syncCargoLockfiles(cwd: string, bumps: Array<Omit<CargoLockBump, 'name'>>): Promise<string[]> {
  if (bumps.length === 0) {
    return [];
  }
  try {
    const lockBumps = bumps.flatMap((bump) => {
      const name = parseCargoToml(bump.cargoTomlPath).package?.name;
      return name ? [{ ...bump, name }] : [];
    });
    const updates = await planCargoLockUpdates(createGitCli(), cwd, lockBumps);
    for (const { lockPath, content, changed } of updates) {
      if (changed) {
        fs.writeFileSync(lockPath, content);
      }
    }
    return updates.map(({ lockPath }) => lockPath);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    warn(`Failed to sync Cargo.lock files: ${detail}. Committed locks may drift from the bump.`);
    return [];
  }
}

export const CRATES_IO_USER_AGENT = 'releasekit/publish (https://github.com/goosewobbler/releasekit)';
export const CRATES_IO_API_TIMEOUT_MS = 30_000;

export function updateCargoVersion(cargoPath: string, newVersion: string): void {
  try {
    const cargo = parseCargoToml(cargoPath);
    if (cargo.package) {
      cargo.package.version = newVersion;
      fs.writeFileSync(cargoPath, TOML.stringify(cargo as Record<string, unknown>));
    }
  } catch (error) {
    throw createPublishError(
      PublishErrorCode.CARGO_TOML_ERROR,
      `${cargoPath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export function extractPathDeps(manifest: CargoManifest): string[] {
  const pathDeps: string[] = [];
  const deps = manifest.dependencies;
  if (deps) {
    for (const dep of Object.values(deps)) {
      if (dep && typeof dep === 'object' && 'path' in dep) {
        pathDeps.push((dep as { path: string }).path);
      }
    }
  }
  return pathDeps;
}
