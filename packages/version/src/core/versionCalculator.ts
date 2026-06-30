/**
 * Version calculation logic
 */

import { cwd } from 'node:process';
import { sanitizePackageName, shouldMatchPackageTargets } from '@releasekit/core';
import { Bumper } from 'conventional-recommended-bump';
import type { ReleaseType } from 'semver';
import semver from 'semver';
import { getCommitsLength, refExists } from '../git/tagsAndBranches.js';
import type { Config, VersionOptions } from '../types.js';
import { buildTagStripPatternFromTemplate, escapeRegExp } from '../utils/formatting.js';
import { log } from '../utils/logging.js';
import { getVersionFromManifests } from '../utils/manifestHelpers.js';
import {
  bumpVersion,
  getBestVersionSource,
  normalizePrereleaseIdentifier,
  STANDARD_BUMP_TYPES,
  type VersionSourceResult,
} from '../utils/versionUtils.js';

/**
 * Map a standard bump magnitude to the prerelease form that ESCALATES an existing prerelease's base
 * to a new line — used only when a maintainer explicitly declares the magnitude via a `bump:*` label
 * (#485). The commit-inferred default does NOT escalate; it increments the counter (the base is a
 * fixed target until graduation, #500).
 *  - `patch` → `prerelease` — advance the counter   (1.0.0-next.1 → 1.0.0-next.2)
 *  - `minor` → `preminor`   — escalate the base      (1.0.0-next.1 → 1.1.0-next.0)
 *  - `major` → `premajor`   — escalate the base      (1.0.0-next.1 → 2.0.0-next.0)
 * Any non-standard type (already a `pre*` / `prerelease` form) passes through unchanged.
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
 * The prerelease identifier embedded in a version (e.g. `1.0.0-next.1` → `next`), or undefined when
 * the version is stable or its prerelease segment carries no string identifier. Advancing along a
 * channel keeps the *current* line's identifier, so this is preferred over the configured default
 * (a config change is a deliberate line switch, out of scope for the advance-along-line default) (#485).
 */
function prereleaseIdOf(version: string): string | undefined {
  const pre = semver.prerelease(version);
  return pre && typeof pre[0] === 'string' ? pre[0] : undefined;
}

/**
 * Strip the forced `bump` / `prerelease` / `stable` override for a package outside `overrideScope`,
 * so it falls through to commit-driven calculation. Returns the (possibly scoped) config + options.
 * Scoping changes *who* the override applies to, never the composed-bump formula.
 */
export function applyOverrideScope(
  config: Config,
  options: VersionOptions,
): { config: Config; options: VersionOptions } {
  const { overrideScope, graduateScope } = config;
  let scoped: { config: Config; options: VersionOptions } = { config, options };
  // `type` / `isPrerelease` / `stableOnly` are the engine's runtime override fields (folded from
  // runOptions bump/prerelease/stable) — none is a static config-file setting, so clearing them to
  // their "not specified" sentinel reverts an out-of-scope package to commit-driven calculation.
  // When `options.name` is absent (a single-package repo) there's nothing to match against, so the
  // override applies — scoping is only meaningful across multiple packages.
  if (overrideScope?.length && options.name && !shouldMatchPackageTargets(options.name, overrideScope)) {
    scoped = {
      config: { ...scoped.config, type: undefined, isPrerelease: undefined, stableOnly: undefined },
      options: { ...scoped.options, type: undefined },
    };
  }
  // Per-package graduation (#486): `graduateScope` membership is AUTHORITATIVE for `stableOnly`. A
  // package in scope graduates — re-assert `stableOnly` even when the `overrideScope` clearing above
  // stripped it, because a graduate target can be a transitive prerequisite that sits OUTSIDE
  // `overrideScope` when `release:with-prerequisites` is also active; without this re-assert the
  // explicit graduation would be silently lost. A package out of scope keeps its line — clear
  // `stableOnly`. Gate ONLY `stableOnly` (graduation is bump-less, so any `type`/`isPrerelease` the
  // overrideScope branch cleared stays cleared — that's fine, graduation ignores them). `graduateScope`
  // is only ever set together with `stableOnly: true` (the engine folds them from `runOptions.graduate`),
  // so re-asserting `true` here can't fabricate a graduation the run didn't ask for. An empty
  // `graduateScope` with `stableOnly` set means "graduate everything" (global release:graduate) — no-op.
  if (graduateScope?.length && options.name) {
    const inGraduateScope = shouldMatchPackageTargets(options.name, graduateScope);
    scoped = { ...scoped, config: { ...scoped.config, stableOnly: inGraduateScope ? true : undefined } };
  }
  return scoped;
}

