import * as fs from 'node:fs';
import path from 'node:path';
import type { Package } from '@manypkg/get-packages';
import type { VersionChangelogEntry } from '@releasekit/core';
import { shouldMatchPackageTargets, shouldProcessPackage } from '@releasekit/core';
import { extractChangelogEntriesFromCommits, extractRepoLevelChangelogEntries } from '../changelog/commitParser.js';
import { BaselineResolver } from '../core/baselineResolver.js';
import { calculateVersion } from '../core/versionCalculator.js';
import { StrictReachableError } from '../errors/strictReachableError.js';
import { getLatestTagForPackage } from '../git/tagsAndBranches.js';
import type { Config, VersionConfigBase } from '../types.js';
import { deriveBaselineTagPrefix, formatCommitMessage, formatTag, formatVersionPrefix } from '../utils/formatting.js';
import {
  addChangelogData,
  addTag,
  setCommitMessage,
  setPackageUpdateAction,
  setPackageUpdateTag,
  setSharedEntries,
} from '../utils/jsonOutput.js';
import { log } from '../utils/logging.js';
import { getVersionFromManifests } from '../utils/manifestHelpers.js';
import { resolveVersionAction } from '../utils/versionAction.js';
import { updatePackageVersion } from './packageManagement.js';

type ChangelogEntry = VersionChangelogEntry;

export interface PackageProcessorOptions {
  skip?: string[];
  versionPrefix?: string;
  tagTemplate?: string;
  commitMessageTemplate?: string;
  dryRun?: boolean;
  getLatestTag: () => Promise<string | null>;
  config: Omit<VersionConfigBase, 'versionPrefix' | 'path' | 'name'>;
  // Config needed for version calculation
  fullConfig: Config;
}

export interface ProcessResult {
  updatedPackages: Array<{
    name: string;
    version: string;
    path: string;
  }>;
  commitMessage?: string;
  tags: string[];
}

export class PackageProcessor {
  private skip: string[];
  private versionPrefix: string;
  private tagTemplate?: string;
  private commitMessageTemplate: string;
  private dryRun: boolean;
  private getLatestTag: () => Promise<string | null>;
  private config: Omit<VersionConfigBase, 'versionPrefix' | 'path' | 'name'>;
  // Config for version calculation
  private fullConfig: Config;

  constructor(options: PackageProcessorOptions) {
    this.skip = options.skip || [];
    this.versionPrefix = options.versionPrefix || 'v';
    this.tagTemplate = options.tagTemplate;
    this.commitMessageTemplate = options.commitMessageTemplate || '';
    this.dryRun = options.dryRun || false;
    this.getLatestTag = options.getLatestTag;
    this.config = options.config;
    this.fullConfig = options.fullConfig;
  }

