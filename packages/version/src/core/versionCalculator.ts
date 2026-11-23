import { inspect } from 'node:util';
import { shouldMatchPackageTargets } from '@releasekit/core';
import { createGitCli, isTagAfter } from '@releasekit/git';
import { Bumper } from 'conventional-recommended-bump';
import type { ReleaseType } from 'semver';
import semver from 'semver';
import { getCommitsLength, refExists } from '../git/tagsAndBranches.js';
import type { Config, VersionOptions } from '../types.js';
import { log } from '../utils/logging.js';
import { bumpVersion, normalizePrereleaseIdentifier, STANDARD_BUMP_TYPES } from '../utils/versionUtils.js';
import { createPreset } from './presets.js';

/**
 * Prerelease form of an explicit `bump:*` magnitude: patch advances the counter (1.0.0-next.1 →
 * 1.0.0-next.2); minor/major escalate the base to a new line (1.0.0-next.1 → 1.1.0-next.0 / 2.0.0-next.0).
 */
function toPrereleaseLineBump(bumpType: ReleaseType): ReleaseType {
  switch (bumpType) {
    case 'major':
      return 'premajor';
    case 'minor':
      return 'preminor';
    case 'patch':
      return 'prerelease';
    default:
      return bumpType;
  }
}

/**
 * Advancing along a channel keeps the *current* line's identifier, so callers prefer this over the
 * configured one - switching lines is a deliberate config change.
 */
function prereleaseIdOf(version: string): string | undefined {
  const pre = semver.prerelease(version);
  return pre && typeof pre[0] === 'string' ? pre[0] : undefined;
}

/**
 * Strip the forced `bump` / `prerelease` / `stable` override for a package outside `overrideScope`,
 * so it falls through to commit-driven calculation.
 */
export function applyOverrideScope(
  config: Config,
  options: VersionOptions,
): { config: Config; options: VersionOptions } {
  const { overrideScope, graduateScope, prereleaseScope } = config;
  let scoped: { config: Config; options: VersionOptions } = { config, options };
  // These are runtime override fields (folded from runOptions), never config-file settings, so clearing
  // them reverts the package to commit-driven calculation. Without a name (single-package repo) the
  // override always applies.
  if (overrideScope?.length && options.name && !shouldMatchPackageTargets(options.name, overrideScope)) {
    scoped = {
      config: { ...scoped.config, type: undefined, isPrerelease: undefined, stableOnly: undefined },
      options: { ...scoped.options, type: undefined },
    };
  }
  // graduateScope membership is authoritative for stableOnly: re-assert it even if the overrideScope
  // clearing above stripped it, since a graduate target can be a transitive prerequisite outside
  // overrideScope. Safe because graduateScope is only ever set alongside `stableOnly: true`.
  if (graduateScope?.length && options.name) {
    const inGraduateScope = shouldMatchPackageTargets(options.name, graduateScope);
    scoped = { ...scoped, config: { ...scoped.config, stableOnly: inGraduateScope ? true : undefined } };
  }
  // Twin of the graduateScope branch for isPrerelease (a scoped package can sit outside overrideScope
  // when a bump is scoped elsewhere).
  if (prereleaseScope?.length && options.name) {
    const inPrereleaseScope = shouldMatchPackageTargets(options.name, prereleaseScope);
    scoped = { ...scoped, config: { ...scoped.config, isPrerelease: inPrereleaseScope ? true : undefined } };
  }
  return scoped;
}

/**
 * On a first release with an already-stable manifest, `--stable --bump <type>` applies the bump
 * (1.0.0 → 2.0.0) rather than graduating, overshooting the staged first version. The version is left
 * unchanged - a bump is sometimes legitimate (importing a package with prior external history) - so
 * this only surfaces it per `mismatchStrategy`.
 */
