/**
 * Strategy functions for versioning using the higher-order function pattern
 */

import fs from 'node:fs';
import * as path from 'node:path';
import type { Package } from '@manypkg/get-packages';
import type { VersionChangelogEntry } from '@releasekit/core';
import { extractChangelogEntriesFromCommits } from '../changelog/commitParser.js';
import { BaseVersionError } from '../errors/baseError.js';
import { createVersionError, VersionErrorCode } from '../errors/versionError.js';
import { execSync } from '../git/commandExecutor.js';
import { getLatestTag, getLatestTagForPackage } from '../git/tagsAndBranches.js';
import { updatePackageVersion } from '../package/packageManagement.js';
import { PackageProcessor } from '../package/packageProcessor.js';
import type { Config } from '../types.js';
import { formatCommitMessage, formatTag, formatVersionPrefix } from '../utils/formatting.js';
import { addChangelogData, addTag, setCommitMessage } from '../utils/jsonOutput.js';
import { log } from '../utils/logging.js';
import { shouldProcessPackage as shouldProcessPackageUtil } from '../utils/packageMatching.js';
import { calculateVersion } from './versionCalculator.js';
import type { PackagesWithRoot } from './versionEngine.js';

type ChangelogEntry = VersionChangelogEntry;

/**
 * Available strategy types
 */
export type StrategyType = 'sync' | 'single' | 'async';

/**
 * Strategy function type
 */
export type StrategyFunction = (packages: PackagesWithRoot, targets?: string[]) => Promise<void>;

/**
 * Helper function to determine if a package should be processed
 * Note: Package targeting is now handled at discovery time, so this only handles skip logic
 */
function shouldProcessPackage(pkg: Package, config: Config): boolean {
  const pkgName = pkg.packageJson.name;
  return shouldProcessPackageUtil(pkgName, config.skip);
}

/**
 * Update Cargo.toml files for a package and return the list of updated file paths
 * @param packageDir - The directory containing the package
 * @param version - The version to update to
 * @param cargoConfig - The cargo configuration from config
 * @returns Array of Cargo.toml file paths that were updated
 */
function updateCargoFiles(packageDir: string, version: string, cargoConfig: Config['cargo'], dryRun = false): string[] {
  const updatedFiles: string[] = [];

  // Check if Cargo.toml handling is enabled (default to true if not specified)
  const cargoEnabled = cargoConfig?.enabled !== false;

  if (!cargoEnabled) {
    return updatedFiles;
  }

  const cargoPaths = cargoConfig?.paths;

  if (cargoPaths && cargoPaths.length > 0) {
    // If paths are specified, only include those Cargo.toml files
    for (const cargoPath of cargoPaths) {
      const resolvedCargoPath = path.resolve(packageDir, cargoPath, 'Cargo.toml');
      if (fs.existsSync(resolvedCargoPath)) {
        updatePackageVersion(resolvedCargoPath, version, dryRun);
        updatedFiles.push(resolvedCargoPath);
      }
    }
  } else {
    // Default behaviour: check for Cargo.toml in the root package directory
    const cargoTomlPath = path.join(packageDir, 'Cargo.toml');
    if (fs.existsSync(cargoTomlPath)) {
      updatePackageVersion(cargoTomlPath, version, dryRun);
      updatedFiles.push(cargoTomlPath);
    }
  }

  return updatedFiles;
}

/**
 * Create a sync versioning strategy function
 */
