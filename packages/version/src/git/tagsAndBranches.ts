import { createGitCli, type Git } from '@releasekit/git';
import { getSemverTags } from 'git-semver-tags';
import semver from 'semver';
import { escapeRegExp } from '../utils/formatting.js';
import { log } from '../utils/logging.js';
import { isStableTag } from '../utils/versionUtils.js';

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
export async function getCommitsLength(pkgRoot: string, sinceTag?: string, git: Git = createGitCli()): Promise<number> {
  try {
    if (sinceTag && sinceTag.trim() !== '') {
      // Use the specific tag provided
      return await git.countCommits(`${sinceTag}..HEAD`, { path: pkgRoot });
    }

    // Fallback: find latest tag via git describe, then count commits since it. `<tag>..HEAD` is
    // exactly `HEAD ^<tag>` — the original two-positional form — so the count is unchanged.
    const latestTag = await git.describeTags();
    if (!latestTag) {
      // describe found no reachable tag; the original `rev-list ... '^'` form errored here and was
      // caught → 0. Preserve that by throwing into the catch below.
      throw new Error('No names found, cannot describe anything.');
    }
    return await git.countCommits(`${latestTag}..HEAD`, { path: pkgRoot });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log(`Failed to get number of commits since last tag: ${errorMessage}`, 'error');
    return 0;
  }
}

/**
 * Whether a git ref (tag, branch, or SHA) exists and resolves to a commit in this repo.
 * Used to guard a `from..HEAD` range before handing it to a commit walker — an absent ref
 * should fall back to the unbounded default rather than throwing.
 * @param ref The ref to verify
 * @param cwd Optional working directory to run the check in
 * @returns true if the ref resolves, false otherwise
 */
export function refExists(ref: string, cwd?: string, git: Git = createGitCli()): Promise<boolean> {
  if (!ref || ref.trim() === '') return Promise.resolve(false);
  // The seam's refExists is the same `rev-parse --verify --quiet <ref>^{commit}` soft lookup.
  return git.refExists(ref, cwd);
}

/**
 * The most recent tag reachable from HEAD, regardless of package prefix or version scheme.
 *
 * Unlike `getLatestTag` — which goes through git-semver-tags and only matches *bare* semver tags
 * (`v1.2.3`) — this walks HEAD's ancestors via `git describe`, so it also finds the per-package
 * tags monorepos actually use (`pkg@vX.Y.Z`, `release/vX.Y.Z`). The result is reachable by
 * construction, which is exactly what a `<tag>..HEAD` baseline floor needs.
 *
 * @returns The nearest reachable tag, or '' when none is reachable (no releases yet / shallow clone).
 */
export async function getNearestReachableTag(cwd?: string, git: Git = createGitCli()): Promise<string> {
  try {
    // describeTags returns null when no tag is reachable (the seam's "soft" describe); preserve the
    // original `''` fallback so callers' `<tag>..HEAD` vs `HEAD` branch is unchanged.
    return (await git.describeTags(cwd)) ?? '';
  } catch {
    return '';
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
 * List a package's tags (those matching its tag template), most-recently-created first.
 *
 * Returns an empty array when package-specific tags are disabled (callers fall back to the global
 * tag series) or when nothing matches. Shared by the latest-tag and latest-stable-tag lookups.
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
    allTags = await git.listTags({ sort: '-creatordate', cwd: process.cwd() });
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
