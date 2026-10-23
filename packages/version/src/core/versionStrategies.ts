import fs from 'node:fs';
import * as path from 'node:path';
import type { Package } from '@manypkg/get-packages';
import type { VersionChangelogEntry } from '@releasekit/core';
import { shouldMatchPackageTargets, shouldProcessPackage as shouldProcessPackageUtil } from '@releasekit/core';
import { extractChangelogEntriesFromCommits } from '../changelog/commitParser.js';
import { BaseVersionError } from '../errors/baseError.js';
import { StrictReachableError } from '../errors/strictReachableError.js';
import { createVersionError, VersionErrorCode } from '../errors/versionError.js';
import { getLatestTag, getLatestTagForPackage } from '../git/tagsAndBranches.js';
import { updatePackageVersion } from '../package/packageManagement.js';
import { PackageProcessor } from '../package/packageProcessor.js';
import type { Config } from '../types.js';
import { resolveConfinedManifestPath } from '../utils/confinedPath.js';
import { deriveBaselineTagPrefix, formatCommitMessage, formatTag, formatVersionPrefix } from '../utils/formatting.js';
import {
  addBaselineTag,
  addChangelogData,
  addTag,
  setAllPackageUpdateActions,
  setAllPackageUpdatePreviousVersions,
  setCommitMessage,
  setPackageUpdateAction,
  setPackageUpdatePreviousVersion,
  setPackageUpdateTag,
  setVersioningStrategy,
} from '../utils/jsonOutput.js';
import { log } from '../utils/logging.js';
import { resolveVersionAction } from '../utils/versionAction.js';
import { BaselineResolver } from './baselineResolver.js';
import { hasExplicitGroups } from './groupResolution.js';
import { createGroupStrategy } from './groupStrategy.js';
import { calculateVersion } from './versionCalculator.js';
import type { PackagesWithRoot } from './versionEngine.js';

type ChangelogEntry = VersionChangelogEntry;

export type StrategyType = 'sync' | 'single' | 'async' | 'group';

export type StrategyFunction = (packages: PackagesWithRoot, targets?: string[]) => Promise<void>;

/** Targeting is applied at discovery time, so this only handles skip. */
function shouldProcessPackage(pkg: Package, config: Config): boolean {
  const pkgName = pkg.packageJson.name;
  return shouldProcessPackageUtil(pkgName, config.skip);
}

function updateCargoFiles(
  packageDir: string,
  version: string,
  cargoConfig: Config['cargo'],
  dryRun = false,
  repoRoot: string = process.cwd(),
): string[] {
  const updatedFiles: string[] = [];

  const cargoEnabled = cargoConfig?.enabled !== false;

  if (!cargoEnabled) {
    return updatedFiles;
  }

  const cargoPaths = cargoConfig?.paths;

  if (cargoPaths && cargoPaths.length > 0) {
    for (const cargoPath of cargoPaths) {
      const resolvedCargoPath = resolveConfinedManifestPath(repoRoot, packageDir, cargoPath, 'Cargo.toml');
      if (fs.existsSync(resolvedCargoPath)) {
        updatePackageVersion(resolvedCargoPath, version, dryRun);
        updatedFiles.push(resolvedCargoPath);
      }
    }
  } else {
    const cargoTomlPath = path.join(packageDir, 'Cargo.toml');
    if (fs.existsSync(cargoTomlPath)) {
      updatePackageVersion(cargoTomlPath, version, dryRun);
      updatedFiles.push(cargoTomlPath);
    }
  }

  return updatedFiles;
}

