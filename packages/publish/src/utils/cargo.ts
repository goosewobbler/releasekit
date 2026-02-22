import * as fs from 'node:fs';
import * as TOML from 'smol-toml';
import { createPublishError, PublishErrorCode } from '../errors/index.js';

export interface CargoManifest {
  package?: { name?: string; version?: string; [key: string]: unknown };
  dependencies?: Record<string, unknown>;
  [key: string]: unknown;
}

export function parseCargoToml(cargoPath: string): CargoManifest {
  const content = fs.readFileSync(cargoPath, 'utf-8');
  return TOML.parse(content) as CargoManifest;
}

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
