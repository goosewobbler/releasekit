import { createGitCli, type Git } from '@releasekit/git';
import { getSemverTags } from 'git-semver-tags';
import semver from 'semver';
import { escapeRegExp } from '../utils/formatting.js';
import { log } from '../utils/logging.js';
import { isStableTag } from '../utils/versionUtils.js';

export interface TagSearchOptions {
  versionPrefix?: string;
  tagTemplate?: string;
  packageSpecificTags?: boolean;
}

export async function getCommitsLength(pkgRoot: string, sinceTag?: string, git: Git = createGitCli()): Promise<number> {
  try {
    if (sinceTag && sinceTag.trim() !== '') {
      return await git.countCommits(`${sinceTag}..HEAD`, { path: pkgRoot });
    }

    const latestTag = await git.describeTags();
    if (!latestTag) {
      throw new Error('No names found, cannot describe anything.');
    }
    return await git.countCommits(`${latestTag}..HEAD`, { path: pkgRoot });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log(`Failed to get number of commits since last tag: ${errorMessage}`, 'error');
    return 0;
  }
}

export function refExists(ref: string, cwd?: string, git: Git = createGitCli()): Promise<boolean> {
  if (!ref || ref.trim() === '') {
    return Promise.resolve(false);
  }
  return git.refExists(ref, cwd);
}

/**
 * Unlike `getLatestTag` (git-semver-tags, bare semver tags only), `git describe` also finds per-package
 * tags (`pkg@vX.Y.Z`, `release/vX.Y.Z`) and is reachable by construction, as a `<tag>..HEAD` floor needs.
 */
export async function getNearestReachableTag(cwd?: string, git: Git = createGitCli()): Promise<string> {
  try {
    return (await git.describeTags(cwd)) ?? '';
  } catch {
    return '';
  }
}

/** Sorted semantically, not chronologically, so a tag created out of order (e.g. v0.7.1 after v0.8.0) can't win. */
export async function getLatestTag(versionPrefix?: string): Promise<string> {
  try {
    const tags: string[] = await getSemverTags({
      tagPrefix: versionPrefix,
    });

    if (tags.length === 0) {
      return '';
    }

    const chronologicalLatest = tags[0];

    // semver.clean only strips a leading `v`/`=`; a multi-segment prefix like `release/v` would make every
    // tag '0.0.0' and the sort a no-op.
    const stripPrefix = (tag: string) =>
      versionPrefix && tag.startsWith(versionPrefix) ? tag.slice(versionPrefix.length) : tag;

    const sortedTags = [...tags].sort((a, b) => {
      const versionA = semver.clean(stripPrefix(a)) || '0.0.0';
      const versionB = semver.clean(stripPrefix(b)) || '0.0.0';
      return semver.rcompare(versionA, versionB);
    });

    const semanticLatest = sortedTags[0];

    if (semanticLatest !== chronologicalLatest) {
      log(
        `Tag ordering differs: chronological latest is ${chronologicalLatest}, semantic latest is ${semanticLatest}`,
        'debug',
      );
      log(`Using semantic latest (${semanticLatest}) to handle out-of-order tag creation`, 'info');
    }

    return semanticLatest;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log(`Failed to get latest tag: ${errorMessage}`, 'error');

    if (error instanceof Error && error.message.includes('No names found')) {
      log('No tags found in the repository.', 'info');
    }

    return '';
  }
}

/**
 * Global tags (e.g. `v1.2.0`), most-recently-created first. Lists `git tag` directly because
 * git-semver-tags only sees tags reachable from HEAD.
 */
export async function listGlobalTags(versionPrefix?: string, git: Git = createGitCli()): Promise<string[]> {
  let allTags: string[] = [];
  try {
    allTags = await git.listTags({ sort: '-creatordate', cwd: process.cwd() });
  } catch (error) {
    log(`Failed to list global tags: ${error instanceof Error ? error.message : String(error)}`, 'error');
    return [];
  }

  const escapedPrefix = versionPrefix ? escapeRegExp(versionPrefix) : '';
  const pattern = `^${escapedPrefix}(?:[0-9]+\\.[0-9]+\\.[0-9]+(?:-[a-zA-Z0-9.-]+)?)$`;
  const regex = new RegExp(pattern);
  return allTags.filter((tag) => regex.test(tag));
}

/**
 * Most-recently-created first; `[]` when package-specific tags are disabled (callers fall back to the
 * global series).
 */
