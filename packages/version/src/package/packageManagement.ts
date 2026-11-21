import fs from 'node:fs';
import { isCargoToml, updateCargoVersion } from '../cargo/cargoHandler.js';
import { isPubspecYaml, updatePubVersion } from '../pub/pubHandler.js';
import { addPackageUpdate, writeVersionFile } from '../utils/jsonOutput.js';
import { log } from '../utils/logging.js';

export interface UpdatePackageVersionOptions {
  /** A workspace-root manifest, bumped in lockstep (sync mode). */
  isRoot?: boolean;
  /** Records a Cargo.toml or pubspec.yaml update under this name rather than the manifest's own. */
  recordAs?: string;
}

/** Returns false when it leaves the manifest as it is. */
export function updatePackageVersion(
  packagePath: string,
  version: string,
  dryRun = false,
  { isRoot = false, recordAs }: UpdatePackageVersionOptions = {},
): boolean {
  if (isCargoToml(packagePath)) {
    return updateCargoVersion(packagePath, version, dryRun, { recordAs, isRoot });
  }

  if (isPubspecYaml(packagePath)) {
    updatePubVersion(packagePath, version, dryRun, { recordAs, isRoot });
    return true;
  }

  try {
    const packageContent = fs.readFileSync(packagePath, 'utf8');
    const packageJson = JSON.parse(packageContent);
    const packageName = packageJson.name;

    const updatedContent = `${JSON.stringify({ ...packageJson, version }, null, 2)}\n`;
    writeVersionFile(packagePath, updatedContent, dryRun);

    addPackageUpdate(packageName, version, packagePath, isRoot);

    log(
      `${dryRun ? '[DRY RUN] Would update' : 'Updated'} package.json at ${packagePath} to version ${version}`,
      'success',
    );
    return true;
  } catch (error) {
    log(`Failed to update package.json at ${packagePath}`, 'error');
    if (error instanceof Error) {
      log(error.message, 'error');
    }
    throw error;
  }
}
