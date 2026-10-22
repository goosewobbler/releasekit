import * as fs from 'node:fs';
import * as path from 'node:path';
import * as TOML from 'smol-toml';

export interface CargoManifest {
  package?: { name?: string; version?: string; publish?: boolean | string[]; [key: string]: unknown };
  workspace?: { members?: string[]; [key: string]: unknown };
  dependencies?: Record<string, unknown>;
  [key: string]: unknown;
}

export function parseCargoToml(cargoPath: string): CargoManifest {
  const content = fs.readFileSync(cargoPath, 'utf-8');
  return TOML.parse(content) as CargoManifest;
}

/** False for `publish = false` or `publish = []`, which keep a crate off every registry. */
export function isCratePublishable(manifest: CargoManifest): boolean {
  const publish = manifest.package?.publish;
  return publish !== false && !(Array.isArray(publish) && publish.length === 0);
}

export function isCargoToml(filePath: string): boolean {
  return path.basename(filePath) === 'Cargo.toml';
}
