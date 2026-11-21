import fs from 'node:fs';
import path from 'node:path';
import type { CargoManifest } from '@releasekit/config';
import { isCargoToml, isCratePublishable, parseCargoToml } from '@releasekit/config';
import * as TOML from 'smol-toml';
import { createVersionError, VersionErrorCode } from '../errors/versionError.js';
import { addPackageUpdate, writeVersionFile } from '../utils/jsonOutput.js';
import { log } from '../utils/logging.js';
import { recordCargoBump } from './cargoLock.js';

export { isCargoToml };

export interface CargoInfo {
  name: string;
  version: string;
  path: string;
  dir: string;
  content: CargoManifest;
}

export function getCargoInfo(cargoPath: string, content?: string): CargoInfo {
  if (content === undefined && !fs.existsSync(cargoPath)) {
    log(`Cargo.toml file not found at: ${cargoPath}`, 'error');
    throw new Error(`Cargo.toml file not found at: ${cargoPath}`);
  }

  try {
    const cargo = parseCargoToml(cargoPath, content);

    if (!cargo.package?.name) {
      log(`Package name not found in: ${cargoPath}`, 'error');
      throw new Error(`Package name not found in: ${cargoPath}`);
    }

    return {
      name: cargo.package.name,
      version: cargo.package.version || '0.0.0',
      path: cargoPath,
      dir: path.dirname(cargoPath),
      content: cargo,
    };
  } catch (error) {
    log(`Error reading Cargo.toml: ${cargoPath}`, 'error');
    if (error instanceof Error) {
      log(error.message, 'error');
      throw error;
    }
    throw new Error(`Failed to process Cargo.toml at ${cargoPath}`);
  }
}

/** False for a virtual workspace manifest, which has no [package]. */
export function isVersionedCrate(cargoPath: string): boolean {
  let cargo: CargoManifest;
  try {
    cargo = parseCargoToml(cargoPath);
  } catch (error) {
    throw new Error(`Cannot parse ${cargoPath}: ${error instanceof Error ? error.message : String(error)}`);
  }
  return !!cargo.package?.name;
}

/** Both TOML spellings, `key.workspace = true` and `key = { workspace = true }`, parse to this table. */
function isInheritedFromWorkspace(value: unknown): boolean {
  return typeof value === 'object' && value !== null && (value as { workspace?: unknown }).workspace === true;
}

export function inheritsWorkspaceVersion(cargo: CargoManifest): boolean {
  return isInheritedFromWorkspace(cargo.package?.version);
}

/** Cargo's workspace root for a crate: the nearest Cargo.toml with `[workspace]`, starting at the crate's own. */
function findWorkspaceManifest(cargoPath: string, cargo: CargoManifest): CargoManifest | undefined {
  if (cargo.workspace) {
    return cargo;
  }
  let dir = path.dirname(path.resolve(cargoPath));
  while (path.dirname(dir) !== dir) {
    dir = path.dirname(dir);
    const candidate = path.join(dir, 'Cargo.toml');
    if (fs.existsSync(candidate)) {
      const manifest = parseCargoToml(candidate);
      if (manifest.workspace) {
        return manifest;
      }
    }
  }
  return undefined;
}

/** The crate's manifest with a `version` or `publish` it inherits replaced by its workspace's value. */
export function resolveWorkspaceInheritance(cargoPath: string, cargo: CargoManifest): CargoManifest {
  const pkg = cargo.package;
  if (!pkg || !(isInheritedFromWorkspace(pkg.version) || isInheritedFromWorkspace(pkg.publish))) {
    return cargo;
  }
  const inherited = (findWorkspaceManifest(cargoPath, cargo)?.workspace?.package ?? {}) as {
    version?: unknown;
    publish?: boolean | string[];
  };
  const resolved = { ...pkg };
  if (isInheritedFromWorkspace(pkg.version)) {
    resolved.version = typeof inherited.version === 'string' ? inherited.version : undefined;
  }
  if (isInheritedFromWorkspace(pkg.publish)) {
    resolved.publish = inherited.publish;
  }
  return { ...cargo, package: resolved };
}

/**
 * Records the bump for the end-of-run Cargo.lock sync. Every version-step bump goes through here, so no
 * strategy can skip the sync. Returns false when it leaves the manifest as it is.
 */
export function updateCargoVersion(
  cargoPath: string,
  version: string,
  dryRun = false,
  { recordAs, isRoot }: { recordAs?: string; isRoot?: boolean } = {},
): boolean {
  try {
    const cargo = parseCargoToml(cargoPath);
    const packageName = cargo.package?.name;

    if (!packageName) {
      throw new Error(`No package name found in ${cargoPath}`);
    }

    if (inheritsWorkspaceVersion(cargo)) {
      if (isCratePublishable(resolveWorkspaceInheritance(cargoPath, cargo))) {
        throw createVersionError(
          VersionErrorCode.CARGO_INHERITED_VERSION,
          `${packageName} (${path.relative(process.cwd(), cargoPath)})`,
        );
      }
      log(`Not bumping ${cargoPath}: ${packageName} inherits its version from the workspace`, 'warning');
      return false;
    }

    if (!cargo.package) {
      cargo.package = { name: packageName, version };
    } else {
      cargo.package.version = version;
    }

    // TOML.stringify does not preserve original formatting or comments.
    const updatedContent = TOML.stringify(cargo as Record<string, unknown>);
    writeVersionFile(cargoPath, updatedContent, dryRun);

    addPackageUpdate(recordAs ?? packageName, version, cargoPath, isRoot);
    recordCargoBump({ cargoTomlPath: cargoPath, name: packageName, version });

    log(`${dryRun ? '[DRY RUN] Would update' : 'Updated'} Cargo.toml at ${cargoPath} to version ${version}`, 'success');
    return true;
  } catch (error) {
    log(`Failed to update Cargo.toml at ${cargoPath}`, 'error');
    if (error instanceof Error) {
      log(error.message, 'error');
    }
    throw error;
  }
}