export function createSyncStrategy(config: Config): StrategyFunction {
  return async (packages: PackagesWithRoot): Promise<void> => {
    try {
      setVersioningStrategy('sync');
      const {
        versionPrefix,
        tagTemplate,
        commitMessage = `chore: release \${packageName} v\${version}`,
        prereleaseIdentifier,
        dryRun,
        mainPackage,
      } = config;

      const formattedPrefix = formatVersionPrefix(versionPrefix || 'v');

      const baselineTagPrefix = deriveBaselineTagPrefix(config.baselineTagTemplate, formattedPrefix, mainPackage);

      let latestTag = await getLatestTag(baselineTagPrefix);

      const repoRoot = packages.root ?? process.cwd();

      // mainPkgPath/Name drive changelog extraction and naming; versionSourcePath/Name only supply the
      // base version and the package-specific tag lookup.
      let mainPkgPath = packages.root;
      let mainPkgName: string | undefined;
      let versionSourcePath = mainPkgPath;
      let versionSourceName: string | undefined;

      if (mainPackage) {
        const mainPkg = packages.packages.find((p) => p.packageJson.name === mainPackage);
        if (mainPkg) {
          mainPkgPath = mainPkg.dir;
          mainPkgName = mainPkg.packageJson.name;
          versionSourcePath = mainPkgPath;
          versionSourceName = mainPkgName;
          log(`Using ${mainPkgName} as primary package for version determination`, 'info');
        } else {
          log(`Main package '${mainPackage}' not found. Using root package for version determination.`, 'warning');
        }
      } else if (packages.packages.length > 0) {
        // Read a real version rather than the root package.json's placeholder (e.g. 0.0.0).
        versionSourcePath = packages.packages[0].dir;
        versionSourceName = packages.packages[0].packageJson.name;
        log(`No mainPackage specified; using ${versionSourceName} as sync version source`, 'info');
      }

      if (!mainPkgPath) {
        mainPkgPath = process.cwd();
        log(`No valid package path found, using current working directory: ${mainPkgPath}`, 'warning');
      }

      // With `baselineTagTemplate` set the baseline lookup above is authoritative - a consumer-facing
      // package tag may have been moved off the branch.
      let usedPackageSpecificTag = false;
      if (versionSourceName && !config.baselineTagTemplate) {
        const packageSpecificTag = await getLatestTagForPackage(versionSourceName, formattedPrefix, {
          tagTemplate,
          packageSpecificTags: config.packageSpecificTags,
        });

        if (packageSpecificTag) {
          latestTag = packageSpecificTag;
          usedPackageSpecificTag = true;
          log(`Using package-specific tag for ${versionSourceName}: ${latestTag}`, 'debug');
        } else {
          log(`No package-specific tag found for ${versionSourceName}, using global tag: ${latestTag}`, 'debug');
        }
      }

      const nextVersion = await calculateVersion(config, {
        latestTag,
        versionPrefix: formattedPrefix,
        prereleaseIdentifier,
        path: versionSourcePath,
        // Count commits across every workspace package, not just the version source's directory.
        commitCheckPath: repoRoot,
        name: versionSourceName,
        type: config.type,
      });

      if (!nextVersion) {
        const msg = mainPkgName ? `No version change needed for ${mainPkgName}` : 'No version change needed';
        log(msg, 'info');
        return;
      }

      const files: string[] = [];
      const updatedPackages: string[] = [];
      const processedPaths = new Set<string>();

      try {
        if (packages.root) {
          const rootPkgPath = path.join(packages.root, 'package.json');
          if (config.npm?.enabled !== false && fs.existsSync(rootPkgPath)) {
            // Flag as root so consumers (preview, standing PR) exclude it from package counts - it isn't publishable.
            updatePackageVersion(rootPkgPath, nextVersion, dryRun, true);
            files.push(rootPkgPath);
            updatedPackages.push('root');
          }
          // Record even when npm is disabled so the loop skips it in a single-package repo (where
          // packages.root === packages[0].dir) - otherwise its Cargo.toml is versioned twice.
          processedPaths.add(rootPkgPath);

          const rootCargoFiles = updateCargoFiles(packages.root, nextVersion, config.cargo, dryRun, repoRoot);
          files.push(...rootCargoFiles);
          // Track a Cargo-only root bump: the loop skips this path in a single-package repo, so the early
          // return below would otherwise abandon the written file.
          if (rootCargoFiles.length > 0 && !updatedPackages.includes('root')) {
            updatedPackages.push('root');
          }
        } else {
          log('Root package path is undefined, skipping root package.json update', 'warning');
        }
      } catch (error) {
        const errMessage = error instanceof Error ? error.message : String(error);
        log(`Failed to update root package.json: ${errMessage}`, 'error');
      }

      for (const pkg of packages.packages) {
        if (!shouldProcessPackage(pkg, config)) {
          continue;
        }

        const packageJsonPath = path.join(pkg.dir, 'package.json');

        if (processedPaths.has(packageJsonPath)) {
          continue;
        }

        if (config.npm?.enabled === false) {
          log(`Skipping package.json update for ${pkg.packageJson.name} - npm version handling disabled`, 'debug');
        } else if (!fs.existsSync(packageJsonPath)) {
          log(
            `Skipping package.json update for ${pkg.packageJson.name} - no package.json found (Rust-only package)`,
            'debug',
          );
        } else {
          updatePackageVersion(packageJsonPath, nextVersion, dryRun);
          files.push(packageJsonPath);
          updatedPackages.push(pkg.packageJson.name);
          processedPaths.add(packageJsonPath);
        }

        const pkgCargoFiles = updateCargoFiles(pkg.dir, nextVersion, config.cargo, dryRun, repoRoot);
        files.push(...pkgCargoFiles);

        // Track Cargo-only updates, or the early return below abandons the written Cargo.toml.
        if ((!fs.existsSync(packageJsonPath) || config.npm?.enabled === false) && pkgCargoFiles.length > 0) {
          updatedPackages.push(pkg.packageJson.name);
        }
      }

      if (updatedPackages.length > 0) {
        log(`Updated ${updatedPackages.length} package(s) to version ${nextVersion}`, 'success');
      } else {
        log('No packages were updated', 'warning');
        return;
      }

      const baselineResolver = new BaselineResolver({
        versionPrefix: formattedPrefix,
        tagTemplate,
        packageSpecificTags: config.packageSpecificTags ?? false,
        strictReachable: config.strictReachable ?? false,
        baseRef: config.baseRef,
      });

      let changelogEntries: ChangelogEntry[] = [];
      let revisionRange = 'HEAD';
      let previousVersion: string | null = null;

      try {
        const baseline = await baselineResolver.resolve({
          pkgDir: mainPkgPath,
          latestTag,
          hasRealTag: latestTag !== '',
          usedPackageSpecificTag,
          nextVersion,
          graduationName: versionSourceName,
          baselineTagPrefix,
          formattedPrefix,
        });
        revisionRange = baseline.revisionRange;
        previousVersion = baseline.previousVersion;

        changelogEntries = await extractChangelogEntriesFromCommits(mainPkgPath, revisionRange);

        if (changelogEntries.length === 0) {
          changelogEntries = [{ type: 'changed', description: `Update version to ${nextVersion}` }];
        }
      } catch (error) {
        if (error instanceof StrictReachableError) {
          throw error;
        }
        log(`Error extracting changelog entries: ${error instanceof Error ? error.message : String(error)}`, 'warning');
        changelogEntries = [{ type: 'changed', description: `Update version to ${nextVersion}` }];
      }

      const workspaceNames = updatedPackages.filter((n) => n !== 'root');

      let repoUrl: string | null = null;
      for (const searchPath of [mainPkgPath, versionSourcePath].filter(Boolean) as string[]) {
        try {
          const pkgJsonPath = path.join(searchPath, 'package.json');
          if (fs.existsSync(pkgJsonPath)) {
            const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
            let url: string | undefined;
            if (typeof pkgJson.repository === 'string') {
              url = pkgJson.repository;
            } else if (pkgJson.repository?.url) {
              url = pkgJson.repository.url;
            }
            if (url) {
              if (url.startsWith('git+')) {
                url = url.slice(4);
              }
              if (url.endsWith('.git')) {
                url = url.slice(0, -4);
              }
              repoUrl = url;
              break;
            }
          }
        } catch {
          // non-fatal - repoUrl stays null
        }
      }

      const displayPrevious = previousVersion;
      // One entry per workspace package in per-package tag mode, so notes can write each package's
      // CHANGELOG.md and publish can match tags to the right release notes.
      if (config.packageSpecificTags && workspaceNames.length > 0) {
        for (const pkgName of workspaceNames) {
          addChangelogData({
            packageName: pkgName,
            version: nextVersion,
            previousVersion: displayPrevious,
            revisionRange,
            repoUrl,
            entries: changelogEntries,
          });
        }
      } else {
        addChangelogData({
          packageName: mainPkgName || 'monorepo',
          version: nextVersion,
          previousVersion: displayPrevious,
          revisionRange,
          repoUrl,
          entries: changelogEntries,
        });
      }
      const commitPackageName = workspaceNames.length > 0 ? workspaceNames.join(', ') : undefined;

      const nextTags =
        config.packageSpecificTags && workspaceNames.length > 0
          ? workspaceNames.map((pkgName) => formatTag(nextVersion, formattedPrefix, pkgName, tagTemplate, true))
          : [formatTag(nextVersion, formattedPrefix, null, undefined, false)];

      let formattedCommitMessage: string;

      // biome-ignore lint/suspicious/noTemplateCurlyInString: checking for template placeholder syntax in user config string, not a template literal
      const hasPackageNamePlaceholder = commitMessage.includes('${packageName}');

      if (commitPackageName === undefined && !hasPackageNamePlaceholder) {
        formattedCommitMessage = formatCommitMessage(commitMessage, nextVersion, undefined, undefined);
      } else if (commitPackageName === undefined) {
        // Substitute manually - formatCommitMessage would warn about the empty ${packageName}.
        formattedCommitMessage = commitMessage
          .replace(/\$\{version\}/g, nextVersion)
          .replace(/\$\{packageName\}/g, '')
          .replace(/\$\{scope\}/g, '');
      } else {
        formattedCommitMessage = formatCommitMessage(commitMessage, nextVersion, commitPackageName, undefined);
      }

      // Collapse the gap an empty ${packageName} leaves (e.g. 'chore: release  v1.0.0').
      formattedCommitMessage = formattedCommitMessage.replace(/\s{2,}/g, ' ').trim();

      for (const tag of nextTags) {
        addTag(tag);
      }
      const baselineTag = config.baselineTagTemplate
        ? formatTag(nextVersion, formattedPrefix, mainPkgName, config.baselineTagTemplate, false)
        : undefined;
      if (baselineTag) {
        addBaselineTag(baselineTag);
      }
      const allTags = baselineTag ? [...nextTags, baselineTag] : nextTags;
      // Link per-package tags back to their update records so the publish pipeline
      // can push each tag immediately after that package publishes.
      if (config.packageSpecificTags && workspaceNames.length > 0) {
        for (let i = 0; i < workspaceNames.length; i++) {
          const pkgName = workspaceNames[i];
          const pkgTag = nextTags[i];
          if (pkgName && pkgTag) {
            setPackageUpdateTag(pkgName, pkgTag);
          }
        }
      }
      const { action: syncAction, reason: syncReason } = resolveVersionAction({
        hasNoTags: latestTag === '',
        latestTag,
        nextVersion,
      });
      setAllPackageUpdateActions(syncAction, syncReason);
      setAllPackageUpdatePreviousVersions(displayPrevious);
      setCommitMessage(formattedCommitMessage);

      if (!dryRun) {
        log(`Version ${nextVersion} prepared (tags: ${allTags.join(', ')})`, 'success');
      } else {
        log(`Would create tags: ${allTags.join(', ')}`, 'info');
      }
    } catch (error) {
      if (BaseVersionError.isVersionError(error)) {
        log(`Synced Strategy failed: ${error.message} (${error.code})`, 'error');
      } else {
        const errorMessage = error instanceof Error ? error.message : String(error);
        log(`Synced Strategy failed: ${errorMessage}`, 'error');
      }
      throw error;
    }
  };
}

