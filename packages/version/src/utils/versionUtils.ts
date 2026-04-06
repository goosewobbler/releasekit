/**
 * Utility functions for package version retrieval and manipulation
 */

import fs from 'node:fs';
import { parseCargoToml } from '@releasekit/config';
import type { ReleaseType } from 'semver';
import semver from 'semver';

import { verifyTag } from '../git/tagVerification.js';
import { log } from './logging.js';

// Standard bump types
export const STANDARD_BUMP_TYPES = ['major', 'minor', 'patch'] as const;

/**
 * Extract version from a package.json file
 */
export function getVersionFromPackageJson(
  packageJsonPath: string,
  initialVersion = '0.1.0',
): { version: string; success: boolean } {
  try {
    if (!fs.existsSync(packageJsonPath)) {
      return { version: initialVersion, success: false };
    }

    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));

    // Case: package.json exists but has no version property
    if (!packageJson.version) {
      log(`No version found in package.json. Using initial version ${initialVersion}`, 'info');
      return { version: initialVersion, success: false };
    }

    // Normal case: use the package.json version
    return { version: packageJson.version, success: true };
  } catch (error) {
    log(`Error reading package.json: ${error instanceof Error ? error.message : String(error)}`, 'error');
    return { version: initialVersion, success: false };
  }
}

/**
 * Extract version from a Cargo.toml file
 */
export function getVersionFromCargoToml(
  cargoTomlPath: string,
  initialVersion = '0.1.0',
): { version: string; success: boolean } {
  try {
    if (!fs.existsSync(cargoTomlPath)) {
      return { version: initialVersion, success: false };
    }

    const cargo = parseCargoToml(cargoTomlPath);

    // Check if package section and version field exist
    if (!cargo.package?.version) {
      log(`No version found in Cargo.toml. Using initial version ${initialVersion}`, 'debug');
      return { version: initialVersion, success: false };
    }

    // Normal case: use the Cargo.toml version
    return { version: cargo.package.version, success: true };
  } catch (error) {
    log(`Error reading Cargo.toml: ${error instanceof Error ? error.message : String(error)}`, 'error');
    return { version: initialVersion, success: false };
  }
}

/**
 * Normalizes the prerelease identifier based on input and config
 *
 * If prereleaseIdentifier is true:
 * 1. First checks the config for a prereleaseIdentifier value
 * 2. Falls back to 'next' as the default
 *
 * Otherwise returns the original identifier
 *
 * @param prereleaseIdentifier The raw prerelease identifier (can be true, string, or undefined)
 * @param config Optional config that might contain a prereleaseIdentifier
 * @returns The normalized identifier as a string or undefined
 */
export function normalizePrereleaseIdentifier(
  prereleaseIdentifier?: string | boolean,
  config?: { prereleaseIdentifier?: string },
): string | undefined {
  // If prereleaseIdentifier is true, use config value or 'next' as default
  if (prereleaseIdentifier === true) {
    return config?.prereleaseIdentifier || 'next';
  }

  // For string values, return as is
  if (typeof prereleaseIdentifier === 'string') {
    return prereleaseIdentifier;
  }

  // For false or undefined, return undefined
  return undefined;
}

/**
 * Handles bumping of prerelease versions, applying special case handling
 *
 * @param version The current version being bumped
 * @param releaseType The release type being applied
 * @param identifier Optional prerelease identifier (already normalized)
 * @returns The bumped version
 */