export function createSyncStrategy(config: Config): StrategyFunction {
  return async (packages: PackagesWithRoot): Promise<void> => {
    try {
      const {
        versionPrefix,
        tagTemplate,
        baseBranch,
        branchPattern,
        commitMessage = `chore: release \${packageName} v\${version}`,
        prereleaseIdentifier,
        dryRun,
        mainPackage,
      } = config;

      // Calculate version for root package first
      const formattedPrefix = formatVersionPrefix(versionPrefix || 'v');
      let latestTag = await getLatestTag();

      // Capture the repo root before any mainPackage branch can overwrite mainPkgPath.
      // This is used as commitCheckPath so commit counting always spans the full repo.
      const repoRoot = packages.root ?? process.cwd();

      // Find the main package if specified.
      // mainPkgPath / mainPkgName drive changelog extraction and naming.
      // versionSourcePath / versionSourceName are used only for reading the base
      // version (package.json) and resolving package-specific git tags.
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
        // In sync mode without an explicit mainPackage, use the first workspace package
        // as the version source so we read a real version (e.g. 0.3.1) instead of the
        // root package.json's placeholder (e.g. 0.0.0). The changelog is still extracted
        // from the root, and the changelog entry is still named 'monorepo'.
        versionSourcePath = packages.packages[0].dir;
        versionSourceName = packages.packages[0].packageJson.name;
        log(`No mainPackage specified; using ${versionSourceName} as sync version source`, 'info');
      }

      // Make sure we have a valid path for version calculation
      if (!mainPkgPath) {
        mainPkgPath = process.cwd();
        log(`No valid package path found, using current working directory: ${mainPkgPath}`, 'warning');
      }

      // Try to get package-specific tags for the version source package
      if (versionSourceName) {
        const packageSpecificTag = await getLatestTagForPackage(versionSourceName, formattedPrefix, {
          tagTemplate,
          packageSpecificTags: config.packageSpecificTags,
        });

        if (packageSpecificTag) {
          latestTag = packageSpecificTag;
          log(`Using package-specific tag for ${versionSourceName}: ${latestTag}`, 'debug');
        } else {
          log(`No package-specific tag found for ${versionSourceName}, using global tag: ${latestTag}`, 'debug');
        }
      }

      // Calculate the next version using the version source package.
      // commitCheckPath is set to the repo root so that commits across all workspace
      // packages are counted — not just those under the version source subdirectory.
      const nextVersion = await calculateVersion(config, {
        latestTag,
        versionPrefix: formattedPrefix,
        branchPattern,
        baseBranch,
        prereleaseIdentifier,
        path: versionSourcePath,
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
      const processedPaths = new Set<string>(); // Track processed paths to avoid duplicates

      // Update root package.json if exists
      try {
        // Check if packages.root is defined before joining paths
        if (packages.root) {
          const rootPkgPath = path.join(packages.root, 'package.json');
          if (fs.existsSync(rootPkgPath)) {
            updatePackageVersion(rootPkgPath, nextVersion, dryRun);
            files.push(rootPkgPath);
            updatedPackages.push('root');
            processedPaths.add(rootPkgPath);

            // Handle Cargo.toml files in root
            const rootCargoFiles = updateCargoFiles(packages.root, nextVersion, config.cargo, dryRun);
            files.push(...rootCargoFiles);
          }
        } else {
          log('Root package path is undefined, skipping root package.json update', 'warning');
        }
      } catch (error) {
        const errMessage = error instanceof Error ? error.message : String(error);
        log(`Failed to update root package.json: ${errMessage}`, 'error');
      }

      // Update all workspace packages
      for (const pkg of packages.packages) {
        if (!shouldProcessPackage(pkg, config)) {
          continue;
        }

        const packageJsonPath = path.join(pkg.dir, 'package.json');

        // Skip if we've already processed this path (avoids duplicates in single-package repos)
        if (processedPaths.has(packageJsonPath)) {
          continue;
        }

        updatePackageVersion(packageJsonPath, nextVersion, dryRun);
        files.push(packageJsonPath);
        updatedPackages.push(pkg.packageJson.name);
        processedPaths.add(packageJsonPath);

        // Handle Cargo.toml files for this package
        const pkgCargoFiles = updateCargoFiles(pkg.dir, nextVersion, config.cargo, dryRun);
        files.push(...pkgCargoFiles);
      }

      // Log updated packages
      if (updatedPackages.length > 0) {
        log(`Updated ${updatedPackages.length} package(s) to version ${nextVersion}`, 'success');
      } else {
        log('No packages were updated', 'warning');
        return;
      }

      // Extract changelog entries from commits
      let changelogEntries: ChangelogEntry[] = [];
      let revisionRange = 'HEAD';

      try {
        if (latestTag) {
          try {
            execSync('git', ['rev-parse', '--verify', latestTag], {
              cwd: mainPkgPath,
              stdio: 'ignore',
            });
            revisionRange = `${latestTag}..HEAD`;
          } catch {
            if (config.strictReachable) {
              throw new Error(
                `Cannot generate changelog: tag '${latestTag}' is not reachable from the current commit. ` +
                  `When strictReachable is enabled, all tags must be reachable. ` +
                  `To allow fallback to all commits, set strictReachable to false.`,
              );
            }
            log(`Tag ${latestTag} doesn't exist, using all commits for changelog`, 'debug');
            revisionRange = 'HEAD';
          }
        }

        changelogEntries = extractChangelogEntriesFromCommits(mainPkgPath, revisionRange);

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
        changelogEntries = [
          {
            type: 'changed',
            description: `Update version to ${nextVersion}`,
          },
        ];
      }

      // Build the commit message package name from all updated workspace packages.
      // Pass undefined when only the root was updated so formatCommitMessage leaves
      // the ${packageName} placeholder empty rather than inserting the literal 'root'.
      const workspaceNames = updatedPackages.filter((n) => n !== 'root');

      // Extract repoUrl from root package.json (or versionSourcePath as fallback)
      // so the notes pipeline can generate compare URLs in GitHub releases.
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
              if (url.startsWith('git+') && url.endsWith('.git')) url = url.slice(4, -4);
              repoUrl = url;
              break;
            }
          }
        } catch {
          // non-fatal — repoUrl stays null
        }
      }

      // Track changelog data for JSON output.
      // In per-package tag mode, emit one changelog entry per workspace package so the
      // notes pipeline can write a CHANGELOG.md to each package directory and the
      // publish pipeline can match tags to the right release notes.
      if (config.packageSpecificTags && workspaceNames.length > 0) {
        for (const pkgName of workspaceNames) {
          addChangelogData({
            packageName: pkgName,
            version: nextVersion,
            previousVersion: latestTag || null,
            revisionRange,
            repoUrl,
            entries: changelogEntries,
          });
        }
      } else {
        addChangelogData({
          packageName: mainPkgName || 'monorepo',
          version: nextVersion,
          previousVersion: latestTag || null,
          revisionRange,
          repoUrl,
          entries: changelogEntries,
        });
      }
      const commitPackageName = workspaceNames.length > 0 ? workspaceNames.join(', ') : undefined;

      // Create tags. When packageSpecificTags is enabled and there are workspace packages,
      // create one tag per package (matching per-package strategy behaviour). Otherwise
      // fall back to a single root tag (e.g. v1.0.0).
      const nextTags =
        config.packageSpecificTags && workspaceNames.length > 0
          ? workspaceNames.map((pkgName) => formatTag(nextVersion, formattedPrefix, pkgName, tagTemplate, true))
          : [formatTag(nextVersion, formattedPrefix, null, undefined, false)];

      // Format commit message - when commitPackageName is intentionally undefined (no workspace
      // packages), we do the substitution manually to avoid spurious warnings. The double-space
      // cleanup handles any empty placeholder result.
      let formattedCommitMessage: string;

      // biome-ignore lint/suspicious/noTemplateCurlyInString: checking for template placeholder syntax in user config string, not a template literal
      const hasPackageNamePlaceholder = commitMessage.includes('${packageName}');

      if (commitPackageName === undefined && !hasPackageNamePlaceholder) {
        // Template doesn't use ${packageName}, use full format function
        formattedCommitMessage = formatCommitMessage(commitMessage, nextVersion, undefined, undefined);
      } else if (commitPackageName === undefined) {
        // Template uses ${packageName} but no workspace packages - substitute manually to avoid warning.
        // Also replace ${scope} to keep parity with formatCommitMessage (no scope available in this path).
        formattedCommitMessage = commitMessage
          .replace(/\$\{version\}/g, nextVersion)
          .replace(/\$\{packageName\}/g, '')
          .replace(/\$\{scope\}/g, '');
      } else {
        // Normal case with package name
        formattedCommitMessage = formatCommitMessage(commitMessage, nextVersion, commitPackageName, undefined);
      }

      // Collapse any runs of whitespace that result from an empty ${packageName} substitution
      // (e.g. 'chore: release  v1.0.0' → 'chore: release v1.0.0') and trim edges.
      formattedCommitMessage = formattedCommitMessage.replace(/\s{2,}/g, ' ').trim();

      // Track tags and commit message for JSON output (git ops now handled by publish)
      for (const tag of nextTags) {
        addTag(tag);
      }
      setCommitMessage(formattedCommitMessage);

      if (!dryRun) {
        log(`Version ${nextVersion} prepared (tags: ${nextTags.join(', ')})`, 'success');
      } else {
        log(`Would create tags: ${nextTags.join(', ')}`, 'info');
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

/**
 * Create a single package versioning strategy function
 */
export function createSingleStrategy(config: Config): StrategyFunction {
  return async (packages: PackagesWithRoot): Promise<void> => {
    try {
      const {
        mainPackage,
        versionPrefix,
        tagTemplate,
        commitMessage = `chore: release \${packageName} v\${version}`,
        dryRun,
      } = config;

      // Use mainPackage if specified, otherwise use the first package from the resolved packages
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
      const formattedPrefix = formatVersionPrefix(versionPrefix || 'v');

      // Try to get the latest tag specific to this package first
      let latestTagResult = await getLatestTagForPackage(packageName, formattedPrefix, {
        tagTemplate,
        packageSpecificTags: config.packageSpecificTags,
      });

      // Fallback to global tag if no package-specific tag exists
      if (!latestTagResult) {
        const globalTagResult = await getLatestTag();
        latestTagResult = globalTagResult || '';
      }

      // At this point, latestTagResult is guaranteed to be a string (possibly empty)
      const latestTag = latestTagResult;

      let nextVersion: string | undefined;

      // Calculate the next version
      nextVersion = await calculateVersion(config, {
        latestTag,
        versionPrefix: formattedPrefix,
        branchPattern: config.branchPattern,
        baseBranch: config.baseBranch,
        prereleaseIdentifier: config.prereleaseIdentifier,
        path: pkgPath,
        name: packageName,
        type: config.type,
      });

      if (!nextVersion) {
        log(`No version change needed for ${packageName}`, 'info');
        return;
      }

      // Generate changelog entries from conventional commits
      let changelogEntries: ChangelogEntry[] = [];
      let revisionRange = 'HEAD';

      try {
        // Extract entries from commits between the latest tag and HEAD

        // Check if the tag actually exists in the repository
        if (latestTag) {
          try {
            execSync('git', ['rev-parse', '--verify', latestTag], {
              cwd: pkgPath,
              stdio: 'ignore',
            });
            // Tag exists, get commits since that tag
            revisionRange = `${latestTag}..HEAD`;
          } catch {
            if (config.strictReachable) {
              throw new Error(
                `Cannot generate changelog: tag '${latestTag}' is not reachable from the current commit. ` +
                  `When strictReachable is enabled, all tags must be reachable. ` +
                  `To allow fallback to all commits, set strictReachable to false.`,
              );
            }
            // Tag doesn't exist, get all commits
            log(`Tag ${latestTag} doesn't exist, using all commits for changelog`, 'debug');
            revisionRange = 'HEAD';
          }
        } else {
          // No tag provided, get all commits
          revisionRange = 'HEAD';
        }

        changelogEntries = extractChangelogEntriesFromCommits(pkgPath, revisionRange);

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

      // Track changelog data for JSON output
      addChangelogData({
        packageName,
        version: nextVersion,
        previousVersion: latestTag || null,
        revisionRange,
        repoUrl: repoUrl || null,
        entries: changelogEntries,
      });

      // Update package.json
      const packageJsonPath = path.join(pkgPath, 'package.json');
      updatePackageVersion(packageJsonPath, nextVersion, dryRun);

      // Track all files that need to be committed
      const filesToCommit: string[] = [packageJsonPath];

      // Handle Cargo.toml files for this package
      const cargoFiles = updateCargoFiles(pkgPath, nextVersion, config.cargo, dryRun);
      filesToCommit.push(...cargoFiles);

      log(`Updated package ${packageName} to version ${nextVersion}`, 'success');

      // Track tag and commit message for JSON output (git ops now handled by publish)
      const tagName = formatTag(nextVersion, formattedPrefix, packageName, tagTemplate, config.packageSpecificTags);
      const commitMsg = formatCommitMessage(commitMessage, nextVersion, packageName);

      addTag(tagName);
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

/**
 * Create an async package versioning strategy function
 */
export function createAsyncStrategy(config: Config): StrategyFunction {
  // Initialize package processor dependencies
  const dependencies = {
    getLatestTag,
  };

  // Initialize processor with configuration
  const processorOptions = {
    skip: config.skip || [],
    versionPrefix: config.versionPrefix || 'v',
    tagTemplate: config.tagTemplate,
    commitMessageTemplate: config.commitMessage || '',
    dryRun: config.dryRun || false,
    getLatestTag: dependencies.getLatestTag,
    fullConfig: config,
    // Extract common version configuration properties
    config: {
      branchPattern: config.branchPattern || [],
      baseBranch: config.baseBranch || 'main',
      prereleaseIdentifier: config.prereleaseIdentifier,
      type: config.type,
    },
  };

  const packageProcessor = new PackageProcessor(processorOptions);

  return async (packages: PackagesWithRoot, targets: string[] = []): Promise<void> => {
    try {
      // Apply additional filtering if targets are specified at runtime
      let packagesToProcess = packages.packages;
      if (targets.length > 0) {
        const beforeCount = packagesToProcess.length;
        packagesToProcess = packagesToProcess.filter((pkg) => targets.includes(pkg.packageJson.name));
        log(
          `Runtime targets filter: ${beforeCount} → ${packagesToProcess.length} packages (${targets.join(', ')})`,
          'info',
        );
      }

      log(`Processing ${packagesToProcess.length} packages`, 'info');

      // 2. Process packages with PackageProcessor
      const result = await packageProcessor.processPackages(packagesToProcess);

      // 3. Report results
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

/**
 * Create a strategy function based on configuration
 * Note: This is only used for initial strategy creation.
 * The CLI will override this based on resolved packages.
 */
export function createStrategy(config: Config): StrategyFunction {
  if (config.sync) {
    return createSyncStrategy(config);
  }

  // Default to async strategy - the CLI will determine the actual strategy
  // based on resolved packages after glob expansion
  return createAsyncStrategy(config);
}

/**
 * Create a strategy map for easy lookup
 */
export function createStrategyMap(config: Config): Record<StrategyType, StrategyFunction> {
  return {
    sync: createSyncStrategy(config),
    single: createSingleStrategy(config),
    async: createAsyncStrategy(config),
  };
}
