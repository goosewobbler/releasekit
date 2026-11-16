import { createGitCli, type Git } from '@releasekit/git';
import semver from 'semver';
import { escapeRegExp } from '../utils/formatting.js';
import { log } from '../utils/logging.js';
import { getVersionFromManifests } from '../utils/manifestHelpers.js';
import { versionFromTag } from '../utils/versionAction.js';

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
  const tagVersion = versionFromTag(latestTag);
  if (!manifest.version || !tagVersion || !semver.valid(manifest.version) || !semver.gt(manifest.version, tagVersion)) {
    return undefined;
  }

  let output: string;
  try {
    // The newest commit that added or removed a line holding exactly this version (not `1.3.0-beta.1` for `1.3.0`).
    output = await git.log({
      range: `${latestTag}..HEAD`,
      format: '%H%x1f%s',
      extraArgs: ['-1', `-G(^|[^0-9.])${escapeRegExp(manifest.version)}($|[^-+.0-9A-Za-z])`],
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