function guardFirstReleaseBump(config: Config, name: string | undefined, currentVer: string, type: ReleaseType): void {
  if (config.allowFirstBump) {
    return;
  }
  const pkg = name || 'package';
  const bumped = bumpVersion(currentVer, type);
  const message =
    `${pkg} has no prior release and a stable manifest (${currentVer}); --bump ${type} will publish ${bumped}, not ${currentVer}. ` +
    `To release ${currentVer}, stage the manifest at a prerelease (e.g. ${currentVer}-next.0, which graduates), ` +
    `or set version.allowFirstBump (or pass --allow-first-bump) to apply the bump.`;
  if ((config.mismatchStrategy ?? 'warn') === 'error') {
    throw new Error(`First-release version overshoot: ${message}`);
  }
  if (config.mismatchStrategy === 'ignore') {
    return;
  }
  log(message, 'warning');
}

export async function calculateVersion(config: Config, options: VersionOptions): Promise<string> {
  const { latestTag } = options;
  if (
    config.skipTaggedAfter &&
    options.hasRealTag !== false &&
    latestTag &&
    (await isTagAfter(createGitCli(), latestTag, config.skipTaggedAfter, options.path))
  ) {
    log(`Skipping ${options.name || 'project'}: ${latestTag} already released ${config.skipTaggedAfter}`, 'info');
    return '';
  }
  const scoped = applyOverrideScope(config, options);
  return calculateVersionInner(scoped.config, scoped.options);
}

