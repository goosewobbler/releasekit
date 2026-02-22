import * as fs from 'node:fs';
import * as path from 'node:path';
import * as TOML from 'smol-toml';

export interface CargoManifest {
  package?: { name?: string; version?: string; [key: string]: unknown };
  dependencies?: Record<string, unknown>;
  [key: string]: unknown;
}

export function parseCargoToml(cargoPath: string): CargoManifest {
  const content = fs.readFileSync(cargoPath, 'utf-8');
  return TOML.parse(content) as CargoManifest;
}

export function isCargoToml(filePath: string): boolean {
  return path.basename(filePath) === 'Cargo.toml';
}
