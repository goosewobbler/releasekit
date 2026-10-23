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
import { resolveConfinedManifestPath } from '../utils/confinedPath.js';
import { deriveBaselineTagPrefix, formatCommitMessage, formatTag, formatVersionPrefix } from '../utils/formatting.js';
import {
  addChangelogData,
  addTag,
  setCommitMessage,
  setPackageUpdateAction,
  setPackageUpdatePreviousVersion,
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
   * Targeting is applied at discovery time, so only `skip` filters here. `repoRoot` confines
   * config-driven `cargo.paths` / `pub.paths` writes; pass the workspace root, since the tool can run
   * from a subdirectory narrower than the repo.
   */
  async processPackages(packages: Package[], repoRoot: string = process.cwd()): Promise<ProcessResult> {
    const tags: string[] = [];
    const updatedPackagesInfo: Array<{ name: string; version: string; path: string }> = [];

    if (!packages || !Array.isArray(packages)) {
      log('Invalid packages data provided. Expected array of packages.', 'error');
      return { updatedPackages: [], tags: [] };
    }

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

    const sharedEntriesMap = new Map<string, ChangelogEntry>();

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
      let latestTagResult = '';
      let hasRealTag = false;
      // Distinct from hasRealTag: `packageSpecificTags: true` can still fall back to a global tag.
      let usedPackageSpecificTag = false;
      try {
        latestTagResult = await getLatestTagForPackage(name, this.versionPrefix, {
          tagTemplate: this.tagTemplate,
          packageSpecificTags: this.fullConfig.packageSpecificTags,
        });
        hasRealTag = !!latestTagResult;
        usedPackageSpecificTag = !!latestTagResult;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        log(`Error getting package-specific tag for ${name}, falling back to global tag: ${errorMessage}`, 'warning');
      }

      if (!latestTagResult) {
        try {
          const packageDir = pkgPath;
          let manifestFallbackUsed = false;

          const manifestResult = getVersionFromManifests(packageDir);
          if (manifestResult.manifestFound && manifestResult.version) {
            log(
              `Using ${manifestResult.manifestType} version ${manifestResult.version} for ${name} as no package-specific tags found`,
              'info',
            );
            log(`FALLBACK: Using package version from ${manifestResult.manifestType} instead of global tag`, 'debug');
            // Synthetic tag: a version base, not a git ref (hasRealTag stays false).
            latestTagResult = `${this.versionPrefix || ''}${manifestResult.version}`;
            manifestFallbackUsed = true;
          }

          if (!manifestFallbackUsed) {
            const globalTagResult = await this.getLatestTag();
            if (globalTagResult) {
              latestTagResult = globalTagResult;
              hasRealTag = true;
              log(`Using global tag ${globalTagResult} as fallback for package ${name}`, 'info');
            }
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          log(`Error getting fallback version, using empty tag value: ${errorMessage}`, 'warning');
        }
      }

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
        continue;
      }

      const baselineTagPrefix = deriveBaselineTagPrefix(this.fullConfig.baselineTagTemplate, formattedPrefix, name);

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

        if (!hasRealTag && !this.fullConfig.baseRef) {
          const currentVersion = pkg.packageJson.version;
          const suggestedTag = currentVersion
            ? formatTag(currentVersion, formattedPrefix, name, this.tagTemplate, this.fullConfig.packageSpecificTags)
            : undefined;
          const baselineHint = suggestedTag
            ? ` Create a baseline tag to scope it: git tag ${suggestedTag} <release-sha> && git push origin ${suggestedTag}`
            : '';
          if (revisionRange === 'HEAD') {
            log(
              `No prior tag found for ${name} — its changelog will include the full git history.${baselineHint}`,
              'warning',
            );
          } else {
            const fromRef = revisionRange.endsWith('..HEAD')
              ? revisionRange.slice(0, revisionRange.length - '..HEAD'.length)
              : revisionRange;
            log(`No prior tag found for ${name} — its changelog will start from ${fromRef}.${baselineHint}`, 'warning');
          }
        }

        changelogEntries = await extractChangelogEntriesFromCommits(pkgPath, revisionRange);

        // The full workspace, so a commit touching only a non-releasing package isn't misread as repo-level.
        // Falls back to the release set when the engine didn't populate it (e.g. tests).
        const workspace =
          this.fullConfig.allWorkspacePackages ?? packages.map((p) => ({ name: p.packageJson.name, dir: p.dir }));
        const allPackageDirs = workspace.map((p) => p.dir);
        const sharedPackagePatterns = this.fullConfig.sharedPackages ?? [];
        const sharedPackageDirs =
          sharedPackagePatterns.length === 0
            ? []
            : workspace.filter((p) => shouldMatchPackageTargets(p.name, sharedPackagePatterns)).map((p) => p.dir);
        // Bounded so one untagged package can't flood "Project-wide changes" with the entire history.
        const sharedRevisionRange = await baselineResolver.sharedFloor(revisionRange);

        const repoLevelEntries = await extractRepoLevelChangelogEntries(
          pkgPath,
          sharedRevisionRange,
          allPackageDirs,
          sharedPackageDirs,
        );

        // Emitted once on VersionOutput rather than duplicated into every package changelog.
        if (repoLevelEntries.length > 0) {
          log(`Found ${repoLevelEntries.length} repo-level commit(s) for ${name}`, 'debug');
          for (const entry of repoLevelEntries) {
            sharedEntriesMap.set(`${entry.type}${entry.breaking ? '!' : ''}:${entry.description}`, entry);
          }
        }

        if (changelogEntries.length === 0) {
          changelogEntries = [
            {
              type: 'changed',
              description: `Update version to ${nextVersion}`,
            },
          ];
        }
      } catch (error) {
        if (error instanceof StrictReachableError) {
          throw error;
        }
        log(`Error extracting changelog entries: ${error instanceof Error ? error.message : String(error)}`, 'warning');
        changelogEntries = [
          {
            type: 'changed',
            description: `Update version to ${nextVersion}`,
          },
        ];
      }

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

      addChangelogData({
        packageName: name,
        version: nextVersion,
        previousVersion,
        revisionRange,
        repoUrl: repoUrl || null,
        entries: changelogEntries,
      });

      const packageJsonPath = path.join(pkgPath, 'package.json');

      const npmEnabled = this.fullConfig.npm?.enabled !== false;
      if (npmEnabled && fs.existsSync(packageJsonPath)) {
        updatePackageVersion(packageJsonPath, nextVersion, this.dryRun);
      }

      const cargoEnabled = this.fullConfig.cargo?.enabled !== false;
      log(`Cargo enabled for ${name}: ${cargoEnabled}, config: ${JSON.stringify(this.fullConfig.cargo)}`, 'debug');

      if (cargoEnabled) {
        const cargoPaths = this.fullConfig.cargo?.paths;
        log(`Cargo paths config for ${name}: ${JSON.stringify(cargoPaths)}`, 'debug');

        if (cargoPaths && cargoPaths.length > 0) {
          for (const cargoPath of cargoPaths) {
            const resolvedCargoPath = resolveConfinedManifestPath(repoRoot, pkgPath, cargoPath, 'Cargo.toml');
            log(`Checking cargo path for ${name}: ${resolvedCargoPath}`, 'debug');
            if (fs.existsSync(resolvedCargoPath)) {
              log(`Found Cargo.toml for ${name} at ${resolvedCargoPath}, updating...`, 'debug');
              updatePackageVersion(resolvedCargoPath, nextVersion, this.dryRun);
            } else {
              log(`Cargo.toml not found at ${resolvedCargoPath}`, 'debug');
            }
          }
        } else {
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

      const pubEnabled = this.fullConfig.pub?.enabled !== false;
      log(`Pub enabled for ${name}: ${pubEnabled}, config: ${JSON.stringify(this.fullConfig.pub)}`, 'debug');

      if (pubEnabled) {
        const dartPaths = this.fullConfig.pub?.paths;
        log(`Pub paths config for ${name}: ${JSON.stringify(dartPaths)}`, 'debug');

        if (dartPaths && dartPaths.length > 0) {
          for (const dartPath of dartPaths) {
            const resolvedPubspecPath = resolveConfinedManifestPath(repoRoot, pkgPath, dartPath, 'pubspec.yaml');
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

      const packageTag = formatTag(
        nextVersion,
        this.versionPrefix,
        name,
        this.tagTemplate,
        this.fullConfig.packageSpecificTags,
      );
      addTag(packageTag);
      setPackageUpdateTag(name, packageTag);
      const { action, reason } = resolveVersionAction({ hasNoTags: !hasRealTag, latestTag, nextVersion });
      setPackageUpdateAction(name, action, reason);
      setPackageUpdatePreviousVersion(name, previousVersion);
      tags.push(packageTag);

      if (this.dryRun) {
        log(`[DRY RUN] Would create tag: ${packageTag}`, 'info');
      } else {
        log(`Version ${nextVersion} prepared (tag: ${packageTag})`, 'success');
      }

      updatedPackagesInfo.push({ name, version: nextVersion, path: pkgPath });
    }

    setSharedEntries([...sharedEntriesMap.values()]);

    if (updatedPackagesInfo.length === 0) {
      log('No packages required a version update.', 'info');
      return { updatedPackages: [], tags };
    }

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
      // ${version} is the first package's version; per-package versions need the no-placeholder path.
      const packageName = updatedPackagesInfo.length === 1 ? updatedPackagesInfo[0].name : packageNames;
      commitMessage = formatCommitMessage(commitMessage, representativeVersion, packageName);
    } else {
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
