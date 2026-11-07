import path from 'node:path';
import { isPathWithinRoot } from '@releasekit/core';
import type { Config } from '../types.js';
import { type NativeManifestOptions, nativeManifestsToBump } from './manifestUpdates.js';

type ScopeConfig = Pick<Config, 'cargo' | 'pub' | 'releasablePackageDirs'>;

export interface CommitScopeOptions extends Pick<NativeManifestOptions, 'repoRoot' | 'ignorePaths'> {
  releasableDirs?: string[];
}

export interface CommitScope {
  /** Git pathspecs, absolute so they resolve from any cwd. */
  scope: string[];
  /** The first native manifest that couldn't be located or parsed, left out of `scope`. Raise it only for a package
   *  that releases. */
  pathsError?: Error;
}

/**
 * The commits that belong to a package: its directory and the native manifests it versions through
 * `cargo.paths` / `pub.paths`, minus nested packages that release on their own (one that doesn't ships inside it).
 */
export function resolveCommitScope(
  pkgDir: string,
  config: ScopeConfig,
  { releasableDirs = config.releasablePackageDirs ?? [], ...manifestOptions }: CommitScopeOptions = {},
): CommitScope {
  const dir = path.resolve(pkgDir);
  const { dirs: included, error } = ownedDirs(dir, config, manifestOptions);
  // A crate this package versions may also be discovered as a package (a Tauri `src-tauri`); it stays in scope.
  const nested = releasableDirs
    .map((d) => path.resolve(d))
    .filter((d) => !included.includes(d) && included.some((i) => isPathWithinRoot(i, d)))
    .map((d) => `:(exclude)${d}`);
  return { scope: [...included, ...nested], ...(error ? { pathsError: error } : {}) };
}

function ownedDirs(
  dir: string,
  config: ScopeConfig,
  options: NativeManifestOptions,
): { dirs: string[]; error?: Error } {
  const dirs = new Set([dir]);
  let error: Error | undefined;
  for (const lookup of manifestLookups(config, options.ignorePaths)) {
    try {
      for (const manifest of nativeManifestsToBump(dir, lookup, options)) {
        dirs.add(path.dirname(manifest));
      }
    } catch (e) {
      error ??= e instanceof Error ? e : new Error(String(e));
    }
  }
  return { dirs: [...dirs], ...(error ? { error } : {}) };
}

/** One lookup per configured entry, so an entry that fails doesn't drop the others. */
function manifestLookups(config: ScopeConfig, ignorePaths = false): Array<Pick<Config, 'cargo' | 'pub'>> {
  const cargoPaths = ignorePaths ? [] : (config.cargo?.paths ?? []);
  const pubPaths = ignorePaths ? [] : (config.pub?.paths ?? []);
  const cargo = (paths: string[]) => ({ cargo: { ...config.cargo, paths }, pub: { enabled: false } });
  const pub = (paths: string[]) => ({ pub: { ...config.pub, paths }, cargo: { enabled: false } });
  return [
    ...(cargoPaths.length > 0 ? cargoPaths.map((p) => cargo([p])) : [cargo([])]),
    ...(pubPaths.length > 0 ? pubPaths.map((p) => pub([p])) : [pub([])]),
  ];
}
