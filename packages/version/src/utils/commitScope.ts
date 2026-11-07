import path from 'node:path';
import { isPathWithinRoot } from '@releasekit/core';
import type { Config } from '../types.js';
import { log } from './logging.js';
import { type NativeManifestOptions, nativeManifestsToBump } from './manifestUpdates.js';

export interface CommitScopeOptions extends Pick<NativeManifestOptions, 'repoRoot' | 'ignorePaths'> {
  /** Defaults to every package in `config.allWorkspacePackages`; `[]` keeps nested packages' commits in scope. */
  workspaceDirs?: string[];
}

/**
 * Git pathspecs for the commits that belong to a package: its directory and the native manifests it versions
 * through `cargo.paths` / `pub.paths`, minus packages nested inside it. Absolute, so they resolve from any cwd.
 */
export function packageCommitScope(
  pkgDir: string,
  config: Pick<Config, 'cargo' | 'pub' | 'allWorkspacePackages'>,
  { workspaceDirs = config.allWorkspacePackages?.map((p) => p.dir) ?? [], ...manifestOptions }: CommitScopeOptions = {},
): string[] {
  const dir = path.resolve(pkgDir);
  const included = [...new Set([dir, ...manifestDirs(dir, config, manifestOptions)])];
  // A crate the package versions can also be discovered as a package of its own (a Tauri `src-tauri`).
  const nested = workspaceDirs
    .map((d) => path.resolve(d))
    .filter((d) => !included.includes(d) && included.some((i) => isPathWithinRoot(i, d)))
    .map((d) => `:(exclude)${d}`);
  return [...included, ...nested];
}

function manifestDirs(dir: string, config: Pick<Config, 'cargo' | 'pub'>, options: NativeManifestOptions): string[] {
  try {
    return nativeManifestsToBump(dir, config, options).map((m) => path.dirname(m));
  } catch (error) {
    // A `paths` entry that leaves the repository fails the bump itself, so scoping only needs to not throw for a
    // package that isn't bumped.
    log(`Commit scope for ${dir} ignores native manifest paths: ${(error as Error).message}`, 'debug');
    return [];
  }
}
