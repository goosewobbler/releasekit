import * as fs from 'node:fs';
import * as path from 'node:path';
import type { CargoManifest } from '@releasekit/config';
import { parseCargoToml } from '@releasekit/config';
import { findCargoLockfile, warn } from '@releasekit/core';
import * as TOML from 'smol-toml';
import { createPublishError, PublishErrorCode } from '../errors/index.js';
import { execCommand } from './exec.js';

export type { CargoManifest };
export { parseCargoToml };

/**
 * Refresh a crate's `Cargo.lock` self-version entry after its `Cargo.toml` was bumped, so the
 * committed lock doesn't drift (#496). `cargo update --workspace --offline` moves only workspace
 * members' own lock entries to match their manifests — registry dependencies are never re-resolved.
 *
 * Returns the lock path (so the caller can stage it) or `undefined` when there's no committed lock,
 * or the refresh fails. A failure is logged, never thrown: a lockfile fix-up must not abort a publish
 * that would otherwise succeed. This mirrors the version step's sync (which covers the standing-PR
 * flow's `git add -A`); doing it here too keeps the direct-commit flow self-sufficient rather than
 * depending on the version step having run and succeeded first.
 */
export async function syncCargoLockfile(crateDir: string): Promise<string | undefined> {
  const lockPath = findCargoLockfile(crateDir);
  if (!lockPath) return undefined;

  try {
    await execCommand('cargo', ['update', '--workspace', '--offline'], {
      cwd: crateDir,
      label: `cargo update --workspace --offline (${path.basename(crateDir)})`,
    });
    return lockPath;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      warn(
        `cargo not found on PATH — Cargo.lock at ${lockPath} may drift from the bumped version. ` +
          'Install the Rust toolchain in the release environment, or disable cargo handling.',
      );
    } else {
      const stderr = (error as { stderr?: string }).stderr;
      const detail = stderr?.trim() || (error instanceof Error ? error.message : String(error));
      warn(`Failed to refresh Cargo.lock at ${lockPath}: ${detail}. The committed lock may drift from the bump.`);
    }
    return undefined;
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