/**
 * First-release overshoot guard (#388): on a first release (no prior tag) with an already-stable
 * manifest, `--stable --bump <type>` APPLIES the bump (1.0.0 → 2.0.0) rather than graduating, which
 * silently overshoots the staged first version. The resolved version is deliberately left unchanged
 * — a bump is sometimes legitimate (importing a package with prior external history) — so this only
 * makes the case visible/escapable per `mismatchStrategy`: `error` aborts, `ignore` is silent,
 * everything else (default `warn`) warns. `version.allowFirstBump` (or `--allow-first-bump`)
 * acknowledges it and stays silent. (prefer-package/prefer-git have no distinct meaning on the
 * no-tag axis, so they warn like the default — see #388.)
 */
function guardFirstReleaseBump(config: Config, name: string | undefined, currentVer: string, type: ReleaseType): void {
  if (config.allowFirstBump) return;
  const pkg = name || 'package';
  const bumped = bumpVersion(currentVer, type);
  const message =
    `${pkg} has no prior tag and a stable manifest (${currentVer}); --bump ${type} will publish ${bumped}, not ${currentVer}. ` +
    `To release ${currentVer}, stage the manifest at a prerelease (e.g. ${currentVer}-next.0, which graduates), ` +
    `or set version.allowFirstBump (or pass --allow-first-bump) to apply the bump.`;
  if ((config.mismatchStrategy ?? 'warn') === 'error') {
    throw new Error(`First-release version overshoot: ${message}`);
  }
  if (config.mismatchStrategy === 'ignore') return;
  log(message, 'warning');
}

/**
 * Calculates the next version number based on the current version and options
 */
export async function calculateVersion(config: Config, options: VersionOptions): Promise<string> {
  const scoped = applyOverrideScope(config, options);
  return calculateVersionInner(scoped.config, scoped.options);
}

