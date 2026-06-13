import * as fs from 'node:fs';
import * as path from 'node:path';
import * as yaml from 'yaml';

export interface PubspecManifest {
  name?: string;
  version?: string;
  publish_to?: string;
  environment?: Record<string, unknown>;
  [key: string]: unknown;
}

export function parsePubspec(pubspecPath: string, content?: string): PubspecManifest {
  const src = content ?? fs.readFileSync(pubspecPath, 'utf-8');
  // yaml.parse returns null for an empty or comment-only document; normalise to an
  // empty manifest so callers get clear "missing name/version" errors rather than a
  // cryptic "Cannot read properties of null".
  return (yaml.parse(src) ?? {}) as PubspecManifest;
}

export function isPubspecYaml(filePath: string): boolean {
  return path.basename(filePath) === 'pubspec.yaml';
}