export function createSingleStrategy(config: Config): StrategyFunction {
  return async (packages: PackagesWithRoot): Promise<void> => {
    try {
      setVersioningStrategy('single');
      const {
        mainPackage,
        versionPrefix,
        tagTemplate,
        commitMessage = `chore: release \${packageName} v\${version}`,
        dryRun,
      } = config;

      let packageName: string | undefined;

      if (mainPackage) {
        packageName = mainPackage;
      } else if (packages.packages.length === 1) {
        packageName = packages.packages[0].packageJson.name;
      } else {
        throw createVersionError(
          VersionErrorCode.INVALID_CONFIG,
          'Single mode requires either mainPackage or exactly one resolved package',
        );
      }

      const pkg = packages.packages.find((p) => p.packageJson.name === packageName);

      if (!pkg) {
        throw createVersionError(VersionErrorCode.PACKAGE_NOT_FOUND, packageName);
      }

      const pkgPath = pkg.dir;
      const repoRoot = packages.root ?? process.cwd();
      const formattedPrefix = formatVersionPrefix(versionPrefix || 'v');

      let latestTagResult = await getLatestTagForPackage(packageName, formattedPrefix, {
        tagTemplate,
        packageSpecificTags: config.packageSpecificTags,
      });
      const usedPackageSpecificTag = !!latestTagResult;

      if (!latestTagResult) {
        const globalTagResult = await getLatestTag();
        latestTagResult = globalTagResult || '';
      }

      const latestTag = latestTagResult;
      const baselineTagPrefix = deriveBaselineTagPrefix(config.baselineTagTemplate, formattedPrefix, packageName);

      let nextVersion: string | undefined;

      nextVersion = await calculateVersion(config, {
        latestTag,
        versionPrefix: formattedPrefix,
        prereleaseIdentifier: config.prereleaseIdentifier,
        path: pkgPath,
        name: packageName,
        type: config.type,
      });

      if (!nextVersion) {
        log(`No version change needed for ${packageName}`, 'info');
        return;
      }

      const baselineResolver = new BaselineResolver({
        versionPrefix: formattedPrefix,
        tagTemplate,
        packageSpecificTags: config.packageSpecificTags ?? false,
        strictReachable: config.strictReachable ?? false,
        baseRef: config.baseRef,
      });

      let changelogEntries: ChangelogEntry[] = [];
      let revisionRange = 'HEAD';
      let previousVersion: string | null = null;

      try {
        const baseline = await baselineResolver.resolve({
          pkgDir: pkgPath,
          latestTag,
          hasRealTag: latestTag !== '',
          usedPackageSpecificTag,
          nextVersion,
          graduationName: packageName,
          baselineTagPrefix,
          formattedPrefix,
        });
        revisionRange = baseline.revisionRange;
        previousVersion = baseline.previousVersion;

        changelogEntries = await extractChangelogEntriesFromCommits(pkgPath, revisionRange);

        if (changelogEntries.length === 0) {
          changelogEntries = [{ type: 'changed', description: `Update version to ${nextVersion}` }];
        }
      } catch (error) {
        if (error instanceof StrictReachableError) {
          throw error;
        }
        log(`Error extracting changelog entries: ${error instanceof Error ? error.message : String(error)}`, 'warning');
        changelogEntries = [{ type: 'changed', description: `Update version to ${nextVersion}` }];
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
        packageName,
        version: nextVersion,
        previousVersion,
        revisionRange,
        repoUrl: repoUrl || null,
        entries: changelogEntries,
      });

      const packageJsonPath = path.join(pkgPath, 'package.json');

      const filesToCommit: string[] = [];

      const npmEnabled = config.npm?.enabled !== false;
      if (npmEnabled && fs.existsSync(packageJsonPath)) {
        updatePackageVersion(packageJsonPath, nextVersion, dryRun);
        filesToCommit.push(packageJsonPath);
      } else {
        const reason = !npmEnabled ? 'npm version handling disabled' : 'no package.json found (Rust-only package)';
        log(`Skipping package.json update for ${packageName} - ${reason}`, 'debug');
      }

      const cargoFiles = updateCargoFiles(pkgPath, nextVersion, config.cargo, dryRun, repoRoot);
      filesToCommit.push(...cargoFiles);

      log(`Updated package ${packageName} to version ${nextVersion}`, 'success');

      const tagName = formatTag(nextVersion, formattedPrefix, packageName, tagTemplate, config.packageSpecificTags);
      const commitMsg = formatCommitMessage(commitMessage, nextVersion, packageName);

      addTag(tagName);
      setPackageUpdateTag(packageName, tagName);
      const { action: singleAction, reason: singleReason } = resolveVersionAction({
        hasNoTags: latestTag === '',
        latestTag,
        nextVersion,
      });
      setPackageUpdateAction(packageName, singleAction, singleReason);
      setPackageUpdatePreviousVersion(packageName, previousVersion);
      setCommitMessage(commitMsg);

      if (!dryRun) {
        log(`Version ${nextVersion} prepared (tag: ${tagName})`, 'success');
      } else {
        log(`Would create tag: ${tagName}`, 'info');
      }
    } catch (error) {
      if (BaseVersionError.isVersionError(error)) {
        log(`Single Strategy failed: ${error.message} (${error.code})`, 'error');
      } else {
        const errorMessage = error instanceof Error ? error.message : String(error);
        log(`Single Strategy failed: ${errorMessage}`, 'error');
      }
      throw error;
    }
  };
}

