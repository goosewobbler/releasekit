import path from 'node:path';
import { isPathWithinRoot } from '@releasekit/core';
import { createVersionError, VersionErrorCode } from '../errors/versionError.js';

/**
 * Resolve a config-driven manifest location (`version.cargo.paths` / `version.pub.paths`) and confine
 * it to the repository root. A `..` or absolute-path entry that escapes the root would let a config
 * drive a version rewrite of a manifest outside the tree — reject it loudly rather than resolving out
 * of bounds.
 */
export function resolveConfinedManifestPath(
  repoRoot: string,
  packageDir: string,
  configuredPath: string,
  manifestFile: string,
): string {
  const resolved = path.resolve(packageDir, configuredPath, manifestFile);
  if (!isPathWithinRoot(repoRoot, resolved)) {
    throw createVersionError(
      VersionErrorCode.UNSAFE_CONFIG_PATH,
      `${resolved} is outside the repository root ${path.resolve(repoRoot)}`,
    );
  }
  return resolved;
}