export function bumpVersion(currentVersion: string, bumpType: ReleaseType, prereleaseIdentifier?: string): string {
  // Special case: When a prerelease identifier is provided with standard bump types on a stable version,
  // we need to use a "pre*" type (premajor, preminor, prepatch) instead of a standard type with identifier
  if (
    prereleaseIdentifier &&
    STANDARD_BUMP_TYPES.includes(bumpType as 'major' | 'minor' | 'patch') &&
    !semver.prerelease(currentVersion)
  ) {
    const preBumpType = `pre${bumpType}` as ReleaseType;
    log(`Creating prerelease version with identifier '${prereleaseIdentifier}' using ${preBumpType}`, 'debug');
    return semver.inc(currentVersion, preBumpType, prereleaseIdentifier) || '';
  }

  // Handle existing prerelease versions
  if (semver.prerelease(currentVersion) && STANDARD_BUMP_TYPES.includes(bumpType as 'major' | 'minor' | 'patch')) {
    const parsed = semver.parse(currentVersion);
    if (!parsed) {
      return semver.inc(currentVersion, bumpType) || '';
    }

    // When prerelease is explicitly requested (via flag or label), increment the prerelease
    // instead of cleaning to stable. This applies:
    // - prerelease flag + major bump on x.0.0-next.y -> x.0.0-next.y+1
    // - prerelease flag + minor bump on x.y.0-next.y -> x.y.0-next.y+1
    // - prerelease flag + patch bump on x.y.z-next.y -> x.y.z-next.y+1
    if (prereleaseIdentifier) {
      log(`Incrementing prerelease for ${currentVersion} using 'prerelease'`, 'debug');
      return semver.inc(currentVersion, 'prerelease', prereleaseIdentifier) || '';
    }

    log(`Standard increment for ${currentVersion} with ${bumpType} bump`, 'debug');
    return semver.inc(currentVersion, bumpType) || '';
  }

  // For non-prerelease versions or non-standard bump types
  if (prereleaseIdentifier) {
    return semver.inc(currentVersion, bumpType, prereleaseIdentifier) || '';
  }
  return semver.inc(currentVersion, bumpType) || '';
}

/**
 * Detects significant version mismatches that could indicate problems
 * Returns details about the mismatch if detected
 */
function detectVersionMismatch(
  tagVersion: string,
  packageVersion: string,
): {
  isMismatch: boolean;
  severity: 'minor' | 'major';
  message: string;
} {
  const tagIsPrerelease = semver.prerelease(tagVersion) !== null;
  const packageIsPrerelease = semver.prerelease(packageVersion) !== null;
  const tagParsed = semver.parse(tagVersion);
  const packageParsed = semver.parse(packageVersion);

  if (!tagParsed || !packageParsed) {
    return { isMismatch: false, severity: 'minor', message: '' };
  }

  // Case 1: Tag is stable but package is prerelease (same major version)
  // This can happen when a release was reverted but tag wasn't deleted
  if (!tagIsPrerelease && packageIsPrerelease && tagParsed.major === packageParsed.major) {
    return {
      isMismatch: true,
      severity: 'major',
      message:
        `Git tag ${tagVersion} (stable) is ahead of package ${packageVersion} (prerelease). ` +
        `This may indicate a reverted release. Consider deleting tag ${tagVersion} or updating package.json.`,
    };
  }

  // Case 2: Tag is ahead by more than one minor/patch version
  const tagHigher = semver.gt(tagVersion, packageVersion);
  if (tagHigher) {
    const diff = semver.diff(packageVersion, tagVersion);
    if (diff === 'major' || diff === 'minor') {
      return {
        isMismatch: true,
        severity: 'major',
        message:
          `Git tag ${tagVersion} is significantly ahead (${diff}) of package ${packageVersion}. ` +
          'This may cause unexpected version bumps.',
      };
    }
  }

  // Case 3: Package is stable but tag is prerelease (unusual)
  if (tagIsPrerelease && !packageIsPrerelease) {
    return {
      isMismatch: true,
      severity: 'minor',
      message:
        `Git tag ${tagVersion} is a prerelease but package ${packageVersion} is stable. ` +
        'Consider aligning your versioning.',
    };
  }

  return { isMismatch: false, severity: 'minor', message: '' };
}

export class VersionMismatchError extends Error {
  constructor(
    message: string,
    public readonly severity: 'minor' | 'major',
  ) {
    super(message);
    this.name = 'VersionMismatchError';
  }
}

export type MismatchInfo = {
  detected: boolean;
  severity: 'minor' | 'major';
  message: string;
};

export type VersionSourceResult = {
  source: 'git' | 'package' | 'initial';
  version: string;
  reason: string;
  mismatch?: MismatchInfo;
};

/**
 * Get the best available version source (git tag vs package version)
 * Smart fallback logic that chooses the most appropriate version source
 *
 * Mismatch strategies:
 * - 'error': Throw error on significant mismatch (default)
 * - 'warn': Log warning but continue with the higher version
 * - 'ignore': Silent ignore
 * - 'prefer-package': Always use package version when mismatch detected
 * - 'prefer-git': Always use git tag when mismatch detected
 */
