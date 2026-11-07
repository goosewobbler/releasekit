import path from 'node:path';
import { isPathWithinRoot } from '@releasekit/core';
import type { Config } from '../types.js';
import { type NativeManifestOptions, nativeManifestsToBump } from './manifestUpdates.js';

export interface CommitScopeOptions extends Pick<NativeManifestOptions, 'repoRoot' | 'ignorePaths'> {
  /** Every package's directory, so a package nested inside this one is excluded. */
  workspaceDirs?: string[];
}

/**
 * Git pathspecs for the commits that belong to a package: its directory and the native manifests it versions
 * through `cargo.paths` / `pub.paths`, minus packages nested inside it. Absolute, so they resolve from any cwd.
 */
export function packageCommitScope(
  pkgDir: string,
  config: Pick<Config, 'cargo' | 'pub'>,
  { workspaceDirs = [], ...manifestOptions }: CommitScopeOptions = {},
): string[] {
  const dir = path.resolve(pkgDir);
  const manifestDirs = nativeManifestsToBump(dir, config, manifestOptions).map((m) => path.dirname(m));
  const included = [...new Set([dir, ...manifestDirs])];
  // A crate the package versions can also be discovered as a package of its own (a Tauri `src-tauri`).
  const nested = workspaceDirs
    .map((d) => path.resolve(d))
    .filter((d) => !included.includes(d) && included.some((i) => isPathWithinRoot(i, d)))
    .map((d) => `:(exclude)${d}`);
  return [...included, ...nested];
}