  /**
   * Process packages based on skip list only (targeting handled at discovery time)
   */
  async processPackages(packages: Package[]): Promise<ProcessResult> {
    const tags: string[] = [];
    const updatedPackagesInfo: Array<{ name: string; version: string; path: string }> = [];

    // 1. Basic validation
    if (!packages || !Array.isArray(packages)) {
      log('Invalid packages data provided. Expected array of packages.', 'error');
      return { updatedPackages: [], tags: [] };
    }

    // 2. Apply skip filtering only (targeting is handled at discovery time)
    const pkgsToConsider = packages.filter((pkg) => {
      const pkgName = pkg.packageJson.name;
      const shouldProcess = shouldProcessPackage(pkgName, this.skip);

      if (!shouldProcess) {
        log(`Skipping package ${pkgName} as it's in the skip list.`, 'info');
      }

      return shouldProcess;
    });

    log(`Found ${pkgsToConsider.length} package(s) to process after filtering.`, 'info');

    if (pkgsToConsider.length === 0) {
      log('No packages found to process.', 'info');
      return { updatedPackages: [], tags: [] };
    }

    // 3. Process each targeted package
    // Accumulate repo-level entries across all packages (keyed by type+description to deduplicate)
    const sharedEntriesMap = new Map<string, ChangelogEntry>();

    // BaselineResolver owns the per-package changelog floor (B) and the repo-level shared floor (C),
    // constructed once per run so the nearest-reachable shared floor (#348) is computed a single time
    // and reused across packages.
    const baselineResolver = new BaselineResolver({
      versionPrefix: this.versionPrefix,
      tagTemplate: this.tagTemplate,
      packageSpecificTags: this.fullConfig.packageSpecificTags ?? false,
      strictReachable: this.config.strictReachable ?? false,
      baseRef: this.fullConfig.baseRef,
      sharedFloorCwd: process.cwd(),
      sharedChangelogFloor: this.fullConfig.sharedChangelogFloor,
    });

    for (const pkg of pkgsToConsider) {
      const name = pkg.packageJson.name;
      const pkgPath = pkg.dir;
      log(`Processing package ${name} at path: ${pkgPath}`, 'info');
      const formattedPrefix = formatVersionPrefix(this.versionPrefix);
      // For package-specific tags, we may need to request package-specific version history
      // Try to get the latest tag specific to this package first
      let latestTagResult = '';
      let hasRealTag = false;
      // Whether `latestTag` came from this package's own tag series (vs. the global/manifest
      // fallback below). Decides which stable-tag lookup to use when graduating, since
      // `packageSpecificTags: true` can still fall back to a global tag for a package without its
      // own tag history.
      let usedPackageSpecificTag = false;
      try {
        latestTagResult = await getLatestTagForPackage(name, this.versionPrefix, {
          tagTemplate: this.tagTemplate,
          packageSpecificTags: this.fullConfig.packageSpecificTags,
        });
        hasRealTag = !!latestTagResult;
        usedPackageSpecificTag = !!latestTagResult;
      } catch (error) {
        // Log the specific error, but continue with fallback
        const errorMessage = error instanceof Error ? error.message : String(error);
        log(`Error getting package-specific tag for ${name}, falling back to global tag: ${errorMessage}`, 'warning');
      }

      // Fallback to global tag if no package-specific tag exists
      if (!latestTagResult) {
        try {
          // First try the package manifest files as fallback
          const packageDir = pkgPath;
          let manifestFallbackUsed = false;

          // Use the centralized helper to check manifests
          const manifestResult = getVersionFromManifests(packageDir);
          if (manifestResult.manifestFound && manifestResult.version) {
            log(
              `Using ${manifestResult.manifestType} version ${manifestResult.version} for ${name} as no package-specific tags found`,
              'info',
            );
            log(`FALLBACK: Using package version from ${manifestResult.manifestType} instead of global tag`, 'debug');
            // We'll create a fake tag with this version to use as base
            latestTagResult = `${this.versionPrefix || ''}${manifestResult.version}`;
            manifestFallbackUsed = true;
          }

          // Only if we couldn't use either manifest file, try global tag
          if (!manifestFallbackUsed) {
            const globalTagResult = await this.getLatestTag();
            if (globalTagResult) {
              latestTagResult = globalTagResult;
              hasRealTag = true; // Global tag is a real git tag
              log(`Using global tag ${globalTagResult} as fallback for package ${name}`, 'info');
            }
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          log(`Error getting fallback version, using empty tag value: ${errorMessage}`, 'warning');
        }
      }

      // At this point, latestTagResult is guaranteed to be a string (possibly empty)
      const latestTag = latestTagResult;

      const nextVersion = await calculateVersion(this.fullConfig, {
        latestTag,
        hasRealTag,
        versionPrefix: formattedPrefix,
        path: pkgPath,
        name,
        prereleaseIdentifier: this.config.prereleaseIdentifier,
        type: this.config.type,
      });

      if (!nextVersion) {
        continue; // No version change calculated for this package
      }

      // previousVersion is shown to users in the changelog header — strip the baseline-tag scheme
      // back to its consumer-facing form so `release/v0.22.0` appears as `v0.22.0`.
      const baselineTagPrefix = deriveBaselineTagPrefix(this.fullConfig.baselineTagTemplate, formattedPrefix, name);

      // #334: a package with no prior git tag has its changelog computed from the FULL git history,
      // which in standing-PR mode can push the rendered PR body past GitHub's 65,536-char limit and
      // fail PR creation with an opaque 422 (#333). Surface it loudly with an actionable baseline-tag
      // suggestion. (baseRef-scoped runs — advisory preview — are bounded to the PR, so skip them.)
      if (!hasRealTag && !this.fullConfig.baseRef) {
        const currentVersion = pkg.packageJson.version;
        const suggestedTag = currentVersion
          ? formatTag(currentVersion, formattedPrefix, name, this.tagTemplate, this.fullConfig.packageSpecificTags)
          : undefined;
        log(
          `No prior tag found for ${name} — its changelog will include the full git history.` +
            (suggestedTag
              ? ` Create a baseline tag to scope it: git tag ${suggestedTag} <release-sha> && git push origin ${suggestedTag}`
              : ''),
          'warning',
        );
      }

      // Generate changelog entries from conventional commits. The changelog floor (range,
      // reachability, prerelease→stable graduation) is resolved by BaselineResolver.
      let changelogEntries: ChangelogEntry[] = [];
      let revisionRange = 'HEAD';
      let previousVersion: string | null = null;

      try {
        const baseline = await baselineResolver.resolve({
          pkgDir: pkgPath,
          latestTag,
          hasRealTag,
          usedPackageSpecificTag,
          nextVersion,
          graduationName: name,
          baselineTagPrefix,
          formattedPrefix,
        });
        revisionRange = baseline.revisionRange;
        previousVersion = baseline.previousVersion;

        changelogEntries = await extractChangelogEntriesFromCommits(pkgPath, revisionRange);

        // Also extract repo-level commits (those touching no package dir, plus declared shared
        // packages whose changes belong project-wide). Classify against the FULL discovered
        // workspace, not the filtered release set (`packages`) — otherwise a commit touching only a
        // *non-releasing* package's dir touches "no package" and wrongly leaks into the shared block
        // (#397). Falls back to the processing set when the engine didn't populate the workspace
        // (e.g. a direct PackageProcessor construction in tests).
        const workspace =
          this.fullConfig.allWorkspacePackages ?? packages.map((p) => ({ name: p.packageJson.name, dir: p.dir }));
        const allPackageDirs = workspace.map((p) => p.dir);
        // Foundational packages whose changes route to repo-level, from config (exact name or glob).
        // No hardcoded names — a consumer declares its own via `version.sharedPackages` (#406).
        const sharedPackagePatterns = this.fullConfig.sharedPackages ?? [];
        const sharedPackageDirs =
          sharedPackagePatterns.length === 0
            ? []
            : workspace.filter((p) => shouldMatchPackageTargets(p.name, sharedPackagePatterns)).map((p) => p.dir);
        // Bound the repo-level ("shared") entries by the run's nearest-reachable floor when this
        // package's own range collapsed to full history (untagged / unreachable), so a single
        // untagged package doesn't flood "Project-wide changes" with the entire history (#348).
        const sharedRevisionRange = await baselineResolver.sharedFloor(revisionRange);

        const repoLevelEntries = await extractRepoLevelChangelogEntries(
          pkgPath,
          sharedRevisionRange,
          allPackageDirs,
          sharedPackageDirs,
        );

        // Accumulate repo-level commits separately — they will be emitted once on VersionOutput
        // rather than duplicated into every individual package changelog.
        if (repoLevelEntries.length > 0) {
          log(`Found ${repoLevelEntries.length} repo-level commit(s) for ${name}`, 'debug');
          for (const entry of repoLevelEntries) {
            sharedEntriesMap.set(`${entry.type}:${entry.description}`, entry);
          }
        }

        // If we have no entries but we're definitely changing versions,
        // add a minimal entry about the version change
        if (changelogEntries.length === 0) {
          changelogEntries = [
            {
              type: 'changed',
              description: `Update version to ${nextVersion}`,
            },
          ];
        }
      } catch (error) {
        // A strictReachable violation must abort the run, not degrade to a minimal entry (#372).
        if (error instanceof StrictReachableError) throw error;
        log(`Error extracting changelog entries: ${error instanceof Error ? error.message : String(error)}`, 'warning');
        // Fall back to minimal entry
        changelogEntries = [
          {
            type: 'changed',
            description: `Update version to ${nextVersion}`,
          },
        ];
      }

      // Determine repo URL from package.json or git config
      let repoUrl: string | undefined;
      try {
        const packageJsonPath = path.join(pkgPath, 'package.json');
        if (fs.existsSync(packageJsonPath)) {
          const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
          if (packageJson.repository) {
            if (typeof packageJson.repository === 'string') {
              repoUrl = packageJson.repository;
            } else if (packageJson.repository.url) {
              repoUrl = packageJson.repository.url;
            }

            // Clean up GitHub URL format if needed
            if (repoUrl?.startsWith('git+') && repoUrl?.endsWith('.git')) {
              repoUrl = repoUrl.substring(4, repoUrl.length - 4);
            }
          }
        }
      } catch (error) {
        log(
          `Could not determine repository URL for changelog links: ${error instanceof Error ? error.message : String(error)}`,
          'warning',
        );
      }

      // Track changelog data for JSON output. previousVersion is resolved by BaselineResolver (the
      // floor tag in consumer-facing display form, null when we fell back to all-history, #339).
      addChangelogData({
        packageName: name,
        version: nextVersion,
        previousVersion,
        revisionRange,
        repoUrl: repoUrl || null,
        entries: changelogEntries,
      });

      // Update both package.json and Cargo.toml if they exist.
      // Note: There is no priority between package.json and Cargo.toml.
      //       Both files are updated independently if they are present.
      //       Each manifest will receive the same calculated version.
      //       This ensures consistent versioning across language ecosystems.
      const packageJsonPath = path.join(pkgPath, 'package.json');

      // Always update package.json if it exists
      if (fs.existsSync(packageJsonPath)) {
        updatePackageVersion(packageJsonPath, nextVersion, this.dryRun);
      }

      // Check if Cargo.toml handling is enabled (default to true if not specified)
      const cargoEnabled = this.fullConfig.cargo?.enabled !== false;
      log(`Cargo enabled for ${name}: ${cargoEnabled}, config: ${JSON.stringify(this.fullConfig.cargo)}`, 'debug');

      if (cargoEnabled) {
        // Check for cargo paths configuration
        const cargoPaths = this.fullConfig.cargo?.paths;
        log(`Cargo paths config for ${name}: ${JSON.stringify(cargoPaths)}`, 'debug');

        if (cargoPaths && cargoPaths.length > 0) {
          // If paths are specified, only include those Cargo.toml files
          for (const cargoPath of cargoPaths) {
            const resolvedCargoPath = path.resolve(pkgPath, cargoPath, 'Cargo.toml');
            log(`Checking cargo path for ${name}: ${resolvedCargoPath}`, 'debug');
            if (fs.existsSync(resolvedCargoPath)) {
              log(`Found Cargo.toml for ${name} at ${resolvedCargoPath}, updating...`, 'debug');
              updatePackageVersion(resolvedCargoPath, nextVersion, this.dryRun);
            } else {
              log(`Cargo.toml not found at ${resolvedCargoPath}`, 'debug');
            }
          }
        } else {
          // Default behaviour: check for Cargo.toml in the root package directory
          const cargoTomlPath = path.join(pkgPath, 'Cargo.toml');
          log(`Checking default cargo path for ${name}: ${cargoTomlPath}`, 'debug');
          if (fs.existsSync(cargoTomlPath)) {
            log(`Found Cargo.toml for ${name} at ${cargoTomlPath}, updating...`, 'debug');
            updatePackageVersion(cargoTomlPath, nextVersion, this.dryRun);
          } else {
            log(`Cargo.toml not found for ${name} at ${cargoTomlPath}`, 'debug');
          }
        }
      } else {
        log(`Cargo disabled for ${name}`, 'debug');
      }

      // Check if Dart/pubspec.yaml handling is enabled (default to true if not specified)
      const pubEnabled = this.fullConfig.pub?.enabled !== false;
      log(`Pub enabled for ${name}: ${pubEnabled}, config: ${JSON.stringify(this.fullConfig.pub)}`, 'debug');

      if (pubEnabled) {
        const dartPaths = this.fullConfig.pub?.paths;
        log(`Pub paths config for ${name}: ${JSON.stringify(dartPaths)}`, 'debug');

        if (dartPaths && dartPaths.length > 0) {
          for (const dartPath of dartPaths) {
            const resolvedPubspecPath = path.resolve(pkgPath, dartPath, 'pubspec.yaml');
            log(`Checking pub path for ${name}: ${resolvedPubspecPath}`, 'debug');
            if (fs.existsSync(resolvedPubspecPath)) {
              log(`Found pubspec.yaml for ${name} at ${resolvedPubspecPath}, updating...`, 'debug');
              updatePackageVersion(resolvedPubspecPath, nextVersion, this.dryRun);
            } else {
              log(`pubspec.yaml not found at ${resolvedPubspecPath}`, 'debug');
            }
          }
        } else {
          const pubspecPath = path.join(pkgPath, 'pubspec.yaml');
          log(`Checking default pub path for ${name}: ${pubspecPath}`, 'debug');
          if (fs.existsSync(pubspecPath)) {
            log(`Found pubspec.yaml for ${name} at ${pubspecPath}, updating...`, 'debug');
            updatePackageVersion(pubspecPath, nextVersion, this.dryRun);
          } else {
            log(`pubspec.yaml not found for ${name} at ${pubspecPath}`, 'debug');
          }
        }
      } else {
        log(`Pub disabled for ${name}`, 'debug');
      }

      // Create package-specific tag (using the updated formatTag function with package name)
      const packageTag = formatTag(
        nextVersion,
        this.versionPrefix,
        name,
        this.tagTemplate,
        this.fullConfig.packageSpecificTags,
      );
      // Track tag for JSON output (git ops now handled by publish)
      addTag(packageTag);
      setPackageUpdateTag(name, packageTag);
      // Resolved version action (#420) — derived from the same tag facts the calculator saw.
      // `hasNoTags` is `!hasRealTag`: a manifest-fallback synthetic tag isn't a real prior tag.
      const { action, reason } = resolveVersionAction({ hasNoTags: !hasRealTag, latestTag, nextVersion });
      setPackageUpdateAction(name, action, reason);
      tags.push(packageTag);

      if (this.dryRun) {
        log(`[DRY RUN] Would create tag: ${packageTag}`, 'info');
      } else {
        log(`Version ${nextVersion} prepared (tag: ${packageTag})`, 'success');
      }

      // Collect info for the final commit
      updatedPackagesInfo.push({ name, version: nextVersion, path: pkgPath });
    }

    // Emit accumulated repo-level entries as sharedEntries on the output
    setSharedEntries([...sharedEntriesMap.values()]);

    // 4. Create single commit if any packages were updated
    if (updatedPackagesInfo.length === 0) {
      log('No packages required a version update.', 'info');
      return { updatedPackages: [], tags };
    }

    // Build commit message for JSON output (git ops now handled by publish)
    const packageNames = updatedPackagesInfo.map((p) => p.name).join(', ');
    const representativeVersion = updatedPackagesInfo[0]?.version || 'multiple';
    const versionsMatch =
      updatedPackagesInfo.length <= 1 || updatedPackagesInfo.every((p) => p.version === representativeVersion);
    let commitMessage = this.commitMessageTemplate || 'chore: release';

    const MAX_COMMIT_MSG_LENGTH = 10000;
    if (commitMessage.length > MAX_COMMIT_MSG_LENGTH) {
      log('Commit message template too long, truncating', 'warning');
      commitMessage = commitMessage.slice(0, MAX_COMMIT_MSG_LENGTH);
    }
    const placeholderRegex = /\$\{[^{}$]{1,1000}\}/;
    if (placeholderRegex.test(commitMessage)) {
      // Template has placeholders: substitute with the combined package list and representative version.
      // For single-package releases this produces the exact configured message; for multi-package
      // releases the ${packageName} placeholder is replaced with the comma-separated list.
      // Note: ${version} always refers to the first package's version. Users who need per-package
      // versions in async mode should use the no-placeholder path or a custom template.
      const packageName = updatedPackagesInfo.length === 1 ? updatedPackagesInfo[0].name : packageNames;
      commitMessage = formatCommitMessage(commitMessage, representativeVersion, packageName);
    } else {
      // No placeholders in template — append package summary directly.
      // When all packages share the same version, use 'name1, name2 v1.2.0'.
      // When versions diverge (async independent bumps), use 'name1@1.2.0, name2@2.0.0' instead
      // to avoid silently referencing only the first package's version.
      if (versionsMatch) {
        const formattedVersion = `${formatVersionPrefix(this.versionPrefix)}${representativeVersion}`;
        commitMessage = `${commitMessage} ${packageNames} ${formattedVersion}`;
      } else {
        const packageVersionList = updatedPackagesInfo.map((p) => `${p.name}@${p.version}`).join(', ');
        commitMessage = `${commitMessage} ${packageVersionList}`;
      }
    }

    setCommitMessage(commitMessage);

    if (this.dryRun) {
      log(`[DRY RUN] Would commit with message: "${commitMessage}"`, 'info');
    }

    return {
      updatedPackages: updatedPackagesInfo,
      commitMessage,
      tags,
    };
  }
}
