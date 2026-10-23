import fs from 'node:fs';
import { parseCargoToml } from '@releasekit/config';
import { createGitCli, type Git } from '@releasekit/git';
import type { ReleaseType } from 'semver';
import semver from 'semver';

import { verifyTag } from '../git/tagVerification.js';
import { log } from './logging.js';

export const STANDARD_BUMP_TYPES = ['major', 'minor', 'patch'] as const;

export function isStableVersion(version: string): boolean {
  return semver.valid(version) !== null && semver.prerelease(version) === null;
}

export function isStableTag(tag: string): boolean {
  // Bounded quantifiers (not `\d+`) so a long digit run in this uncontrolled input can't trigger
  // polynomial backtracking (CodeQL js/polynomial-redos); real versions never approach the bounds.
  const match = tag.match(/\d{1,16}\.\d{1,16}\.\d{1,16}(?:-[0-9A-Za-z.-]{1,256})?/);
  return match ? semver.prerelease(match[0]) === null : false;
}

export function getVersionFromPackageJson(
  packageJsonPath: string,
  initialVersion = '0.1.0',
): { version: string; success: boolean } {
  try {
    if (!fs.existsSync(packageJsonPath)) {
      return { version: initialVersion, success: false };
    }

    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));

    if (!packageJson.version) {
      log(`No version found in package.json. Using initial version ${initialVersion}`, 'info');
      return { version: initialVersion, success: false };
    }

    return { version: packageJson.version, success: true };
  } catch (error) {
    log(`Error reading package.json: ${error instanceof Error ? error.message : String(error)}`, 'error');
    return { version: initialVersion, success: false };
  }
}

export function getVersionFromCargoToml(
  cargoTomlPath: string,
  initialVersion = '0.1.0',
): { version: string; success: boolean } {
  try {
    if (!fs.existsSync(cargoTomlPath)) {
      return { version: initialVersion, success: false };
    }

    const cargo = parseCargoToml(cargoTomlPath);

    if (!cargo.package?.version) {
      log(`No version found in Cargo.toml. Using initial version ${initialVersion}`, 'debug');
      return { version: initialVersion, success: false };
    }

    return { version: cargo.package.version, success: true };
  } catch (error) {
    log(`Error reading Cargo.toml: ${error instanceof Error ? error.message : String(error)}`, 'error');
    return { version: initialVersion, success: false };
  }
}

export function normalizePrereleaseIdentifier(
  prereleaseIdentifier?: string | boolean,
  config?: { prereleaseIdentifier?: string },
): string | undefined {
  if (prereleaseIdentifier === true) {
    return config?.prereleaseIdentifier || 'next';
  }

  if (typeof prereleaseIdentifier === 'string') {
    return prereleaseIdentifier;
  }

  return undefined;
}

export function bumpVersion(currentVersion: string, bumpType: ReleaseType, prereleaseIdentifier?: string): string {
  // A standard bump type ignores the identifier, so a stable base needs the pre* variant.
  if (
    prereleaseIdentifier &&
    STANDARD_BUMP_TYPES.includes(bumpType as 'major' | 'minor' | 'patch') &&
    !semver.prerelease(currentVersion)
  ) {
    const preBumpType = `pre${bumpType}` as ReleaseType;
    log(`Creating prerelease version with identifier '${prereleaseIdentifier}' using ${preBumpType}`, 'debug');
    return semver.inc(currentVersion, preBumpType, prereleaseIdentifier) || '';
  }

  if (semver.prerelease(currentVersion) && STANDARD_BUMP_TYPES.includes(bumpType as 'major' | 'minor' | 'patch')) {
    const parsed = semver.parse(currentVersion);
    if (!parsed) {
      return semver.inc(currentVersion, bumpType) || '';
    }

    // An explicit prerelease increments the counter (x.y.z-next.n -> x.y.z-next.n+1) rather than graduating.
    if (prereleaseIdentifier) {
      log(`Incrementing prerelease for ${currentVersion} using 'prerelease'`, 'debug');
      return semver.inc(currentVersion, 'prerelease', prereleaseIdentifier) || '';
    }

    const stableBase = `${parsed.major}.${parsed.minor}.${parsed.patch}`;
    log(`Stripping prerelease base ${currentVersion} -> ${stableBase} before applying ${bumpType} bump`, 'debug');
    return semver.inc(stableBase, bumpType) || '';
  }

  if (prereleaseIdentifier) {
    return semver.inc(currentVersion, bumpType, prereleaseIdentifier) || '';
  }
  return semver.inc(currentVersion, bumpType) || '';
}

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

  if (!tagIsPrerelease && packageIsPrerelease && tagParsed.major === packageParsed.major) {
    return {
      isMismatch: true,
      severity: 'major',
      message:
        `Git tag ${tagVersion} (stable) is ahead of package ${packageVersion} (prerelease). ` +
        `This may indicate a reverted release. Consider deleting tag ${tagVersion} or updating package.json.`,
    };
  }

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

export async function getBestVersionSource(
  tagName: string | undefined,
  packageVersion: string | undefined,
  cwd: string,
  mismatchStrategy: 'error' | 'warn' | 'ignore' | 'prefer-package' | 'prefer-git' = 'error',
  strictReachable = false,
  git: Git = createGitCli(),
): Promise<VersionSourceResult> {
  if (!tagName?.trim()) {
    return packageVersion
      ? { source: 'package', version: packageVersion, reason: 'No git tag provided' }
      : { source: 'initial', version: '0.1.0', reason: 'No git tag or package version available' };
  }

  const verification = await verifyTag(tagName, cwd, git);

  if (!verification.exists || !verification.reachable) {
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

  if (!packageVersion) {
    return {
      source: 'git',
      version: tagName,
      reason: 'Git tag exists, no package version to compare',
    };
  }

  try {
    // Strip any tag prefix (e.g. `v`, `package@v`).
    const cleanTagVersion = tagName.replace(/^.*?([0-9])/, '$1');
    const cleanPackageVersion = packageVersion;

    const mismatch = detectVersionMismatch(cleanTagVersion, cleanPackageVersion);
    const mismatchInfo: MismatchInfo | undefined = mismatch.isMismatch
      ? { detected: true, severity: mismatch.severity, message: mismatch.message }
      : undefined;

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
