import fs from 'node:fs';
import path from 'node:path';
import { getCargoInfo } from '../cargo/cargoHandler.js';
import { log } from './logging.js';

export interface ManifestVersionResult {
  version: string | null;
  manifestFound: boolean;
  manifestPath: string;
  manifestType: 'package.json' | 'Cargo.toml' | null;
}

export function getVersionFromManifests(packageDir: string): ManifestVersionResult {
  const packageJsonPath = path.join(packageDir, 'package.json');
  const cargoTomlPath = path.join(packageDir, 'Cargo.toml');

  if (fs.existsSync(packageJsonPath)) {
    try {
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
      if (packageJson.version) {
        log(`Found version ${packageJson.version} in package.json`, 'debug');
        return {
          version: packageJson.version,
          manifestFound: true,
          manifestPath: packageJsonPath,
          manifestType: 'package.json',
        };
      }
      log('No version field found in package.json', 'debug');
    } catch (packageJsonError) {
      const errMsg = packageJsonError instanceof Error ? packageJsonError.message : String(packageJsonError);
      log(`Error reading package.json: ${errMsg}`, 'warning');
    }
  }

  if (fs.existsSync(cargoTomlPath)) {
    try {
      const cargoInfo = getCargoInfo(cargoTomlPath);
      if (cargoInfo.version) {
        log(`Found version ${cargoInfo.version} in Cargo.toml`, 'debug');
        return {
          version: cargoInfo.version,
          manifestFound: true,
          manifestPath: cargoTomlPath,
          manifestType: 'Cargo.toml',
        };
      }
      log('No version field found in Cargo.toml', 'debug');
    } catch (cargoTomlError) {
      const errMsg = cargoTomlError instanceof Error ? cargoTomlError.message : String(cargoTomlError);
      log(`Error reading Cargo.toml: ${errMsg}`, 'warning');
    }
  }

  return {
    version: null,
    manifestFound: false,
    manifestPath: '',
    manifestType: null,
  };
}

export function throwIfNoManifestsFound(packageDir: string): never {
  const packageJsonPath = path.join(packageDir, 'package.json');
  const cargoTomlPath = path.join(packageDir, 'Cargo.toml');

  throw new Error(
    `Neither package.json nor Cargo.toml found at ${packageDir}. Checked paths: ${packageJsonPath}, ${cargoTomlPath}. Cannot determine version.`,
  );
}