export async function listPackageTags(
  packageName: string,
  versionPrefix?: string,
  options?: TagSearchOptions,
  git: Git = createGitCli(),
): Promise<string[]> {
  const packageSpecificTags = options?.packageSpecificTags ?? false;
  const tagTemplate =
    options?.tagTemplate || (packageSpecificTags ? `\${packageName}@\${prefix}\${version}` : `\${prefix}\${version}`);

  // @releasekit/version -> releasekit-version
  const sanitizedPackageName = packageName.startsWith('@') ? packageName.slice(1).replace(/\//g, '-') : packageName;
  const escapedPackageName = escapeRegExp(sanitizedPackageName);
  const escapedPrefix = versionPrefix ? escapeRegExp(versionPrefix) : '';

  log(
    `Looking for tags for package ${packageName} with prefix ${versionPrefix || 'none'}, packageSpecificTags: ${packageSpecificTags}`,
    'debug',
  );

  if (!packageSpecificTags) {
    log(`Package-specific tags disabled for ${packageName}, falling back to global tags`, 'debug');
    return [];
  }

  // Creation order, not semver order, so a stable patch (v0.2.1) created after a prerelease
  // (v0.3.0-next.4) counts as latest.
  let allTags: string[] = [];
  try {
    allTags = await git.listTags({ sort: '-creatordate', cwd: process.cwd() });
  } catch (err) {
    log(`Error getting tags: ${err instanceof Error ? err.message : String(err)}`, 'error');
  }

  log(`Retrieved ${allTags.length} tags`, 'debug');

  const packageTagPattern = escapeRegExp(tagTemplate)
    .replace(/\\\$\\\{packageName\\\}/g, `(?:${escapedPackageName})`)
    .replace(/\\\$\\\{prefix\\\}/g, `(?:${escapedPrefix})`)
    .replace(/\\\$\\\{version\\\}/g, '(?:[0-9]+\\.[0-9]+\\.[0-9]+(?:-[a-zA-Z0-9.-]+)?)');

  log(`Using package tag pattern: ${packageTagPattern}`, 'debug');

  const packageTagRegex = new RegExp(`^${packageTagPattern}$`);
  const packageTags = allTags.filter((tag) => packageTagRegex.test(tag));

  log(`Found ${packageTags.length} matching tags for ${packageName}`, 'debug');
  if (packageTags.length === 0) {
    if (allTags.length > 0) {
      log(`Available tags: ${allTags.join(', ')}`, 'debug');
    } else {
      log('No tags available in the repository', 'debug');
    }
  }
  return packageTags;
}

export async function getLatestTagForPackage(
  packageName: string,
  versionPrefix?: string,
  options?: TagSearchOptions,
  git: Git = createGitCli(),
): Promise<string> {
  try {
    const packageTags = await listPackageTags(packageName, versionPrefix, options, git);
    if (packageTags.length > 0) {
      log(`Found ${packageTags.length} package tags using configured pattern`, 'debug');
      log(`Using most recently created tag: ${packageTags[0]}`, 'debug');
      return packageTags[0];
    }
    log('No matching tags found for configured tag pattern', 'debug');
    return '';
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log(`Failed to get latest tag for package ${packageName}: ${errorMessage}`, 'error');

    if (error instanceof Error && error.message.includes('No names found')) {
      log(`No tags found for package ${packageName}.`, 'info');
    }

    return '';
  }
}

export async function getLatestStableTagForPackage(
  packageName: string,
  versionPrefix?: string,
  options?: TagSearchOptions,
  git: Git = createGitCli(),
): Promise<string> {
  try {
    const packageTags = await listPackageTags(packageName, versionPrefix, options, git);
    const stable = packageTags.find((tag) => isStableTag(tag));
    if (stable) {
      log(`Using most recently created stable tag for ${packageName}: ${stable}`, 'debug');
      return stable;
    }
    return '';
  } catch (error) {
    log(
      `Failed to get latest stable tag for package ${packageName}: ${error instanceof Error ? error.message : String(error)}`,
      'error',
    );
    return '';
  }
}

export async function getLatestStableTag(versionPrefix?: string): Promise<string> {
  try {
    const tags: string[] = await getSemverTags({ tagPrefix: versionPrefix });
    const stripPrefix = (tag: string) =>
      versionPrefix && tag.startsWith(versionPrefix) ? tag.slice(versionPrefix.length) : tag;

    const stableTags = tags.filter((tag) => {
      const cleaned = semver.clean(stripPrefix(tag));
      return cleaned ? semver.prerelease(cleaned) === null : false;
    });

    if (stableTags.length === 0) {
      return '';
    }

    const sorted = [...stableTags].sort((a, b) => {
      const va = semver.clean(stripPrefix(a)) || '0.0.0';
      const vb = semver.clean(stripPrefix(b)) || '0.0.0';
      return semver.rcompare(va, vb);
    });
    return sorted[0] ?? '';
  } catch (error) {
    log(`Failed to get latest stable tag: ${error instanceof Error ? error.message : String(error)}`, 'error');
    return '';
  }
}
