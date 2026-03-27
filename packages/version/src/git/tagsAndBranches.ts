import { getSemverTags } from 'git-semver-tags';
import semver from 'semver';
import { escapeRegExp } from '../utils/formatting.js';
import { log } from '../utils/logging.js';
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

    // Sort tags by semantic version (highest first)
    const sortedTags = [...tags].sort((a, b) => {
      const versionA = semver.clean(a) || '0.0.0';
      const versionB = semver.clean(b) || '0.0.0';
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
 * Get the latest semver tag for a specific package
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
    const tagTemplate = options?.tagTemplate || `\${prefix}\${version}`;
    const packageSpecificTags = options?.packageSpecificTags ?? false;

    // Strip @ prefix from package names for tag matching (e.g., @releasekit/version -> releasekit-version)
    const sanitizedPackageName = packageName.startsWith('@') ? packageName.slice(1).replace(/\//g, '-') : packageName;
    // Escape @ in package name for regex - use sanitized for new template patterns, raw for fallback patterns
    const escapedPackageName = escapeRegExp(sanitizedPackageName);
    const escapedRawPackageName = escapeRegExp(packageName);
    const escapedPrefix = versionPrefix ? escapeRegExp(versionPrefix) : '';

    log(
      `Looking for tags for package ${packageName} with prefix ${versionPrefix || 'none'}, packageSpecificTags: ${packageSpecificTags}`,
      'debug',
    );

    // Instead of using the package option which requires lerna mode,
    // get all tags and filter manually for the package
    // For package-specific tags, we need ALL git tags (not just semver ones)
    // Our tags have package prefixes like "@releasekit/version@v1.0.0"
    // which git-semver-tags doesn't recognize, so we use git tag -l
    let allTags: string[] = [];
    try {
      const { execSync } = await import('./commandExecutor.js');
      // Sort by creatordate descending so the most recently created tag comes first.
      // This ensures that a stable patch release (e.g. v0.2.1) created after a prerelease
      // (e.g. v0.3.0-next.4) is correctly identified as the latest tag for the package.
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

    // Only use package-specific tag patterns if explicitly enabled
    if (packageSpecificTags) {
      // Create a regex pattern based on the tagTemplate
      // First, replace template variables with regex capture groups
      const packageTagPattern = escapeRegExp(tagTemplate)
        .replace(/\\\$\\\{packageName\\\}/g, `(?:${escapedPackageName})`)
        .replace(/\\\$\\\{prefix\\\}/g, `(?:${escapedPrefix})`)
        .replace(/\\\$\\\{version\\\}/g, '(?:[0-9]+\\.[0-9]+\\.[0-9]+(?:-[a-zA-Z0-9.-]+)?)');

      log(`Using package tag pattern: ${packageTagPattern}`, 'debug');

      const packageTagRegex = new RegExp(`^${packageTagPattern}$`);
      let packageTags = allTags.filter((tag) => packageTagRegex.test(tag));

      log(`Found ${packageTags.length} matching tags for ${packageName}`, 'debug');

      // If we found tags with the configured pattern, return the most recently created one.
      // allTags is already sorted by --sort=-creatordate, so packageTags preserves that order.
      if (packageTags.length > 0) {
        log(`Found ${packageTags.length} package tags using configured pattern`, 'debug');
        log(`Using most recently created tag: ${packageTags[0]}`, 'debug');

        return packageTags[0];
      }

      // If no tags were found with the configured pattern, fall back to the standard patterns

      // First try the most common format: packageName@versionPrefix+version
      if (versionPrefix) {
        const pattern1 = new RegExp(`^${escapedRawPackageName}@${escapeRegExp(versionPrefix)}`);
        packageTags = allTags.filter((tag) => pattern1.test(tag));

        // Return the most recently created tag (allTags is sorted by --sort=-creatordate)
        if (packageTags.length > 0) {
          log(`Found ${packageTags.length} package tags using pattern: packageName@${versionPrefix}...`, 'debug');
          log(`Using most recently created tag: ${packageTags[0]}`, 'debug');
          return packageTags[0];
        }
      }

      // Try the alternative format: versionPrefix+packageName@version
      if (versionPrefix) {
        const pattern2 = new RegExp(`^${escapeRegExp(versionPrefix)}${escapedRawPackageName}@`);
        packageTags = allTags.filter((tag) => pattern2.test(tag));

        // Return the most recently created tag (allTags is sorted by --sort=-creatordate)
        if (packageTags.length > 0) {
          log(`Found ${packageTags.length} package tags using pattern: ${versionPrefix}packageName@...`, 'debug');
          log(`Using most recently created tag: ${packageTags[0]}`, 'debug');
          return packageTags[0];
        }
      }

      // Fallback to no prefix: packageName@version
      const pattern3 = new RegExp(`^${escapedRawPackageName}@`);
      packageTags = allTags.filter((tag) => pattern3.test(tag));

      // Sort and log found tags for debugging
      if (packageTags.length === 0) {
        log('No matching tags found for pattern: packageName@version', 'debug');
        if (allTags.length > 0) {
          log(`Available tags: ${allTags.join(', ')}`, 'debug');
        } else {
          log('No tags available in the repository', 'debug');
        }
        return '';
      }

      // Return the most recently created tag (allTags is sorted by --sort=-creatordate)
      log(`Found ${packageTags.length} package tags for ${packageName}`, 'debug');
      log(`Using most recently created tag: ${packageTags[0]}`, 'debug');
      return packageTags[0];
    }

    // Package-specific tags disabled, return empty string to fall back to global tags
    log(`Package-specific tags disabled for ${packageName}, falling back to global tags`, 'debug');
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