export function createAsyncStrategy(config: Config): StrategyFunction {
  const dependencies = {
    getLatestTag,
  };

  const processorOptions = {
    skip: config.skip || [],
    versionPrefix: config.versionPrefix || 'v',
    tagTemplate: config.tagTemplate,
    commitMessageTemplate: config.commitMessage || '',
    dryRun: config.dryRun || false,
    getLatestTag: dependencies.getLatestTag,
    fullConfig: config,
    config: {
      prereleaseIdentifier: config.prereleaseIdentifier,
      type: config.type,
      // PackageProcessor reads strictReachable from here, not fullConfig.
      strictReachable: config.strictReachable,
    },
  };

  const packageProcessor = new PackageProcessor(processorOptions);

  return async (packages: PackagesWithRoot, targets: string[] = []): Promise<void> => {
    try {
      setVersioningStrategy('async');
      let packagesToProcess = packages.packages;
      if (targets.length > 0) {
        const beforeCount = packagesToProcess.length;
        packagesToProcess = packagesToProcess.filter((pkg) => shouldMatchPackageTargets(pkg.packageJson.name, targets));
        log(
          `Runtime targets filter: ${beforeCount} → ${packagesToProcess.length} packages (${targets.join(', ')})`,
          'info',
        );
      }

      log(`Processing ${packagesToProcess.length} packages`, 'info');

      const result = await packageProcessor.processPackages(packagesToProcess, packages.root ?? process.cwd());

      if (result.updatedPackages.length === 0) {
        log('No packages required a version update.', 'info');
      } else {
        const packageNames = result.updatedPackages.map((p) => p.name).join(', ');
        log(`Updated ${result.updatedPackages.length} package(s): ${packageNames}`, 'success');

        if (result.tags.length > 0) {
          log(`Created ${result.tags.length} tag(s): ${result.tags.join(', ')}`, 'success');
        }

        if (result.commitMessage) {
          log(`Created commit with message: "${result.commitMessage}"`, 'success');
        }
      }
    } catch (error) {
      if (BaseVersionError.isVersionError(error)) {
        log(`Async Strategy failed: ${error.message} (${error.code})`, 'error');
      } else {
        const errorMessage = error instanceof Error ? error.message : String(error);
        log(`Async Strategy failed: ${errorMessage}`, 'error');
      }
      throw error;
    }
  };
}

/** Initial strategy only - callers pick the real one via `setStrategy` once packages are resolved. */
export function createStrategy(config: Config): StrategyFunction {
  if (config.sync) {
    return createSyncStrategy(config);
  }
  if (hasExplicitGroups(config)) {
    return createGroupStrategy(config);
  }

  return createAsyncStrategy(config);
}

export function createStrategyMap(config: Config): Record<StrategyType, StrategyFunction> {
  return {
    sync: createSyncStrategy(config),
    single: createSingleStrategy(config),
    async: createAsyncStrategy(config),
    group: createGroupStrategy(config),
  };
}
