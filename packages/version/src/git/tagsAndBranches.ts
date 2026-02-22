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

    // Escape @ in package name for regex
    const escapedPackageName = escapeRegExp(packageName);
    const escapedPrefix = versionPrefix ? escapeRegExp(versionPrefix) : '';

    log(
      `Looking for tags for package ${packageName} with prefix ${versionPrefix || 'none'}, packageSpecificTags: ${packageSpecificTags}`,
      'debug',
    );

    // Instead of using the package option which requires lerna mode,
    // get all tags and filter manually for the package
    const allTags: string[] = await getSemverTags({
      tagPrefix: versionPrefix,
    });

    log(`Retrieved ${allTags.length} tags: ${allTags.join(', ')}`, 'debug');

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

      // If we found tags with the configured pattern, sort by semantic version and return the highest
      if (packageTags.length > 0) {
        const chronologicalFirst = packageTags[0];

        // Sort package tags by semantic version (highest first)
        const sortedPackageTags = [...packageTags].sort((a, b) => {
          // For configured template pattern, we need to extract version based on template
          // Since templates can vary, use a more generic approach based on the tag structure
          let versionA = '';
          let versionB = '';

          if (a.includes('@')) {
            const afterAt = a.split('@')[1] || '';
            versionA = afterAt.replace(new RegExp(`^${escapeRegExp(versionPrefix || '')}`), '');
          } else {
            // Handle templates without @ separator
            versionA = a
              .replace(new RegExp(`^${escapeRegExp(packageName)}`), '')
              .replace(new RegExp(`^${escapeRegExp(versionPrefix || '')}`), '');
          }

          if (b.includes('@')) {
            const afterAtB = b.split('@')[1] || '';
            versionB = afterAtB.replace(new RegExp(`^${escapeRegExp(versionPrefix || '')}`), '');
          } else {
            // Handle templates without @ separator
            versionB = b
              .replace(new RegExp(`^${escapeRegExp(packageName)}`), '')
              .replace(new RegExp(`^${escapeRegExp(versionPrefix || '')}`), '');
          }

          const cleanVersionA = semver.clean(versionA) || '0.0.0';
          const cleanVersionB = semver.clean(versionB) || '0.0.0';
          return semver.rcompare(cleanVersionA, cleanVersionB);
        });

        log(`Found ${packageTags.length} package tags using configured pattern`, 'debug');
        log(`Using semantically latest tag: ${sortedPackageTags[0]}`, 'debug');

        if (sortedPackageTags[0] !== chronologicalFirst) {
          log(
            `Package tag ordering differs: chronological first is ${chronologicalFirst}, semantic latest is ${sortedPackageTags[0]}`,
            'debug',
          );
        }

        return sortedPackageTags[0];
      }

      // If no tags were found with the configured pattern, fall back to the standard patterns

      // First try the most common format: packageName@versionPrefix+version
      if (versionPrefix) {
        const pattern1 = new RegExp(`^${escapedPackageName}@${escapeRegExp(versionPrefix)}`);
        packageTags = allTags.filter((tag) => pattern1.test(tag));

        // If we found tags with this pattern, sort by semantic version and return the highest
        if (packageTags.length > 0) {
          const sortedPackageTags = [...packageTags].sort((a, b) => {
            // Extract version after the prefix for semantic comparison
            const afterAt = a.split('@')[1] || '';
            const versionA = afterAt.replace(new RegExp(`^${escapeRegExp(versionPrefix || '')}`), '');
            const afterAtB = b.split('@')[1] || '';
            const versionB = afterAtB.replace(new RegExp(`^${escapeRegExp(versionPrefix || '')}`), '');

            const cleanVersionA = semver.clean(versionA) || '0.0.0';
            const cleanVersionB = semver.clean(versionB) || '0.0.0';
            return semver.rcompare(cleanVersionA, cleanVersionB);
          });

          log(`Found ${packageTags.length} package tags using pattern: packageName@${versionPrefix}...`, 'debug');
          log(`Using semantically latest tag: ${sortedPackageTags[0]}`, 'debug');
          return sortedPackageTags[0];
        }
      }

      // Try the alternative format: versionPrefix+packageName@version
      if (versionPrefix) {
        const pattern2 = new RegExp(`^${escapeRegExp(versionPrefix)}${escapedPackageName}@`);
        packageTags = allTags.filter((tag) => pattern2.test(tag));

        // If we found tags with this pattern, sort by semantic version and return the highest
        if (packageTags.length > 0) {
          const sortedPackageTags = [...packageTags].sort((a, b) => {
            // For versionPrefix+packageName@version pattern, extract version after @
            const versionA = semver.clean(a.split('@')[1] || '') || '0.0.0';
            const versionB = semver.clean(b.split('@')[1] || '') || '0.0.0';
            return semver.rcompare(versionA, versionB);
          });

          log(`Found ${packageTags.length} package tags using pattern: ${versionPrefix}packageName@...`, 'debug');
          log(`Using semantically latest tag: ${sortedPackageTags[0]}`, 'debug');
          return sortedPackageTags[0];
        }
      }

      // Fallback to no prefix: packageName@version
      const pattern3 = new RegExp(`^${escapedPackageName}@`);
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

      // Sort package tags by semantic version (highest first)
      const sortedPackageTags = [...packageTags].sort((a, b) => {
        // For packageName@version pattern, extract version after @
        const versionA = semver.clean(a.split('@')[1] || '') || '0.0.0';
        const versionB = semver.clean(b.split('@')[1] || '') || '0.0.0';
        return semver.rcompare(versionA, versionB);
      });

      log(`Found ${packageTags.length} package tags for ${packageName}`, 'debug');
      log(`Using semantically latest tag: ${sortedPackageTags[0]}`, 'debug');
      return sortedPackageTags[0];
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
