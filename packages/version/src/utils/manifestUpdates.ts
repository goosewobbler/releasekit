import * as fs from 'node:fs';
import * as path from 'node:path';
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
  /** Package name for its own manifests, so their update matches its tag and changelog. */
  recordAs?: string;
  isRoot?: boolean;
  /** Group mode bumps only a package's own manifests, ignoring `cargo.paths` and `pub.paths`. */
  ignorePaths?: boolean;
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
    // A manifest reached through `paths` is its own update, so it keeps its own name.
    const record = isInPackageDir(manifestPath, packageDir) ? { recordAs, isRoot } : {};
    updatePackageVersion(manifestPath, version, dryRun, record);
  }
  return manifestPaths;
}

function isInPackageDir(manifestPath: string, packageDir: string): boolean {
  return path.resolve(path.dirname(manifestPath)) === path.resolve(packageDir);
}

export function hasManifestToBump(
  packageDir: string,
  config: Pick<Config, 'npm' | 'cargo' | 'pub'>,
  options: NativeManifestOptions = {},
): boolean {
  if (config.npm?.enabled !== false && fs.existsSync(path.join(packageDir, 'package.json'))) {
    return true;
  }
  return nativeManifestsToBump(packageDir, config, options).length > 0;
}

/** {@link hasManifestToBump}, plus a warning when the package won't release. */
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
  { repoRoot = process.cwd(), ignorePaths = false }: NativeManifestOptions,
): string[] {
  if (kind.config?.enabled === false) {
    return [];
  }

  const configuredPaths = ignorePaths ? [] : (kind.config?.paths ?? []);
  const candidates =
    configuredPaths.length > 0
      ? configuredPaths.map((p) => resolveConfinedManifestPath(repoRoot, packageDir, p, kind.file))
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
