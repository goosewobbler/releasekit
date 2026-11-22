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
  // yaml.parse returns null for an empty or comment-only document; `{}` gives callers a
  // clear "missing name/version" error rather than "Cannot read properties of null".
  return (yaml.parse(src) ?? {}) as PubspecManifest;
}

/** False for a Dart workspace root, a versionless app manifest and a `publish_to: none` package. */
export function isPubspecReleasable(
  manifest: PubspecManifest,
): manifest is PubspecManifest & { name: string; version: string } {
  return !!manifest.name && typeof manifest.version === 'string' && manifest.publish_to !== 'none';
}

export function isPubspecYaml(filePath: string): boolean {
  return path.basename(filePath) === 'pubspec.yaml';
}
