import { getSemverTags } from 'git-semver-tags';
import semver from 'semver';
import { escapeRegExp } from '../utils/formatting.js';
import { log } from '../utils/logging.js';
import { isStableTag } from '../utils/versionUtils.js';
import { execAsync, execSync } from './commandExecutor.js';

/**
 * Options for getLatestTagForPackage
 */
export interface TagSearchOptions {
  versionPrefix?: string;
  tagTemplate?: string;
  packageSpecificTags?: boolean;
}

/**
 * Get the number of commits since the last tag for a specific package
 * @param pkgRoot Path to the package
 * @param sinceTag Optional specific tag to count commits since (instead of using git describe)
 * @returns Number of commits
 */
export function getCommitsLength(pkgRoot: string, sinceTag?: string): number {
  try {
    let amount: string;

    if (sinceTag && sinceTag.trim() !== '') {
      // Use the specific tag provided
      amount = execSync('git', ['rev-list', '--count', `${sinceTag}..HEAD`, pkgRoot])
        .toString()
        .trim();
    } else {
      // Fallback: find latest tag via git describe, then count commits since it
      const latestTag = execSync('git', ['describe', '--tags', '--abbrev=0']).toString().trim();
      amount = execSync('git', ['rev-list', '--count', 'HEAD', `^${latestTag}`, pkgRoot])
        .toString()
        .trim();
    }

    return Number(amount);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log(`Failed to get number of commits since last tag: ${errorMessage}`, 'error');
    return 0;
  }
}

/**
 * Get the latest semver tag from the repository sorted by semantic version
 * This function prioritizes semantic ordering over chronological ordering to handle
 * cases where tags were created out of order (e.g., v0.7.1 created after v0.8.0)
 * @param versionPrefix Optional version prefix to filter tags
 * @returns The semantically latest tag or empty string if none found
 */
export async function getLatestTag(versionPrefix?: string): Promise<string> {
  try {
    const tags: string[] = await getSemverTags({
      tagPrefix: versionPrefix,
    });

    if (tags.length === 0) {
      return '';
    }

    // Store chronological latest before sorting
    const chronologicalLatest = tags[0];

    // Strip the configured prefix before passing to `semver.clean`. semver only knows how to
    // strip a leading `v` (or `=`); a multi-segment prefix like `release/v` would otherwise
    // make every tag fall through to `'0.0.0'` and the sort becomes a stable no-op. This
    // mattered the moment we introduced multi-segment prefixes via `baselineTagTemplate`.
    const stripPrefix = (tag: string) =>
      versionPrefix && tag.startsWith(versionPrefix) ? tag.slice(versionPrefix.length) : tag;

    // Sort tags by semantic version (highest first)
    const sortedTags = [...tags].sort((a, b) => {
      const versionA = semver.clean(stripPrefix(a)) || '0.0.0';
      const versionB = semver.clean(stripPrefix(b)) || '0.0.0';
      return semver.rcompare(versionA, versionB); // Reverse compare (highest first)
    });

    const semanticLatest = sortedTags[0];

    // Log if there's a difference between semantic and chronological ordering
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

    // Check if the error specifically means no tags were found
    if (error instanceof Error && error.message.includes('No names found')) {
      log('No tags found in the repository.', 'info');
    }

    return ''; // Return empty string on error or no tags
  }
}

/**
 * List every global tag (e.g. `v1.2.0`) for repos that don't use package-specific tags — the whole
 * sync/single series, most-recently-created first. Lists `git tag` directly (not git-semver-tags,
 * which only sees tags reachable from HEAD) and filters by the global `${prefix}${version}` template,
 * mirroring {@link listPackageTags}' pattern construction. Returns `[]` on error or no match.
 * @param versionPrefix Optional prefix the tags carry (e.g. `v`); only matching tags are returned.
 */
