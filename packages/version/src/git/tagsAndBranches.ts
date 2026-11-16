import { createGitCli, type Git } from '@releasekit/git';
import semver from 'semver';
import { StrictReachableError } from '../errors/strictReachableError.js';
import { escapeRegExp, resolveTagTemplate } from '../utils/formatting.js';
import { log } from '../utils/logging.js';
import { isStableTag } from '../utils/versionUtils.js';

export interface TagSearchOptions {
  versionPrefix?: string;
  tagTemplate?: string;
  packageSpecificTags?: boolean;
}

/** Empty `paths` counts every commit in the repository. */
export async function getCommitsLength(paths: string[], sinceTag?: string, git: Git = createGitCli()): Promise<number> {
  try {
    if (sinceTag && sinceTag.trim() !== '') {
      return await git.countCommits(`${sinceTag}..HEAD`, { paths });
    }

    const latestTag = await git.describeTags();
    if (!latestTag) {
      throw new Error('No names found, cannot describe anything.');
    }
    return await git.countCommits(`${latestTag}..HEAD`, { paths });
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
 * Unlike `getLatestTag`, which only sees bare semver tags, also finds per-package tags such as `pkg@vX.Y.Z` and
 * `release/vX.Y.Z`.
 */
export async function getNearestReachableTag(cwd?: string, git: Git = createGitCli()): Promise<string> {
  try {
    return (await git.describeTags(cwd)) ?? '';
  } catch {
    return '';
  }
}

async function listSemverTags(versionPrefix: string | undefined, git: Git, merged?: string): Promise<string[]> {
  const tags = await git.listTags({ sort: '-creatordate', merged, cwd: process.cwd() });
  return tags.filter((tag) => {
    if (!versionPrefix) {
      return semver.valid(tag) !== null;
    }
    return tag.startsWith(versionPrefix) && semver.valid(tag.slice(versionPrefix.length)) !== null;
  });
}

/** Sorted semantically, not chronologically, so a tag created out of order (e.g. v0.7.1 after v0.8.0) can't win. */
export async function getLatestTag(versionPrefix?: string, git: Git = createGitCli()): Promise<string> {
  try {
    const tags = await listSemverTags(versionPrefix, git, 'HEAD');

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
    log(`Failed to get latest tag: ${error instanceof Error ? error.message : String(error)}`, 'error');
    return '';
  }
}

export type TagSeries =
  | { packageName: string; versionPrefix?: string; options: TagSearchOptions }
  | { globalPrefix: string | undefined };

/**
 * For `strictReachable`, called once no tag in `series` is reachable from HEAD: fails when one exists anyway
 * (typically a shallow clone), rather than versioning from the manifest or full history.
 */
export async function assertNoUnreachableTags(series: TagSeries[], git: Git = createGitCli()): Promise<void> {
  for (const entry of series) {
    const [tag] =
      'globalPrefix' in entry
        ? await listSemverTags(entry.globalPrefix, git)
        : await listPackageTags(entry.packageName, entry.versionPrefix, entry.options, git);
    if (tag) {
      const subject = 'globalPrefix' in entry ? 'No release tag' : `No release tag for ${entry.packageName}`;
      throw new StrictReachableError(
        `${subject} is reachable from the current commit, but '${tag}' exists. ` +
          `If the checkout is shallow, fetch the full history (fetch-depth: 0). ` +
          `To version from the manifest instead, set strictReachable to false.`,
      );
    }
  }
}

/** Global tags (e.g. `v1.2.0`), most-recently-created first, whether or not they're reachable from HEAD. */
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
 * Most-recently-created first, limited to tags reachable from `merged` when given; `[]` when package-specific
 * tags are disabled (callers fall back to the global series).
 */
export async function listPackageTags(
  packageName: string,
  versionPrefix?: string,
  options?: TagSearchOptions,
  git: Git = createGitCli(),
  merged?: string,
): Promise<string[]> {
  const packageSpecificTags = options?.packageSpecificTags ?? false;
  const tagTemplate = resolveTagTemplate(options?.tagTemplate, packageSpecificTags);

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
    allTags = await git.listTags({ sort: '-creatordate', merged, cwd: process.cwd() });
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
    const packageTags = await listPackageTags(packageName, versionPrefix, options, git, 'HEAD');
    if (packageTags.length > 0) {
      log(`Found ${packageTags.length} package tags using configured pattern`, 'debug');
      log(`Using most recently created tag: ${packageTags[0]}`, 'debug');
      return packageTags[0];
    }
    log('No matching tags found for configured tag pattern', 'debug');
    return '';
  } catch (error) {
    log(
      `Failed to get latest tag for package ${packageName}: ${error instanceof Error ? error.message : String(error)}`,
      'error',
    );
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
    const packageTags = await listPackageTags(packageName, versionPrefix, options, git, 'HEAD');
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

export async function getLatestStableTag(versionPrefix?: string, git: Git = createGitCli()): Promise<string> {
  try {
    const tags = await listSemverTags(versionPrefix, git, 'HEAD');
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
