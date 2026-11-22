import * as fs from 'node:fs';
import * as path from 'node:path';
import * as TOML from 'smol-toml';

export interface CargoManifest {
  package?: { name?: string; version?: string; publish?: boolean | string[]; [key: string]: unknown };
  workspace?: { members?: string[]; [key: string]: unknown };
  dependencies?: Record<string, unknown>;
  [key: string]: unknown;
}

export function parseCargoToml(cargoPath: string, content?: string): CargoManifest {
  return TOML.parse(content ?? fs.readFileSync(cargoPath, 'utf-8')) as CargoManifest;
}

/** False for a virtual workspace manifest, which has no [package]. */
export function isCrateVersioned(
  manifest: CargoManifest,
): manifest is CargoManifest & { package: NonNullable<CargoManifest['package']> & { name: string } } {
  return !!manifest.package?.name;
}

export function isCratePublishable(manifest: CargoManifest): boolean {
  const publish = manifest.package?.publish;
  const noRegistries = Array.isArray(publish) && publish.length === 0;
  return publish !== false && !noRegistries;
}

export function isCargoToml(filePath: string): boolean {
  return path.basename(filePath) === 'Cargo.toml';
}
