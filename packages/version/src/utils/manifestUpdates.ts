import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Config } from '@releasekit/config';
import { updatePackageVersion } from '../package/packageManagement.js';
import { resolveConfinedManifestPath } from './confinedPath.js';

export function updateCargoFiles(
  packageDir: string,
  version: string,
  cargoConfig: Config['cargo'],
  dryRun = false,
  repoRoot: string = process.cwd(),
): string[] {
  const updatedFiles: string[] = [];

  const cargoEnabled = cargoConfig?.enabled !== false;

  if (!cargoEnabled) {
    return updatedFiles;
  }

  const cargoPaths = cargoConfig?.paths;

  if (cargoPaths && cargoPaths.length > 0) {
    for (const cargoPath of cargoPaths) {
      const resolvedCargoPath = resolveConfinedManifestPath(repoRoot, packageDir, cargoPath, 'Cargo.toml');
      if (fs.existsSync(resolvedCargoPath)) {
        updatePackageVersion(resolvedCargoPath, version, dryRun);
        updatedFiles.push(resolvedCargoPath);
      }
    }
  } else {
    const cargoTomlPath = path.join(packageDir, 'Cargo.toml');
    if (fs.existsSync(cargoTomlPath)) {
      updatePackageVersion(cargoTomlPath, version, dryRun);
      updatedFiles.push(cargoTomlPath);
    }
  }

  return updatedFiles;
}

export function updatePubFiles(
  packageDir: string,
  version: string,
  pubConfig: Config['pub'],
  dryRun = false,
  repoRoot: string = process.cwd(),
): string[] {
  const updatedFiles: string[] = [];

  const pubEnabled = pubConfig?.enabled !== false;

  if (!pubEnabled) {
    return updatedFiles;
  }

  const pubPaths = pubConfig?.paths;

  if (pubPaths && pubPaths.length > 0) {
    for (const pubPath of pubPaths) {
      const resolvedPubspecPath = resolveConfinedManifestPath(repoRoot, packageDir, pubPath, 'pubspec.yaml');
      if (fs.existsSync(resolvedPubspecPath)) {
        updatePackageVersion(resolvedPubspecPath, version, dryRun);
        updatedFiles.push(resolvedPubspecPath);
      }
    }
  } else {
    const pubspecPath = path.join(packageDir, 'pubspec.yaml');
    if (fs.existsSync(pubspecPath)) {
      updatePackageVersion(pubspecPath, version, dryRun);
      updatedFiles.push(pubspecPath);
    }
  }

  return updatedFiles;
}