export async function getBestVersionSource(
  tagName: string | undefined,
  packageVersion: string | undefined,
  cwd: string,
  mismatchStrategy: 'error' | 'warn' | 'ignore' | 'prefer-package' | 'prefer-git' = 'error',
  strictReachable = false,
): Promise<VersionSourceResult> {
  // No tag provided - use package version or fallback to initial
  if (!tagName?.trim()) {
    return packageVersion
      ? { source: 'package', version: packageVersion, reason: 'No git tag provided' }
      : { source: 'initial', version: '0.1.0', reason: 'No git tag or package version available' };
  }

  // Verify tag existence and reachability
  const verification = verifyTag(tagName, cwd);

  // Tag unreachable - handle based on strictReachable flag
  if (!verification.exists || !verification.reachable) {
    // When strictReachable is true, don't allow fallback to unreachable tags
    if (strictReachable) {
      throw new Error(
        `Git tag '${tagName}' is not reachable from the current commit. ` +
          `The tag exists but cannot be reached from HEAD, which usually means you're on a different branch or the tag is orphaned. ` +
          `To allow fallback to package version, set strictReachable to false in your configuration.`,
      );
    }

    if (packageVersion) {
      log(
        `Git tag '${tagName}' unreachable (${verification.error}), using package version: ${packageVersion}`,
        'warning',
      );
      return { source: 'package', version: packageVersion, reason: 'Git tag unreachable' };
    }

    log(`Git tag '${tagName}' unreachable and no package version available, using initial version`, 'warning');
    return {
      source: 'initial',
      version: '0.1.0',
      reason: 'Git tag unreachable, no package version',
    };
  }

  // Tag exists and reachable - compare versions if package version available
  if (!packageVersion) {
    return {
      source: 'git',
      version: tagName,
      reason: 'Git tag exists, no package version to compare',
    };
  }

  try {
    // Clean versions for comparison (remove prefixes like "v" or "package@v")
    const cleanTagVersion = tagName.replace(/^.*?([0-9])/, '$1');
    const cleanPackageVersion = packageVersion;

    // Check for significant mismatches
    const mismatch = detectVersionMismatch(cleanTagVersion, cleanPackageVersion);
    const mismatchInfo: MismatchInfo | undefined = mismatch.isMismatch
      ? { detected: true, severity: mismatch.severity, message: mismatch.message }
      : undefined;

    // Handle mismatch based on strategy
    if (mismatch.isMismatch) {
      switch (mismatchStrategy) {
        case 'error':
          throw new VersionMismatchError(
            `Version mismatch detected: ${mismatch.message}\n` +
              `To resolve: delete the conflicting tag, update package.json, or change mismatchStrategy to 'warn' or 'ignore'`,
            mismatch.severity,
          );

        case 'warn':
          log(mismatch.message, 'warning');
          log(
            `Continuing with git tag ${tagName}. ` +
              `To use package version instead, set mismatchStrategy to 'prefer-package'`,
            'warning',
          );
          break;

        case 'ignore':
          // Silent - no logging
          break;

        case 'prefer-package':
          log(mismatch.message, 'warning');
          log(`Using package version ${packageVersion} due to mismatchStrategy='prefer-package'`, 'info');
          return {
            source: 'package',
            version: packageVersion,
            reason: 'Mismatch detected, using package version per strategy',
            mismatch: mismatchInfo,
          };

        case 'prefer-git':
          log(mismatch.message, 'warning');
          log(`Using git tag ${tagName} due to mismatchStrategy='prefer-git'`, 'info');
          return {
            source: 'git',
            version: tagName,
            reason: 'Mismatch detected, using git tag per strategy',
            mismatch: mismatchInfo,
          };
      }
    }

    // Compare versions and use the newer one
    if (semver.gt(cleanPackageVersion, cleanTagVersion)) {
      log(`Package version ${packageVersion} is newer than git tag ${tagName}, using package version`, 'info');
      return {
        source: 'package',
        version: packageVersion,
        reason: 'Package version is newer',
        mismatch: mismatchInfo,
      };
    }

    if (semver.gt(cleanTagVersion, cleanPackageVersion)) {
      log(`Git tag ${tagName} is newer than package version ${packageVersion}, using git tag`, 'info');
      return {
        source: 'git',
        version: tagName,
        reason: 'Git tag is newer',
        mismatch: mismatchInfo,
      };
    }

    // Versions equal - prefer git tag as source of truth
    return {
      source: 'git',
      version: tagName,
      reason: 'Versions equal, using git tag',
      mismatch: mismatchInfo,
    };
  } catch (error) {
    if (error instanceof VersionMismatchError) {
      throw error;
    }
    log(`Failed to compare versions, defaulting to git tag: ${error}`, 'warning');
    return { source: 'git', version: tagName, reason: 'Version comparison failed' };
  }
}