async function calculateVersionInner(config: Config, options: VersionOptions): Promise<string> {
  log(`Starting version calculation for ${options.name || 'project'}`, 'debug');

  const { type: configType, preset, prereleaseIdentifier: configPrereleaseIdentifier } = config;

  const {
    latestTag,
    name,
    path: pkgPath,
    commitScope = pkgPath ? [pkgPath] : [],
    type: optionsType,
    prereleaseIdentifier: optionsPrereleaseIdentifier,
    current,
  } = options;

  const type = optionsType || configType;
  const prereleaseIdentifier = optionsPrereleaseIdentifier || configPrereleaseIdentifier;

  const initialVersion = '0.1.0';
  const firstRelease = !current.recorded;
  log(`Resolved type: ${type}, current version: ${current.version}${firstRelease ? ' (first release)' : ''}`, 'debug');

  const normalizedPrereleaseId = normalizePrereleaseIdentifier(prereleaseIdentifier, config);

  try {
    // Warn but fall through - returning the manifest verbatim on a first release would ignore
    // --stable, --bump and prereleaseIdentifier.
    if (firstRelease && type) {
      log(`No previous release found for ${name || 'project'} - this appears to be a first release`, 'warning');
    }

    log(`Checking stableOnly mode: ${config.stableOnly}`, 'debug');
    if (config.stableOnly) {
      log(`StableOnly mode activated`, 'debug');
      const currentVer = current.version;
      log(`Current version in stableOnly: ${currentVer}`, 'debug');
      if (semver.prerelease(currentVer)) {
        log(`Current version is prerelease, graduating`, 'debug');
        // Graduation is bump-less - any bump label magnitude is ignored.
        const parsed = semver.parse(currentVer);
        if (parsed) {
          const stableVersion = `${parsed.major}.${parsed.minor}.${parsed.patch}`;
          log(`Parsed version: ${parsed.major}.${parsed.minor}.${parsed.patch}`, 'debug');
          log(`Graduating ${name || 'package'} from ${currentVer} to ${stableVersion}`, 'info');
          return stableVersion;
        } else {
          log(`Failed to parse current version: ${currentVer}`, 'debug');
        }
      } else if (!type) {
        log(`Current version is stable and no type specified, skipping`, 'debug');
        log(`Skipping ${name || 'package'}: already at stable version ${currentVer}`, 'info');
        return '';
      } else if (firstRelease) {
        guardFirstReleaseBump(config, name, currentVer, type);
      }
      log(`Stable package with explicit bump label, falling through to normal logic`, 'debug');
    }

    const specifiedType = type;
    log(`Specified type: ${specifiedType}`, 'debug');

    if (specifiedType) {
      log(`Handling specified type: ${specifiedType}`, 'debug');
      const currentVersion = current.version;
      log(`Current version for specified type: ${currentVersion}`, 'debug');

      const isCurrentPrerelease = semver.prerelease(currentVersion);
      const explicitlyRequestedPrerelease = config.isPrerelease;
      log(
        `Is current prerelease: ${!!isCurrentPrerelease}, explicitly requested prerelease: ${explicitlyRequestedPrerelease}`,
        'debug',
      );

      // A prerelease advances along its own line rather than graduating, unless an explicit channel action
      // (stableOnly above, isPrerelease below) is in play.
      if (
        isCurrentPrerelease &&
        !config.stableOnly &&
        !explicitlyRequestedPrerelease &&
        STANDARD_BUMP_TYPES.includes(specifiedType as 'major' | 'minor' | 'patch')
      ) {
        const channelId = prereleaseIdOf(currentVersion) ?? normalizedPrereleaseId;
        const channelType = toPrereleaseLineBump(specifiedType as ReleaseType);
        log(`Advancing prerelease ${currentVersion} along its channel via ${channelType} (id: ${channelId})`, 'debug');
        return bumpVersion(currentVersion, channelType, channelId);
      }

      if (
        STANDARD_BUMP_TYPES.includes(specifiedType as 'major' | 'minor' | 'patch') &&
        (isCurrentPrerelease || explicitlyRequestedPrerelease)
      ) {
        log(`Standard bump type with prerelease condition met`, 'debug');
        const prereleaseId = explicitlyRequestedPrerelease ? normalizedPrereleaseId : undefined;
        log(`Prerelease ID: ${prereleaseId}`, 'debug');

        log(
          explicitlyRequestedPrerelease
            ? `Creating prerelease version with identifier '${prereleaseId}' using ${specifiedType}`
            : `Bumping ${currentVersion} with ${specifiedType}`,
          'debug',
        );
        const result = bumpVersion(currentVersion, specifiedType, prereleaseId);
        log(`Specified type version: ${result}`, 'debug');
        return result;
      }

      log(`Non-standard or standard without prerelease condition`, 'debug');
      const isPrereleaseBumpType = ['premajor', 'preminor', 'prepatch'].includes(specifiedType);
      const isCreatingPrerelease = specifiedType === 'prerelease' && !semver.prerelease(currentVersion);
      log(`Is prerelease bump type: ${isPrereleaseBumpType}, is creating prerelease: ${isCreatingPrerelease}`, 'debug');
      const prereleaseId =
        config.isPrerelease || isPrereleaseBumpType || isCreatingPrerelease ? normalizedPrereleaseId : undefined;
      log(`Prerelease ID: ${prereleaseId}`, 'debug');
      const result = bumpVersion(currentVersion, specifiedType, prereleaseId);
      log(`Specified type version: ${result}`, 'debug');
      return result;
    }

    log(`Falling back to conventional commits`, 'debug');
    try {
      log(`Creating bumper with preset: ${preset}`, 'debug');
      const presetConfig = createPreset(preset);
      const bumper = new Bumper();
      bumper.config(presetConfig);
      // Bound the commit scan to the changelog's baseline: conventional-recommended-bump's own tag detection
      // misses baseline tags (e.g. `release/v0.29.0`) and would scan all history, inflating the bump. An
      // unresolvable tag falls back to the unbounded default rather than throwing.
      const latestTagReachable = options.hasRealTag !== false && !!latestTag && (await refExists(latestTag, pkgPath));
      const bumpFrom = config.baseRef ?? (latestTagReachable ? latestTag : undefined);
      // Omitted, not undefined: an undefined `from` replaces the bumper's own tag lookup.
      bumper.commits({
        ...(bumpFrom ? { from: bumpFrom } : {}),
        ...(commitScope.length > 0 ? { path: commitScope } : {}),
      });
      const recommendedBump = await bumper.bump(presetConfig.whatBump);
      const releaseTypeFromCommits =
        recommendedBump && 'releaseType' in recommendedBump ? (recommendedBump.releaseType as ReleaseType) : undefined;
      log(`Conventional commits release type: ${releaseTypeFromCommits}`, 'debug');

      const currentVersion = current.version;
      log(`Current version from conventional commits: ${currentVersion}`, 'debug');

      if (latestTagReachable) {
        const commitsLength = await getCommitsLength(commitScope, latestTag);
        log(`Commits since ${latestTag}: ${commitsLength}`, 'debug');
        if (commitsLength === 0) {
          log(`No new commits found for ${name || 'project'} since ${latestTag}, skipping version bump`, 'info');
          return '';
        }
      }

      log(`Checking if conventional commits indicate bump`, 'debug');
      if (!releaseTypeFromCommits) {
        log(`No release type from commits`, 'debug');
        if (latestTag && latestTag.trim() !== '') {
          log(`No relevant commits found for ${name || 'project'} since ${latestTag}, skipping version bump`, 'info');
        } else {
          log(`No relevant commits found for ${name || 'project'}, skipping version bump`, 'info');
        }
        return '';
      }

      log(`Release type from commits: ${releaseTypeFromCommits}`, 'debug');

      // The bumper returns 'major' for any breaking change, jumping 0.x to 1.0.0; keep inferred breaks on
      // the 0.x minor instead (see docs/configuration.md).
      let effectiveReleaseType = releaseTypeFromCommits;
      const isPre1 = semver.parse(currentVersion)?.major === 0;
      if ((config.zeroMajor ?? 'spec') === 'spec' && isPre1 && releaseTypeFromCommits === 'major') {
        effectiveReleaseType = 'minor';
        log("Pre-1.0 breaking change: downgrading inferred 'major' to 'minor' (zeroMajor: 'spec')", 'info');
      }

      // Inferred bumps always increment the prerelease counter - the base is a fixed target until graduation.
      if (
        semver.prerelease(currentVersion) !== null &&
        !config.stableOnly &&
        !config.isPrerelease &&
        STANDARD_BUMP_TYPES.includes(effectiveReleaseType as 'major' | 'minor' | 'patch')
      ) {
        const channelId = prereleaseIdOf(currentVersion) ?? normalizedPrereleaseId;
        log(`Advancing prerelease ${currentVersion} along its channel (increment, id: ${channelId})`, 'debug');
        return bumpVersion(currentVersion, 'prerelease', channelId);
      }

      const isPrereleaseBumpType = ['prerelease', 'premajor', 'preminor', 'prepatch'].includes(effectiveReleaseType);
      log(`Is prerelease bump type: ${isPrereleaseBumpType}`, 'debug');
      const prereleaseId = config.isPrerelease || isPrereleaseBumpType ? normalizedPrereleaseId : undefined;
      log(`Prerelease ID: ${prereleaseId}`, 'debug');
      const result = bumpVersion(currentVersion, effectiveReleaseType, prereleaseId);
      log(`Conventional commits version: ${result}`, 'debug');
      return result;
    } catch (error) {
      log(`Error in conventional commits calculation`, 'debug');
      log(`Failed to calculate version for ${name || 'project'}`, 'error');
      log(inspect(error), 'error');
      // git's error when no tags exist
      if (error instanceof Error && error.message.includes('No names found')) {
        log('No tags found, proceeding with initial version calculation (if applicable).', 'info');
        return initialVersion;
      }

      throw error;
    }
  } catch (error) {
    log(`Error in version calculation`, 'debug');
    log(`Failed to calculate version for ${name || 'project'}`, 'error');
    log(inspect(error), 'error');
    if (error instanceof Error && error.message.includes('No names found')) {
      log('No tags found, proceeding with initial version calculation (if applicable).', 'info');
      return initialVersion;
    }

    throw error;
  }
}
