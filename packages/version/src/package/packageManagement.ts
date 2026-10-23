import fs from 'node:fs';
import path from 'node:path';
import { isCargoToml, updateCargoVersion } from '../cargo/cargoHandler.js';
import { isPubspecYaml, updatePubVersion } from '../pub/pubHandler.js';
import type { PkgJson } from '../types.js';
import { addPackageUpdate, recordPendingWrite } from '../utils/jsonOutput.js';
import { log } from '../utils/logging.js';

export interface PackageInfo {
  name: string;
  version: string;
  path: string;
  dir: string;
  content: PkgJson;
}

export function getPackageInfo(pkgPath: string): PackageInfo {
  if (!fs.existsSync(pkgPath)) {
    const dir = path.dirname(pkgPath);

    const cargoPath = path.join(dir, 'Cargo.toml');
    const nodeSubdirPath = path.join(dir, 'node', 'package.json');
    const jsSubdirPath = path.join(dir, 'js', 'package.json');

    if (fs.existsSync(cargoPath)) {
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

/** @param isRoot The workspace-root package.json, bumped in lockstep (sync mode). */
export function updatePackageVersion(packagePath: string, version: string, dryRun = false, isRoot = false): void {
  if (isCargoToml(packagePath)) {
    updateCargoVersion(packagePath, version, dryRun);
    return;
  }

  if (isPubspecYaml(packagePath)) {
    updatePubVersion(packagePath, version, dryRun);
    return;
  }

  try {
    const packageContent = fs.readFileSync(packagePath, 'utf8');
    const packageJson = JSON.parse(packageContent);
    const packageName = packageJson.name;

    const updatedContent = `${JSON.stringify({ ...packageJson, version }, null, 2)}\n`;
    if (dryRun) {
      recordPendingWrite(packagePath, updatedContent);
    } else {
      fs.writeFileSync(packagePath, updatedContent);
    }

    addPackageUpdate(packageName, version, packagePath, isRoot);

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
