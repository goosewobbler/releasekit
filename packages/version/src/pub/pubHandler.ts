import fs from 'node:fs';
import path from 'node:path';
import { isPubspecYaml, parsePubspec } from '@releasekit/config';
import { addPackageUpdate, recordPendingWrite } from '../utils/jsonOutput.js';
import { log } from '../utils/logging.js';

export { isPubspecYaml };

export interface PubInfo {
  name: string;
  version: string;
  path: string;
  dir: string;
}

export function getPubInfo(pubspecPath: string): PubInfo {
  if (!fs.existsSync(pubspecPath)) {
    log(`pubspec.yaml not found at: ${pubspecPath}`, 'error');
    throw new Error(`pubspec.yaml not found at: ${pubspecPath}`);
  }

  try {
    const pubspec = parsePubspec(pubspecPath);

    if (!pubspec.name) {
      log(`Package name not found in: ${pubspecPath}`, 'error');
      throw new Error(`Package name not found in: ${pubspecPath}`);
    }

    return {
      name: pubspec.name,
      version: pubspec.version ?? '0.0.0',
      path: pubspecPath,
      dir: path.dirname(pubspecPath),
    };
  } catch (error) {
    log(`Error reading pubspec.yaml: ${pubspecPath}`, 'error');
    if (error instanceof Error) {
      log(error.message, 'error');
      throw error;
    }
    throw new Error(`Failed to process pubspec.yaml at ${pubspecPath}`);
  }
}

export function updatePubVersion(pubspecPath: string, version: string, dryRun = false): void {
  try {
    const content = fs.readFileSync(pubspecPath, 'utf-8');
    const pubspec = parsePubspec(pubspecPath, content);
    const packageName = pubspec.name;

    if (!packageName) {
      throw new Error(`No package name found in ${pubspecPath}`);
    }

    // Replace the entire version line. Flutter build numbers (e.g. `1.0.0+1`) are
    // intentionally dropped — ReleaseKit manages the SemVer portion only.
    const updatedContent = content.replace(/^(version:\s*)\S+(\s+#.*)?$/m, `$1${version}$2`);

    if (updatedContent === content && !pubspec.version) {
      throw new Error(`No version field found in ${pubspecPath}`);
    }

    if (dryRun) {
      recordPendingWrite(pubspecPath, updatedContent);
    } else {
      fs.writeFileSync(pubspecPath, updatedContent);
    }

    addPackageUpdate(packageName, version, pubspecPath);
    log(
      `${dryRun ? '[DRY RUN] Would update' : 'Updated'} pubspec.yaml at ${pubspecPath} to version ${version}`,
      'success',
    );
  } catch (error) {
    log(`Failed to update pubspec.yaml at ${pubspecPath}`, 'error');
    if (error instanceof Error) {
      log(error.message, 'error');
    }
    throw error;
  }
}
