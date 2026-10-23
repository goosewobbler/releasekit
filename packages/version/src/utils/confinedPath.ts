import path from 'node:path';
import { isPathWithinRoot } from '@releasekit/core';
import { createVersionError, VersionErrorCode } from '../errors/versionError.js';

/** Rejects a `..` or absolute entry that would let config rewrite a manifest outside the repository. */
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
