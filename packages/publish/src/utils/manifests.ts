import * as fs from 'node:fs';
import * as path from 'node:path';
import { debug, type VersionPackageUpdate } from '@releasekit/core';

type UpdateFiles = Pick<VersionPackageUpdate, 'filePath' | 'files'>;

export function updateManifests(update: UpdateFiles): string[] {
  return update.files ?? [update.filePath];
}

/**
 * The `fileName` manifest in an update's directory, if the version step bumped it: one it left alone would publish a
 * stale version. Older version output has no `files`, so any such manifest counts.
 */
export function findBumpedManifest(cwd: string, update: UpdateFiles, fileName: string): string | undefined {
  const manifestPath = path.join(path.dirname(path.resolve(cwd, update.filePath)), fileName);
  if (!fs.existsSync(manifestPath)) {
    return undefined;
  }
  if (update.files && !update.files.some((file) => path.basename(file) === fileName)) {
    debug(`Skipping ${manifestPath}: the version step didn't bump it`);
    return undefined;
  }
  return manifestPath;
}
