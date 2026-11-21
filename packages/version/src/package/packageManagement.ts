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

export function updatePackageVersion(
  packagePath: string,
  version: string,
  dryRun = false,
  { isRoot = false, recordAs }: UpdatePackageVersionOptions = {},
): void {
  if (isCargoToml(packagePath)) {
    updateCargoVersion(packagePath, version, dryRun, { recordAs, isRoot });
    return;
  }

  if (isPubspecYaml(packagePath)) {
    updatePubVersion(packagePath, version, dryRun, { recordAs, isRoot });
    return;
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
  } catch (error) {
    log(`Failed to update package.json at ${packagePath}`, 'error');
    if (error instanceof Error) {
      log(error.message, 'error');
    }
    throw error;
  }
}
