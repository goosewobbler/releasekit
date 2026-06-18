import * as fs from 'node:fs';
import path from 'node:path';
import type { Package } from '@manypkg/get-packages';
import type { VersionChangelogEntry } from '@releasekit/core';
import { shouldProcessPackage } from '@releasekit/core';
import { extractChangelogEntriesFromCommits, extractRepoLevelChangelogEntries } from '../changelog/commitParser.js';
import { calculateVersion } from '../core/versionCalculator.js';
import {
  getLatestStableTag,
  getLatestStableTagForPackage,
  getLatestTagForPackage,
  getNearestReachableTag,
} from '../git/tagsAndBranches.js';
import { verifyTag } from '../git/tagVerification.js';
import type { Config, VersionConfigBase } from '../types.js';
import {
  deriveBaselineTagPrefix,
  displayTag,
  formatCommitMessage,
  formatTag,
  formatVersionPrefix,
} from '../utils/formatting.js';
import {
  addChangelogData,
  addTag,
  setCommitMessage,
  setPackageUpdateTag,
  setSharedEntries,
} from '../utils/jsonOutput.js';
import { log } from '../utils/logging.js';
import { getVersionFromManifests } from '../utils/manifestHelpers.js';
import { isStableTag, isStableVersion } from '../utils/versionUtils.js';
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

    // (#348) Lazy-computed floor for repo-level changelog entries. When an untagged package's
    // per-package revisionRange is 'HEAD' (all history), passing that same range to
    // extractRepoLevelChangelogEntries floods "Project-wide changes" with the full git history.
    // Bound it by the most recent release tag reachable from HEAD instead, computed on first
    // need and shared across all packages in this run.
    let _sharedBaselineRange: string | undefined;

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
        branchPattern: this.config.branchPattern,
        baseBranch: this.config.baseBranch,
        prereleaseIdentifier: this.config.prereleaseIdentifier,
        type: this.config.type,
      });

      if (!nextVersion) {
        continue; // No version change calculated for this package
      }

      // When a prerelease graduates to stable, aggregate the changelog from the last *stable* tag
      // rather than from `latestTag` (the prerelease, which usually holds only the release-prep
      // commit). `latestTag` still drives version calculation above — it must see the prerelease to
      // graduate correctly. With no prior stable tag (first stable release), `changelogBaseTag` is
      // '' and the range falls through to all commits.
      let changelogBaseTag = latestTag;
      if (hasRealTag && latestTag && isStableVersion(nextVersion) && !isStableTag(latestTag)) {
        // Follow latestTag's source (package series vs global) — the other lookup returns '' here
        // and would over-include every commit.
        changelogBaseTag = usedPackageSpecificTag
          ? await getLatestStableTagForPackage(name, this.versionPrefix, {
              tagTemplate: this.tagTemplate,
              packageSpecificTags: true,
            })
          : await getLatestStableTag(this.versionPrefix);
      }

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

      // Generate changelog entries from conventional commits
      let changelogEntries: ChangelogEntry[] = [];
      let revisionRange = 'HEAD';
      let baselineUnreachable = false;

      try {
        // Extract entries from commits between the base ref (or latest tag) and HEAD.
        // baseRef takes precedence — it's a PR base SHA supplied in advisory standing-pr mode
        // so the changelog is scoped to only this PR's commits, not all commits since last tag.
        const baseForRange = this.fullConfig.baseRef ?? changelogBaseTag;
        if (baseForRange && (this.fullConfig.baseRef || hasRealTag)) {
          // A real tag (or an explicit baseRef) — verify it. A failure here is the #339 case: the
          // ref genuinely exists but isn't reachable in this checkout (shallow clone / unpushed).
          const verification = verifyTag(baseForRange, pkgPath);
          if (verification.exists && verification.reachable) {
            revisionRange = `${baseForRange}..HEAD`;
          } else {
            if (!this.fullConfig.baseRef && this.config.strictReachable) {
              throw new Error(
                `Cannot generate changelog: ref '${baseForRange}' is not reachable from the current commit. ` +
                  `When strictReachable is enabled, all refs must be reachable. ` +
                  `To allow fallback to all commits, set strictReachable to false.`,
              );
            }
            // Loud, not debug: this silently produces a whole-history changelog (#339) — both this
            // package's entries and the repo-level entries below. Omit previousVersion so the
            // changelog doesn't claim a baseline it never diffed against.
            log(
              `Baseline ref '${baseForRange}' could not be verified from HEAD (${verification.error}) — generating ` +
                `the changelog from ALL history instead of since the last release. The ref is likely missing from the ` +
                `checkout (shallow clone, or never pushed). ${this.fullConfig.baseRef ? 'Fetch/push the ref to make it available in this checkout.' : 'Fetch/push the tag, or set version.baseRef, to bound it.'}`,
              'warning',
            );
            revisionRange = 'HEAD';
            baselineUnreachable = true;
          }
        } else if (baseForRange) {
          // No real tag — `baseForRange` is the manifest-fallback's synthetic tag, which isn't a git
          // ref. The #334 warning above already explained the full-history changelog accurately, so
          // skip verifyTag here: running it would emit a second, misleading "could not be verified —
          // shallow clone / unpushed" message about a tag that never existed.
          revisionRange = 'HEAD';
          baselineUnreachable = true;
        }

        changelogEntries = extractChangelogEntriesFromCommits(pkgPath, revisionRange);

        // Also extract repo-level commits (those that don't touch any non-shared package directory)
        // These include CI changes, infrastructure updates, and changes to shared packages (config, core)
        // that affect all packages
        const allPackageDirs = packages.map((p) => p.dir);
        // Define shared packages that should be included in all package changelogs
        const sharedPackageNames = ['config', 'core', '@releasekit/config', '@releasekit/core'];
        const sharedPackageDirs = packages
          .filter((p) => sharedPackageNames.includes(p.packageJson.name))
          .map((p) => p.dir);
        // Use the tighter of the per-package range (already bounded for tagged packages)
        // or the global baseline floor — applies to untagged packages and to packages whose
        // tag exists but is unreachable (shallow clone, #339), both of which produce revisionRange='HEAD'.
        let sharedRevisionRange = revisionRange;
        if (revisionRange === 'HEAD' && !this.fullConfig.baseRef) {
          if (_sharedBaselineRange === undefined) {
            // Most recent tag reachable from HEAD as the baseline floor — NOT `this.getLatestTag()`,
            // which goes through git-semver-tags and only matches bare-semver tags. In monorepos that
            // tag per package (`pkg@vX.Y.Z`) it returns '' and the floor wrongly collapsed to full
            // history (#348). `git describe` is prefix-agnostic and reachable by construction, so the
            // separate verifyTag check is no longer needed.
            const globalTag = getNearestReachableTag(process.cwd());
            _sharedBaselineRange = globalTag ? `${globalTag}..HEAD` : 'HEAD';
          }
          sharedRevisionRange = _sharedBaselineRange;
        }

        const repoLevelEntries = extractRepoLevelChangelogEntries(
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

      // Track changelog data for JSON output. previousVersion is shown to users in the
      // changelog header — strip the baseline-tag scheme back to its consumer-facing form
      // so `release/v0.22.0` appears as `v0.22.0` rather than leaking the internal marker.
      const baselineTagPrefix = deriveBaselineTagPrefix(this.fullConfig.baselineTagTemplate, formattedPrefix, name);
      addChangelogData({
        packageName: name,
        version: nextVersion,
        previousVersion:
          changelogBaseTag && !baselineUnreachable
            ? displayTag(changelogBaseTag, baselineTagPrefix, formattedPrefix)
            : null,
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
