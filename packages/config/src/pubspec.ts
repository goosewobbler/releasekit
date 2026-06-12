import * as fs from 'node:fs';
import * as path from 'node:path';
import * as yaml from 'yaml';

export interface PubspecManifest {
  name?: string;
  version?: string;
  environment?: Record<string, unknown>;
  [key: string]: unknown;
}

export function parsePubspec(pubspecPath: string): PubspecManifest {
  const content = fs.readFileSync(pubspecPath, 'utf-8');
  return yaml.parse(content) as PubspecManifest;
}

export function isPubspecYaml(filePath: string): boolean {
  return path.basename(filePath) === 'pubspec.yaml';
}
