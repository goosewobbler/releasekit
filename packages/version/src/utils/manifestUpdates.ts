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
  /** The package the manifests belong to, so their update matches its tag and changelog. */
  recordAs?: string;
  /** Group members are package-keyed, so `cargo.paths` and `pub.paths` don't apply to them. */
  ignorePaths?: boolean;
}

/** Bumps the Cargo.toml and pubspec.yaml beside a package, or at its configured `paths`. */
export function updateNativeManifests(
  packageDir: string,
  version: string,
  config: Pick<Config, 'cargo' | 'pub'>,
  options: NativeManifestOptions = {},
): string[] {
  const kinds: ManifestKind[] = [
    { file: 'Cargo.toml', config: config.cargo, isVersionedPackage: isVersionedCrate },
    { file: 'pubspec.yaml', config: config.pub, isVersionedPackage: isReleasablePubspec },
  ];
  return kinds.flatMap((kind) => updateManifests(packageDir, version, kind, options));
}

function updateManifests(
  packageDir: string,
  version: string,
  kind: ManifestKind,
  { dryRun = false, repoRoot = process.cwd(), recordAs, ignorePaths = false }: NativeManifestOptions,
): string[] {
  if (kind.config?.enabled === false) {
    return [];
  }

  const configuredPaths = ignorePaths ? undefined : kind.config?.paths;
  const manifestPaths =
    configuredPaths && configuredPaths.length > 0
      ? configuredPaths.map((p) => resolveConfinedManifestPath(repoRoot, packageDir, p, kind.file))
      : [path.join(packageDir, kind.file)];

  const updatedFiles: string[] = [];
  for (const manifestPath of manifestPaths) {
    if (!fs.existsSync(manifestPath)) {
      continue;
    }
    if (!kind.isVersionedPackage(manifestPath)) {
      log(`Skipping ${manifestPath}: not a package releasekit versions`, 'debug');
      continue;
    }
    updatePackageVersion(manifestPath, version, dryRun, { recordAs });
    updatedFiles.push(manifestPath);
  }
  return updatedFiles;
}
