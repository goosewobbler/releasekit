import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export function createPackageJson(dir: string, name: string, version = '0.1.0') {
  const packageJson = {
    name,
    version,
  };

  writeFileSync(join(dir, 'package.json'), JSON.stringify(packageJson, null, 2));

  writeFileSync(join(dir, 'index.js'), 'console.log("Hello from package");');
}

export function getPackageVersion(dir: string, pkgName?: string): string {
  if (!pkgName) {
    return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf-8')).version;
  }

  const possiblePaths = [join(dir, 'packages', pkgName, 'package.json'), join(dir, pkgName, 'package.json')];

  for (const path of possiblePaths) {
    if (existsSync(path)) {
      return JSON.parse(readFileSync(path, 'utf-8')).version;
    }
  }

  throw new Error(`No package.json found for ${pkgName} in ${dir}`);
}

export function readChangelog(dir: string): string {
  const changelogPath = join(dir, 'CHANGELOG.md');
  return existsSync(changelogPath) ? readFileSync(changelogPath, 'utf8') : '';
}

export function mockVersionUpdates(packagePath: string, newVersion: string): void {
  const packageJsonPath = join(packagePath, 'package.json');
  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));

  packageJson.version = newVersion;

  writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2));
}

export function updateCargoVersion(cargoPath: string, newVersion: string): void {
  // A regex rather than a TOML parser keeps the test helpers dependency-free.
  const content = readFileSync(cargoPath, 'utf-8');
  const updatedContent = content.replace(/version\s*=\s*"[^"]+"/, `version = "${newVersion}"`);
  writeFileSync(cargoPath, updatedContent);
}
