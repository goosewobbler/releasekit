import * as fs from 'node:fs';
import * as path from 'node:path';
import { isPathWithinRoot } from '@releasekit/core';
import { isVersionedCrate } from '../cargo/cargoHandler.js';
import { updatePackageVersion } from '../package/packageManagement.js';
import { isReleasablePubspec } from '../pub/pubHandler.js';
import type { Config } from '../types.js';
import { resolveConfinedManifestPath } from './confinedPath.js';
import { log } from './logging.js';

interface ManifestKind {
  file: 'Cargo.toml' | 'pubspec.yaml';
  config: Config['cargo'] | Config['pub'];
  isVersionedPackage: (manifestPath: string) => boolean;
}

export interface NativeManifestOptions {
  dryRun?: boolean;
  repoRoot?: string;
  /** The package a manifest in `packageDir` belongs to, so its update matches the package's tag and changelog. */
  recordAs?: string;
  /** Flags a manifest in `packageDir` as the workspace root's. */
  isRoot?: boolean;
  /** Group members are package-keyed, so `cargo.paths` and `pub.paths` don't apply to them. */
  ignorePaths?: boolean;
  /** The sync root pass resolves member-relative `paths` from the root, where an entry like `../x` leaves the repo. */
  skipPathsOutsideRepo?: boolean;
}

function manifestKinds(config: Pick<Config, 'cargo' | 'pub'>): ManifestKind[] {
  return [
    { file: 'Cargo.toml', config: config.cargo, isVersionedPackage: isVersionedCrate },
    { file: 'pubspec.yaml', config: config.pub, isVersionedPackage: isReleasablePubspec },
  ];
}

export function nativeManifestsToBump(
  packageDir: string,
  config: Pick<Config, 'cargo' | 'pub'>,
  options: NativeManifestOptions = {},
): string[] {
  return manifestKinds(config).flatMap((kind) => locateManifests(packageDir, kind, options));
}

export function updateNativeManifests(
  packageDir: string,
  version: string,
  config: Pick<Config, 'cargo' | 'pub'>,
  options: NativeManifestOptions = {},
): string[] {
  const { dryRun = false, recordAs, isRoot } = options;
  const manifestPaths = nativeManifestsToBump(packageDir, config, options);
  for (const manifestPath of manifestPaths) {
    // A manifest elsewhere (via `paths`) keeps an update of its own, so it mustn't share the package's name.
    const record = isInPackageDir(manifestPath, packageDir) ? { recordAs, isRoot } : {};
    updatePackageVersion(manifestPath, version, dryRun, record);
  }
  return manifestPaths;
}

export function isInPackageDir(manifestPath: string, packageDir: string): boolean {
  return path.resolve(path.dirname(manifestPath)) === path.resolve(packageDir);
}

/** Only a manifest in the package's own directory counts: one reached through `paths` is another update. */
export function hasManifestToBump(
  packageDir: string,
  config: Pick<Config, 'npm' | 'cargo' | 'pub'>,
  options: NativeManifestOptions = {},
): boolean {
  if (config.npm?.enabled !== false && fs.existsSync(path.join(packageDir, 'package.json'))) {
    return true;
  }
  return nativeManifestsToBump(packageDir, config, options).some((manifestPath) =>
    isInPackageDir(manifestPath, packageDir),
  );
}

/** {@link hasManifestToBump}, warning that a package about to release won't. */
export function checkManifestToBump(
  name: string,
  packageDir: string,
  config: Pick<Config, 'npm' | 'cargo' | 'pub'>,
  options: NativeManifestOptions = {},
): boolean {
  if (hasManifestToBump(packageDir, config, options)) {
    return true;
  }
  log(`Not releasing ${name}: it has no manifest releasekit can bump`, 'warning');
  return false;
}

function locateManifests(
  packageDir: string,
  kind: ManifestKind,
  { repoRoot = process.cwd(), ignorePaths = false, skipPathsOutsideRepo = false }: NativeManifestOptions,
): string[] {
  if (kind.config?.enabled === false) {
    return [];
  }

  const configuredPaths = ignorePaths ? [] : (kind.config?.paths ?? []);
  const candidates =
    configuredPaths.length > 0
      ? configuredPaths.flatMap((p) => {
          if (skipPathsOutsideRepo && !isPathWithinRoot(repoRoot, path.resolve(packageDir, p, kind.file))) {
            log(`Skipping ${kind.file} path ${p} for ${packageDir}: it resolves outside the repository`, 'debug');
            return [];
          }
          return [resolveConfinedManifestPath(repoRoot, packageDir, p, kind.file)];
        })
      : [path.join(packageDir, kind.file)];

  return candidates.filter((manifestPath) => {
    if (!fs.existsSync(manifestPath)) {
      return false;
    }
    if (!kind.isVersionedPackage(manifestPath)) {
      log(`Skipping ${manifestPath}: not a package releasekit versions`, 'debug');
      return false;
    }
    return true;
  });
}
