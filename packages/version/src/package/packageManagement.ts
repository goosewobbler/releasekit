/**
 * Package management utilities for releasekit-version
 */

import fs from 'node:fs';
import path from 'node:path';
import { isCargoToml, updateCargoVersion } from '../cargo/cargoHandler.js';
import type { PkgJson } from '../types.js';
import { addPackageUpdate } from '../utils/jsonOutput.js';
import { log } from '../utils/logging.js';

// Define the PackageInfo interface here for internal use
export interface PackageInfo {
  name: string;
  version: string;
  path: string;
  dir: string;
  content: PkgJson;
}

/**
 * Get package info from package.json
 */
export function getPackageInfo(pkgPath: string): PackageInfo {
  if (!fs.existsSync(pkgPath)) {
    const dir = path.dirname(pkgPath);

    // Check if this might be a hybrid package with Cargo.toml in root and package.json in subdirectory
    const cargoPath = path.join(dir, 'Cargo.toml');
    const nodeSubdirPath = path.join(dir, 'node', 'package.json');
    const jsSubdirPath = path.join(dir, 'js', 'package.json');

    if (fs.existsSync(cargoPath)) {
      // This is likely a hybrid package
      let suggestedPath = '';

      if (fs.existsSync(nodeSubdirPath)) {
        suggestedPath = nodeSubdirPath;
      } else if (fs.existsSync(jsSubdirPath)) {
        suggestedPath = jsSubdirPath;
      }

      if (suggestedPath) {
        log(`Package file not found at: ${pkgPath}`, 'error');
        log(`This appears to be a hybrid Rust/JS package. Found package.json at: ${suggestedPath}`, 'info');
        log(
          'To fix this issue, ensure your workspace configuration (pnpm-workspace.yaml, package.json workspaces, etc.) includes the subdirectory:',
          'info',
        );
        log(
          `
For pnpm-workspace.yaml:
packages:
  - 'packages/*'
  - 'packages/your-pkg/node'

For package.json workspaces:
{
  "workspaces": [
    "packages/*",
    "packages/your-pkg/node"
  ]
}

Then optionally use the "packages" config to target specific package names:
{
  "packages": ["@your-scope/package-name"]
}`,
          'info',
        );
      } else {
        log(`Package file not found at: ${pkgPath}`, 'error');
        log(`Found Cargo.toml but couldn't locate package.json in common subdirectories.`, 'info');
        log(
          'If this is a hybrid package, check where package.json is located and ensure your workspace configuration includes the correct subdirectory.',
          'info',
        );
      }
    } else {
      // Standard missing package.json error
      log(`Package file not found at: ${pkgPath}`, 'error');
    }

    process.exit(1);
  }

  try {
    const fileContent = fs.readFileSync(pkgPath, 'utf8');
    const pkg = JSON.parse(fileContent);

    if (!pkg.name) {
      log(`Package name not found in: ${pkgPath}`, 'error');
      process.exit(1);
    }

    return {
      name: pkg.name,
      version: pkg.version || '0.0.0',
      path: pkgPath,
      dir: path.dirname(pkgPath),
      content: pkg,
    };
  } catch (error) {
    log(`Error reading package: ${pkgPath}`, 'error');
    if (error instanceof Error) {
      log(error.message, 'error');
    }
    process.exit(1);
  }
}

/**
 * Update a package file (package.json or Cargo.toml) with a new version
 */
export function updatePackageVersion(packagePath: string, version: string, dryRun = false): void {
  // Handle Cargo.toml files separately
  if (isCargoToml(packagePath)) {
    updateCargoVersion(packagePath, version, dryRun);
    return;
  }

  // Handle package.json files
  try {
    const packageContent = fs.readFileSync(packagePath, 'utf8');
    const packageJson = JSON.parse(packageContent);
    const packageName = packageJson.name;

    if (!dryRun) {
      packageJson.version = version;
      fs.writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);
    }

    // Track update for JSON output
    addPackageUpdate(packageName, version, packagePath);

    log(
      `${dryRun ? '[DRY RUN] Would update' : 'Updated'} package.json at ${packagePath} to version ${version}`,
      'success',
    );
  } catch (error) {
    log(`Failed to update package.json at ${packagePath}`, 'error');
    if (error instanceof Error) {
      log(error.message, 'error');
    }
    throw error;
  }
}
