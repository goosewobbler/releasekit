import * as fs from 'node:fs';
import type { CargoManifest } from '@releasekit/config';
import { parseCargoToml } from '@releasekit/config';
import * as TOML from 'smol-toml';
import { createPublishError, PublishErrorCode } from '../errors/index.js';

export type { CargoManifest };
export { parseCargoToml };

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
