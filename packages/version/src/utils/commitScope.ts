import path from 'node:path';
import { isPathWithinRoot } from '@releasekit/core';
import { VersionError, VersionErrorCode } from '../errors/versionError.js';
import type { Config } from '../types.js';
import { type NativeManifestOptions, nativeManifestsToBump } from './manifestUpdates.js';

export interface CommitScopeOptions extends Pick<NativeManifestOptions, 'repoRoot' | 'ignorePaths'> {
  /** Directories of packages that release on their own; defaults to `config.releasablePackageDirs`. */
  releasableDirs?: string[];
}

/**
 * Git pathspecs for the commits that belong to a package: its directory and the native manifests it versions
 * through `cargo.paths` / `pub.paths`, minus nested packages that release on their own. A nested package that
 * doesn't (a private one) ships inside this one, so its commits count. Absolute, so they resolve from any cwd.
 */
export function packageCommitScope(
  pkgDir: string,
  config: Pick<Config, 'cargo' | 'pub' | 'releasablePackageDirs'>,
  { releasableDirs = config.releasablePackageDirs ?? [], ...manifestOptions }: CommitScopeOptions = {},
): string[] {
  const dir = path.resolve(pkgDir);
  const manifestDirs = nativeManifestsToBump(dir, config, manifestOptions).map((m) => path.dirname(m));
  const included = [...new Set([dir, ...manifestDirs])];
  // A crate the package versions can also be discovered as a package of its own (a Tauri `src-tauri`).
  const nested = releasableDirs
    .map((d) => path.resolve(d))
    .filter((d) => !included.includes(d) && included.some((i) => isPathWithinRoot(i, d)))
    .map((d) => `:(exclude)${d}`);
  return [...included, ...nested];
}

/**
 * {@link packageCommitScope}, falling back to the package's own manifests when a `paths` entry leaves the
 * repository. That error is returned rather than thrown, so a caller raises it only for a package that releases.
 */
export function resolveCommitScope(
  pkgDir: string,
  config: Pick<Config, 'cargo' | 'pub' | 'releasablePackageDirs'>,
  options: CommitScopeOptions = {},
): { scope: string[]; pathsError?: VersionError } {
  try {
    return { scope: packageCommitScope(pkgDir, config, options) };
  } catch (error) {
    if (!(error instanceof VersionError && error.code === VersionErrorCode.UNSAFE_CONFIG_PATH)) {
      throw error;
    }
    return { scope: packageCommitScope(pkgDir, config, { ...options, ignorePaths: true }), pathsError: error };
  }
}