export async function listGlobalTags(versionPrefix?: string): Promise<string[]> {
  let allTags: string[] = [];
  try {
    allTags = execSync('git', ['tag', '--sort=-creatordate'], { cwd: process.cwd() })
      .toString()
      .trim()
      .split('\n')
      .filter((tag) => tag.length > 0);
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
 * Get the name of the last merged branch matching the specified patterns
 * @param branches Branch patterns to match
 * @param baseBranch Base branch to check merges against
 * @returns Branch name or null if not found
 */
export async function lastMergeBranchName(branches: string[], baseBranch: string): Promise<string | null> {
  try {
    // Escape special regex characters in branch patterns
    const escapedBranches = branches.map((branch) => escapeRegExp(branch));
    const branchesRegex = `${escapedBranches.join('/(.*)|')}/(.*)`;

    const { stdout } = await execAsync('git', [
      'for-each-ref',
      '--sort=-committerdate',
      '--format=%(refname:short)',
      'refs/heads',
      `--merged=${baseBranch}`,
    ]);

    const regex = new RegExp(branchesRegex, 'i');
    const matched = stdout
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .find((b) => regex.test(b));
    return matched ?? null;
  } catch (error) {
    console.error('Error while getting the last branch name:', error instanceof Error ? error.message : String(error));
    return null;
  }
}

/**
 * List a package's tags (those matching its tag template), most-recently-created first.
 *
 * Returns an empty array when package-specific tags are disabled (callers fall back to the global
 * tag series) or when nothing matches. Shared by the latest-tag and latest-stable-tag lookups.
 */
export async function listPackageTags(
  packageName: string,
  versionPrefix?: string,
  options?: TagSearchOptions,
): Promise<string[]> {
  const packageSpecificTags = options?.packageSpecificTags ?? false;
  const tagTemplate =
    options?.tagTemplate || (packageSpecificTags ? `\${packageName}@\${prefix}\${version}` : `\${prefix}\${version}`);

  // Strip @ prefix from package names for tag matching (e.g., @releasekit/version -> releasekit-version)
  const sanitizedPackageName = packageName.startsWith('@') ? packageName.slice(1).replace(/\//g, '-') : packageName;
  const escapedPackageName = escapeRegExp(sanitizedPackageName);
  const escapedPrefix = versionPrefix ? escapeRegExp(versionPrefix) : '';

  log(
    `Looking for tags for package ${packageName} with prefix ${versionPrefix || 'none'}, packageSpecificTags: ${packageSpecificTags}`,
    'debug',
  );

  // Only package-specific tags are listed here; global tags go through getLatestTag/getSemverTags.
  if (!packageSpecificTags) {
    log(`Package-specific tags disabled for ${packageName}, falling back to global tags`, 'debug');
    return [];
  }

  // Get ALL git tags (not just semver ones, which git-semver-tags can't see), sorted by creatordate
  // descending so the most recently created tag comes first. This ensures a stable patch release
  // (e.g. v0.2.1) created after a prerelease (e.g. v0.3.0-next.4) is correctly identified as latest.
  let allTags: string[] = [];
  try {
    const { execSync } = await import('./commandExecutor.js');
    const tagsOutput = execSync('git', ['tag', '--sort=-creatordate'], { cwd: process.cwd() });
    allTags = tagsOutput
      .toString()
      .trim()
      .split('\n')
      .filter((tag) => tag.length > 0);
  } catch (err) {
    log(`Error getting tags: ${err instanceof Error ? err.message : String(err)}`, 'error');
  }

  log(`Retrieved ${allTags.length} tags`, 'debug');

  // Build a regex from the tag template, replacing template variables with capture groups.
  const packageTagPattern = escapeRegExp(tagTemplate)
    .replace(/\\\$\\\{packageName\\\}/g, `(?:${escapedPackageName})`)
    .replace(/\\\$\\\{prefix\\\}/g, `(?:${escapedPrefix})`)
    .replace(/\\\$\\\{version\\\}/g, '(?:[0-9]+\\.[0-9]+\\.[0-9]+(?:-[a-zA-Z0-9.-]+)?)');

  log(`Using package tag pattern: ${packageTagPattern}`, 'debug');

  const packageTagRegex = new RegExp(`^${packageTagPattern}$`);
  // allTags is already sorted by --sort=-creatordate, so the filtered list preserves that order.
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

/**
 * Get the latest semver tag for a specific package (most recently created), or '' if none.
 * @param packageName The name of the package to get tags for
 * @param versionPrefix Optional version prefix (e.g., 'v')
 * @param options Additional options including tag templates
 * @returns The latest tag for the package or empty string if none found
 */
export async function getLatestTagForPackage(
  packageName: string,
  versionPrefix?: string,
  options?: TagSearchOptions,
): Promise<string> {
  try {
    const packageTags = await listPackageTags(packageName, versionPrefix, options);
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

    // Check if the error specifically means no tags were found
    if (error instanceof Error && error.message.includes('No names found')) {
      log(`No tags found for package ${packageName}.`, 'info');
    }

    return ''; // Return empty string on error or no tags
  }
}

/**
 * Most recent *stable* (non-prerelease) tag for a package, or '' if none.
 *
 * Used when a prerelease graduates to stable: the changelog should aggregate everything since the
 * last stable release, not since the most recent (prerelease) tag.
 */
export async function getLatestStableTagForPackage(
  packageName: string,
  versionPrefix?: string,
  options?: TagSearchOptions,
): Promise<string> {
  try {
    const packageTags = await listPackageTags(packageName, versionPrefix, options);
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

/**
 * Most recent *stable* tag across the global (non-package-specific) tag series, or '' if none.
 * Stable counterpart of {@link getLatestTag} for sync/global graduation.
 */
export async function getLatestStableTag(versionPrefix?: string): Promise<string> {
  try {
    const tags: string[] = await getSemverTags({ tagPrefix: versionPrefix });
    const stripPrefix = (tag: string) =>
      versionPrefix && tag.startsWith(versionPrefix) ? tag.slice(versionPrefix.length) : tag;

    const stableTags = tags.filter((tag) => {
      const cleaned = semver.clean(stripPrefix(tag));
      return cleaned ? semver.prerelease(cleaned) === null : false;
    });

    if (stableTags.length === 0) return '';

    // Highest stable version first (mirrors getLatestTag's semantic sort).
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
