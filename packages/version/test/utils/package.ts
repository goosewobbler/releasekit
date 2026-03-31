import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Create a package.json file in the given directory
 */
export function createPackageJson(dir: string, name: string, version = '0.1.0') {
  const packageJson = {
    name,
    version,
    private: true,
  };

  writeFileSync(join(dir, 'package.json'), JSON.stringify(packageJson, null, 2));

  // Create a dummy index.js file to give the package some actual content
  writeFileSync(join(dir, 'index.js'), 'console.log("Hello from package");');
}

/**
 * Get the version from a package.json file
 */
export function getPackageVersion(dir: string, pkgName?: string): string {
  if (!pkgName) {
    return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf-8')).version;
  }

  // Try different possible locations
  const possiblePaths = [join(dir, 'packages', pkgName, 'package.json'), join(dir, pkgName, 'package.json')];

  for (const path of possiblePaths) {
    if (existsSync(path)) {
      return JSON.parse(readFileSync(path, 'utf-8')).version;
    }
  }

  throw new Error(`No package.json found for ${pkgName} in ${dir}`);
}

/**
 * Read the CHANGELOG.md file from a directory
 */
export function readChangelog(dir: string): string {
  const changelogPath = join(dir, 'CHANGELOG.md');
  return existsSync(changelogPath) ? readFileSync(changelogPath, 'utf8') : '';
}

/**
 * Mock version updates for a package
 */
export function mockVersionUpdates(packagePath: string, newVersion: string): void {
  // Read the package.json
  const packageJsonPath = join(packagePath, 'package.json');
  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));

  // Update the version
  packageJson.version = newVersion;

  // Write the updated package.json
  writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2));
}

/**
 * Update the version in a Cargo.toml file
 */
export function updateCargoVersion(cargoPath: string, newVersion: string): void {
  // Simple implementation that replaces the version line
  // This avoids adding an external dependency on TOML parser for the test helpers
  const content = readFileSync(cargoPath, 'utf-8');
  const updatedContent = content.replace(/version\s*=\s*"[^"]+"/, `version = "${newVersion}"`);
  writeFileSync(cargoPath, updatedContent);
}
