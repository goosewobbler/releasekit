import semver from 'semver';
import type { Config } from '../types.js';
import { log } from '../utils/logging.js';
import { getVersionFromManifests } from '../utils/manifestHelpers.js';
import { versionFromTag } from '../utils/versionAction.js';

/** A version a merged release set on the branch that never got its tag, because its publish failed or was refused. */
export interface StrandedRelease {
  version: string;
}

/**
 * Only a package the last release's failure report lists as unpublished can be stranded. Without `name` (a sync
 * release), any listed package strands the whole release.
 */
export function findStrandedRelease(
  config: Config,
  name: string | undefined,
  pkgDir: string,
  latestTag: string,
): StrandedRelease | undefined {
  const { unpublished } = config;
  const listed =
    unpublished === 'all' || (name === undefined ? (unpublished?.length ?? 0) > 0 : !!unpublished?.includes(name));
  if (!listed) {
    return undefined;
  }

  const { version } = getVersionFromManifests(pkgDir);
  const tagVersion = versionFromTag(latestTag);
  if (!version || !tagVersion || !semver.valid(version) || !semver.gt(version, tagVersion)) {
    return undefined;
  }

  log(`${version} never shipped, so ${name ?? 'the release'} is versioned from ${latestTag}`, 'info');
  return { version };
}
