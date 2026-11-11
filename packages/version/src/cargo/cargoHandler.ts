import fs from 'node:fs';
import path from 'node:path';
import type { CargoManifest } from '@releasekit/config';
import { isCargoToml, parseCargoToml } from '@releasekit/config';
import * as TOML from 'smol-toml';
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

export function getCargoInfo(cargoPath: string): CargoInfo {
  if (!fs.existsSync(cargoPath)) {
    log(`Cargo.toml file not found at: ${cargoPath}`, 'error');
    throw new Error(`Cargo.toml file not found at: ${cargoPath}`);
  }

  try {
    const cargo = parseCargoToml(cargoPath);

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

/**
 * Records the bump for the end-of-run Cargo.lock sync. Every version-step bump goes through here, so no
 * strategy can skip the sync.
 */
export function updateCargoVersion(
  cargoPath: string,
  version: string,
  dryRun = false,
  { recordAs, isRoot }: { recordAs?: string; isRoot?: boolean } = {},
): void {
  try {
    const cargo = parseCargoToml(cargoPath);
    const packageName = cargo.package?.name;

    if (!packageName) {
      throw new Error(`No package name found in ${cargoPath}`);
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
  } catch (error) {
    log(`Failed to update Cargo.toml at ${cargoPath}`, 'error');
    if (error instanceof Error) {
      log(error.message, 'error');
    }
    throw error;
  }
}
