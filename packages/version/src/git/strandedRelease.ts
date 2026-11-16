import { createGitCli, type Git } from '@releasekit/git';
import semver from 'semver';
import { log } from '../utils/logging.js';
import { getVersionFromManifests } from '../utils/manifestHelpers.js';

const RELEASE_COMMIT_PREFIX = 'chore: release ';

/** A version a release commit set on the branch that never got its tag, such as after a failed publish. */
export interface StrandedRelease {
  version: string;
  /** The release commit that set it. */
  commit: string;
}

/** A package is stranded when its manifest version is ahead of `latestTag` and a release commit set it. */
export async function findStrandedRelease(
  pkgDir: string,
  latestTag: string,
  git: Git = createGitCli(),
): Promise<StrandedRelease | undefined> {
  const manifest = getVersionFromManifests(pkgDir);
  const tagVersion = semver.valid(latestTag.match(/\d{1,16}\.\d{1,16}\.\d{1,16}(?:-[0-9A-Za-z.-]{1,256})?$/)?.[0]);
  if (!manifest.version || !tagVersion || !semver.valid(manifest.version) || !semver.gt(manifest.version, tagVersion)) {
    return undefined;
  }

  let output: string;
  try {
    // `-S`: the newest commit that added or removed the version string, so the one that set it.
    output = await git.log({
      range: `${latestTag}..HEAD`,
      format: '%H%x1f%s',
      extraArgs: ['-1', `-S${manifest.version}`],
      paths: [manifest.manifestPath],
      cwd: pkgDir,
    });
  } catch (error) {
    log(
      `Could not find the commit that set ${manifest.version}: ${error instanceof Error ? error.message : String(error)}`,
      'debug',
    );
    return undefined;
  }

  const [commit, subject] = output.trim().split('\x1f');
  if (!commit || !subject?.startsWith(RELEASE_COMMIT_PREFIX)) {
    return undefined;
  }

  log(
    `${manifest.version} was released by ${commit.slice(0, 7)} but never tagged; versioning from ${latestTag}`,
    'info',
  );
  return { version: manifest.version, commit };
}