async function calculateVersionInner(config: Config, options: VersionOptions): Promise<string> {
  log(`Starting version calculation for ${options.name || 'project'}`, 'debug');

  const {
    type: configType,
    preset = 'angular',
    versionPrefix,
    prereleaseIdentifier: configPrereleaseIdentifier,
    mismatchStrategy,
    strictReachable,
  } = config;

  const {
    latestTag,
    name,
    path: pkgPath,
    commitCheckPath,
    type: optionsType,
    prereleaseIdentifier: optionsPrereleaseIdentifier,
  } = options;

  // Prioritize type and prereleaseIdentifier from options, fallback to config
  const type = optionsType || configType;
  const prereleaseIdentifier = optionsPrereleaseIdentifier || configPrereleaseIdentifier;

  const initialVersion = '0.1.0'; // Default initial version

  const hasNoTags = options.hasRealTag === false || !latestTag || latestTag.trim() === '';
  log(`Resolved type: ${type}, hasNoTags: ${hasNoTags}, hasRealTag: ${options.hasRealTag}`, 'debug');

  // Normalize prereleaseIdentifier (handles boolean true -> 'next', etc.)
  const normalizedPrereleaseId = normalizePrereleaseIdentifier(prereleaseIdentifier, config);

  try {
    const originalPrefix = versionPrefix || '';
    log(`Original prefix: ${originalPrefix}`, 'debug');

    // Build a regex pattern that strips the package + separator prefix from a tag
    // Uses dynamic pattern generation from tagTemplate when it includes packageName,
    // otherwise falls back to hardcoded patterns for backward compatibility
    function buildTagStripPattern(packageName: string | undefined, prefix: string): string {
      // If a tagTemplate is configured AND it includes packageName, use dynamic pattern generation
      /* biome-ignore lint/suspicious/noTemplateCurlyInString: searching for literal template placeholder */
      if (config.tagTemplate && packageName && config.tagTemplate.includes('${packageName}')) {
        const templatePattern = buildTagStripPatternFromTemplate(config.tagTemplate, packageName, prefix);
        if (templatePattern) {
          return templatePattern;
        }
      }

      // Fallback to hardcoded patterns for backward compatibility
      if (!packageName) return escapeRegExp(prefix);
      const sanitized = sanitizePackageName(packageName);
      const escapedRaw = escapeRegExp(`${packageName}@${prefix}`);
      const escapedDash = escapeRegExp(`${sanitized}-${prefix}`);
      return `(?:${escapedRaw}|${escapedDash})`;
    }

    let escapedTagPattern = buildTagStripPattern(name, originalPrefix);

    // When `baselineTagTemplate` is configured, the latestTag may carry the baseline's
    // multi-segment prefix (e.g. `release/v0.21.0`). The default tag-strip pattern only
    // strips the consumer-tag prefix (`v`), so semver.clean on the residue still returns
    // null and the version source falls through to '0.0.0' → 0.1.0. Extend the pattern
    // with the baseline prefix as an alternative so both shapes are stripped correctly.
    if (config.baselineTagTemplate) {
      const baselinePrefix = config.baselineTagTemplate
        .split('${' + 'version}')[0]
        .replace(/\$\{prefix\}/g, originalPrefix)
        .replace(/\$\{packageName\}/g, name ? sanitizePackageName(name) : '');
      if (baselinePrefix) {
        escapedTagPattern = `(?:${escapeRegExp(baselinePrefix)}|${escapedTagPattern})`;
      }
    }

    // Get the best available version source using smart fallback
    let versionSource: VersionSourceResult | undefined;

    if (pkgPath) {
      const packageDir = pkgPath;
      const manifestResult = getVersionFromManifests(packageDir);
      const packageVersion =
        manifestResult.manifestFound && manifestResult.version ? manifestResult.version : undefined;

      versionSource = await getBestVersionSource(
        latestTag,
        packageVersion,
        packageDir,
        mismatchStrategy,
        strictReachable,
      );
      log(`Using version source: ${versionSource.source} (${versionSource.reason})`, 'info');
      log(`Version source version: ${versionSource.version}`, 'debug');
    }

    // Helper function to get current version from version source
    function getCurrentVersionFromSource(): string {
      if (!versionSource) {
        // Fallback to old logic if no version source determined
        if (hasNoTags) {
          log(`No tags, using initial version: ${initialVersion}`, 'debug');
          return initialVersion;
        }
        const cleanedTag = semver.clean(latestTag) || latestTag;
        const version = semver.clean(cleanedTag.replace(new RegExp(`^${escapedTagPattern}`), '')) || '0.0.0';
        log(`Fallback version from tag: ${version}`, 'debug');
        return version;
      }

      if (versionSource.source === 'git') {
        // Extract version from git tag (remove prefix if present)
        const cleanedTag = semver.clean(versionSource.version) || versionSource.version;
        const version = semver.clean(cleanedTag.replace(new RegExp(`^${escapedTagPattern}`), '')) || '0.0.0';
        log(`Git version: ${version}`, 'debug');
        return version;
      }

      // For package or initial source, use the version directly
      log(`Package/initial version: ${versionSource.version}`, 'debug');
      return versionSource.version;
    }

    // First release scenario: no previous tag. Emit a warning but fall through to normal
    // bump/stable/prerelease logic using the manifest version as the base. Returning the
    // manifest verbatim here would silently ignore --stable, --bump, and prereleaseIdentifier
    // inputs, causing wrong identifiers or missed graduations on first release (#347).
    log(
      `Checking first release scenario: latestTag=${latestTag}, type=${type}, stableOnly=${config.stableOnly}`,
      'debug',
    );
    if (hasNoTags && type) {
      log(`No previous tag found for ${name || 'project'} - this appears to be a first release`, 'warning');
    }

    // Handle stableOnly mode: graduate prerelease → stable base; skip already-stable packages.
    // This is triggered by `release:graduate` without a bump label.
    log(`Checking stableOnly mode: ${config.stableOnly}`, 'debug');
    if (config.stableOnly) {
      log(`StableOnly mode activated`, 'debug');
      const currentVer = getCurrentVersionFromSource();
      log(`Current version in stableOnly: ${currentVer}`, 'debug');
      if (semver.prerelease(currentVer)) {
        log(`Current version is prerelease, graduating`, 'debug');
        // Always graduate prerelease to stable base — bump label magnitude is irrelevant for graduation
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
        // No explicit bump label: skip already-stable packages
        log(`Skipping ${name || 'package'}: already at stable version ${currentVer}`, 'info');
        return '';
      } else if (hasNoTags) {
        // Stable manifest + explicit bump on a FIRST release: the bump is APPLIED (e.g. 1.0.0 +
        // major = 2.0.0), not graduated, silently overshooting the staged first version (#388).
        // Make it visible/escapable per mismatchStrategy; the resolved version is unchanged.
        guardFirstReleaseBump(config, name, currentVer, type);
      }
      log(`Stable package with explicit bump label, falling through to normal logic`, 'debug');
      // Stable package with explicit bump label: fall through to normal bump logic
    }

    // 1. Handle specific type if provided
    const specifiedType = type;
    log(`Specified type: ${specifiedType}`, 'debug');

    if (specifiedType) {
      log(`Handling specified type: ${specifiedType}`, 'debug');
      const currentVersion = getCurrentVersionFromSource();
      log(`Current version for specified type: ${currentVersion}`, 'debug');

      // Handle prerelease versions with our helper
      const isCurrentPrerelease = semver.prerelease(currentVersion);
      const explicitlyRequestedPrerelease = config.isPrerelease;
      log(
        `Is current prerelease: ${!!isCurrentPrerelease}, explicitly requested prerelease: ${explicitlyRequestedPrerelease}`,
        'debug',
      );

      // Per-package channel default (#485): a package whose current version is a prerelease advances
      // along its own prerelease line rather than graduating to stable — UNLESS an explicit channel
      // action is in play (`--stable` / release:graduate sets stableOnly and graduates above;
      // `--prerelease` / channel:prerelease sets isPrerelease, handled by the existing branch below).
      // This is the EXPLICIT-bump path (a `bump:*` label set `type`): the maintainer declared a
      // magnitude, so honour it — a minor/major escalates the base to a fresh line (1.0.0-next.6 →
      // 1.1.0-next.0), a patch advances the counter. The commit-inferred DEFAULT instead always
      // increments the counter (the base is a fixed target until graduation, #500) — see the
      // conventional-commits branch below. Keystone that removes the global auto-graduate.
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
      // For non-standard bump types (premajor, preminor, prepatch), always use prereleaseIdentifier
      // For --bump prerelease, use prereleaseIdentifier only when creating from stable (not incrementing)
      // For standard bump types, only use if explicitly requested via --prerelease flag
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

    // 2. Fallback to conventional-commits
    log(`Falling back to conventional commits`, 'debug');
    try {
      log(`Creating bumper with preset: ${preset}`, 'debug');
      const bumper = new Bumper();
      bumper.loadPreset(preset);
      // Bound the commit scan to the same baseline the changelog uses (`config.baseRef ?? latestTag`).
      // Without the latestTag fallback an absent baseRef lets conventional-recommended-bump scan the
      // ENTIRE history — the repo's baseline tags (e.g. `release/v0.29.0`) aren't in a format its
      // default tag-detection recognises — so accumulated historical feats inflate the bump magnitude
      // (a docs-only window bumps minor instead of patch). Guard the tag with rev-parse so an absent
      // ref falls back to the unbounded default rather than throwing. See #330.
      const latestTagReachable = !!latestTag && (await refExists(latestTag, pkgPath));
      const bumpFrom = config.baseRef ?? (latestTagReachable ? latestTag : undefined);
      if (bumpFrom) {
        bumper.commits({ from: bumpFrom });
      }
      const recommendedBump = await bumper.bump();
      const releaseTypeFromCommits =
        recommendedBump && 'releaseType' in recommendedBump ? (recommendedBump.releaseType as ReleaseType) : undefined;
      log(`Conventional commits release type: ${releaseTypeFromCommits}`, 'debug');

      // Get current version from version source
      const currentVersion = getCurrentVersionFromSource();
      log(`Current version from conventional commits: ${currentVersion}`, 'debug');

      // Check if we have a version source to compare against for commit counting
      // Use the actual version source (could be git tag or package version) instead of raw latestTag
      log(`Checking commit counting logic`, 'debug');
      if (versionSource && versionSource.source === 'git') {
        log(`Version source is git, checking commits`, 'debug');
        // If we're using a git tag as version source, check for new commits since that tag.
        // commitCheckPath overrides pkgPath for this check (used by sync mode to count
        // commits from the repo root rather than a single workspace package directory).
        const checkPath = commitCheckPath || pkgPath || cwd();
        const commitsLength = await getCommitsLength(checkPath, versionSource.version); // Use the actual tag from version source
        log(`Commits since ${versionSource.version}: ${commitsLength}`, 'debug');
        if (commitsLength === 0) {
          log(
            `No new commits found for ${name || 'project'} since ${versionSource.version}, skipping version bump`,
            'info',
          );
          return ''; // No change needed
        }
      } else if (versionSource && versionSource.source === 'package') {
        log(`Version source is package, skipping commit count`, 'debug');
        // If we're using package version as source, we can't count commits against it
        // In this case, let conventional commits determine if there should be a bump
        log(
          `Using package version ${versionSource.version} as base, letting conventional commits determine bump necessity`,
          'debug',
        );
      } else {
        log(`No version source or unknown source type`, 'debug');
      }

      // If no git tag or we have commits, check if conventional commits indicate a bump
      log(`Checking if conventional commits indicate bump`, 'debug');
      if (!releaseTypeFromCommits) {
        log(`No release type from commits`, 'debug');
        if (latestTag && latestTag.trim() !== '') {
          log(`No relevant commits found for ${name || 'project'} since ${latestTag}, skipping version bump`, 'info');
        } else {
          log(`No relevant commits found for ${name || 'project'}, skipping version bump`, 'info');
        }
        return ''; // No bump indicated by conventional commits
      }

      log(`Release type from commits: ${releaseTypeFromCommits}`, 'debug');

      // The bumper returns 'major' for a breaking change without consulting the current version,
      // so pre-1.0 it would jump 0.x straight to 1.0.0. Keep inferred breaking changes on the 0.x
      // minor instead (rationale + the zeroMajor escape hatch: docs/configuration.md, issue #274).
      // Inferred-only: the explicit-override branch above is intentionally left to graduate to 1.0.
      // Only 'major' needs downgrading — the bumper never emits a pre-type here.
      let effectiveReleaseType = releaseTypeFromCommits;
      const isPre1 = semver.parse(currentVersion)?.major === 0;
      if ((config.zeroMajor ?? 'spec') === 'spec' && isPre1 && releaseTypeFromCommits === 'major') {
        effectiveReleaseType = 'minor';
        log("Pre-1.0 breaking change: downgrading inferred 'major' to 'minor' (zeroMajor: 'spec')", 'info');
      }

      // Per-package channel default (#485): advance an existing prerelease along its own line rather
      // than graduating it, unless an explicit channel action is in play. This is the COMMIT-INFERRED
      // default (no `bump:*` label) — it always increments the prerelease counter regardless of the
      // inferred magnitude, because the base is a fixed target until graduation (#500). An explicit
      // `bump:*` label takes the specified-type branch above and escalates the base instead.
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
      // Handle errors during conventional bump calculation
      log(`Failed to calculate version for ${name || 'project'}`, 'error');
      console.error(error);
      // Check if the error is specifically due to no tags found by underlying git commands
      if (error instanceof Error && error.message.includes('No names found')) {
        log('No tags found, proceeding with initial version calculation (if applicable).', 'info');
        // If conventional bump failed *because* of no tags, return initial version
        return initialVersion;
      }

      // Rethrow unexpected errors to prevent silent failures
      throw error;
    }
  } catch (error) {
    log(`Error in version calculation`, 'debug');
    // Handle errors during conventional bump calculation
    log(`Failed to calculate version for ${name || 'project'}`, 'error');
    console.error(error);
    // Check if the error is specifically due to no tags found by underlying git commands
    if (error instanceof Error && error.message.includes('No names found')) {
      log('No tags found, proceeding with initial version calculation (if applicable).', 'info');
      // If conventional bump failed *because* of no tags, return initial version
      return initialVersion;
    }

    // Rethrow unexpected errors to prevent silent failures
    throw error;
  }
}
