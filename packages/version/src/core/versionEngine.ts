import * as fs from 'node:fs';
import * as path from 'node:path';
import { cwd } from 'node:process';
import { getPackagesSync, type Package, type Packages } from '@manypkg/get-packages';
import { filterPackagesByConfig, parseCargoToml, parsePubspec } from '@releasekit/config';
import { shouldMatchPackageTargets } from '@releasekit/core';
import { minimatch } from 'minimatch';
import * as yaml from 'yaml';
import { GitError } from '../errors/gitError.js';
import { createVersionError, VersionError, VersionErrorCode } from '../errors/versionError.js';
import { getCommitsLength, getLatestTag, getLatestTagForPackage } from '../git/tagsAndBranches.js';
import type { Config, VersionRunOptions } from '../types.js';
import { formatVersionPrefix } from '../utils/formatting.js';
import { tagPrerequisiteRoles } from '../utils/jsonOutput.js';
import { log } from '../utils/logging.js';
import { resolvePrerequisiteTargets } from './prerequisiteScope.js';
import { createStrategy, createStrategyMap, type StrategyFunction, type StrategyType } from './versionStrategies.js';
import { buildWorkspaceGraph } from './workspaceGraph.js';

// Define extended type that includes root property
export interface PackagesWithRoot extends Packages {
  root: string;
}

/**
 * Main versioning engine that uses functional strategies
 */
export class VersionEngine {
  private config: Config;
  private workspaceCache: PackagesWithRoot | null = null;
  private strategies: Record<StrategyType, StrategyFunction>;
  private currentStrategy: StrategyFunction;
  private runtimeTargets: string[] = [];
  private includePrerequisites = false;
  /** Package names to drop from the release set as the final discovery filter (see VersionRunOptions.exclude). */
  private excludePackages: string[] = [];
  /** Prereq → target(s) it was pulled in for, captured during prerequisite resolution; used after
   *  `run()` to tag each update's role/prerequisiteOf. Empty unless prerequisites were derived. */
  private prerequisiteOf: Record<string, string[]> = {};

  constructor(config: Config, runOptions?: VersionRunOptions) {
    // Validate required configuration
    if (!config) {
      throw createVersionError(VersionErrorCode.CONFIG_REQUIRED);
    }

    // Apply runtime overrides on top of a shallow copy so the caller's config
    // object is never mutated.
    const effective: Config = { ...config };

    if (runOptions) {
      if (runOptions.dryRun) effective.dryRun = true;
      if (runOptions.sync) effective.sync = true;
      if (runOptions.bump) effective.type = runOptions.bump;
      if (runOptions.prerelease) {
        effective.prereleaseIdentifier =
          typeof runOptions.prerelease === 'string' ? runOptions.prerelease : effective.prereleaseIdentifier || 'next';
        effective.isPrerelease = true;
      }
      if (runOptions.stable) effective.stableOnly = true;
      if (runOptions.targets?.length) this.runtimeTargets = runOptions.targets;
      if (runOptions.baseRef) effective.baseRef = runOptions.baseRef;
      if (runOptions.overrideScope) effective.overrideScope = runOptions.overrideScope;
      if (runOptions.includePrerequisites) this.includePrerequisites = true;
      if (runOptions.exclude?.length) this.excludePackages = runOptions.exclude;
    }

    // Default values for required properties
    if (!effective.preset) {
      effective.preset = 'conventional-commits';
      log('No preset specified, using default: conventional-commits', 'warning');
    }

    this.config = effective;

    // Create all strategy functions
    this.strategies = createStrategyMap(effective);

    // Set initial strategy based on config
    this.currentStrategy = createStrategy(effective);
  }

  /**
   * Discover pure Rust packages (Cargo.toml only) in the workspace.
   * Skips crates with `publish = false` (Cargo's publish opt-out).
   * When a workspace root Cargo.toml with `[workspace].members` is found, only
   * crates inside those member globs are discovered.
   */
  private discoverCargoTomlPackages(workspaceRoot: string): PackagesWithRoot {
    // Detect Cargo workspace members to scope discovery.
    let workspaceMembers: string[] | null = null;
    const rootCargoPath = path.join(workspaceRoot, 'Cargo.toml');
    if (fs.existsSync(rootCargoPath)) {
      try {
        const rootCargo = parseCargoToml(rootCargoPath);
        if (Array.isArray(rootCargo.workspace?.members) && rootCargo.workspace.members.length > 0) {
          workspaceMembers = rootCargo.workspace.members;
          log(`Cargo workspace members detected: ${workspaceMembers.join(', ')}`, 'debug');
        }
      } catch (error) {
        log(`Could not parse root Cargo.toml for workspace members: ${error}`, 'debug');
      }
    }

    const cargoTomlPaths: string[] = [];

    // Recursive function to find Cargo.toml files
    const findCargoToml = (dir: string, relativePath: string = '') => {
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });

        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          const relPath = path.join(relativePath, entry.name);

          // Skip ignored directories
          if (entry.isDirectory()) {
            if (entry.name === 'node_modules' || entry.name === 'target' || entry.name === '.git') {
              continue;
            }
            findCargoToml(fullPath, relPath);
          } else if (entry.isFile() && entry.name === 'Cargo.toml') {
            cargoTomlPaths.push(relPath);
          }
        }
      } catch (error) {
        // Skip directories we can't read
        log(`Cannot read directory ${dir}: ${error}`, 'debug');
      }
    };

    findCargoToml(workspaceRoot);

    const rustPackages: Package[] = [];

    for (const cargoPath of cargoTomlPaths) {
      try {
        const fullCargoPath = path.join(workspaceRoot, cargoPath);
        const packageDir = path.dirname(fullCargoPath);

        // Skip if this directory already has a package.json (handled by @manypkg)
        if (fs.existsSync(path.join(packageDir, 'package.json'))) {
          continue;
        }

        // Parse Cargo.toml
        const cargoData = parseCargoToml(fullCargoPath);

        // Skip crates that explicitly opt out of publishing (`publish = false` or `publish = []`).
        const publishField = cargoData.package?.publish;
        if (publishField === false || (Array.isArray(publishField) && publishField.length === 0)) {
          log(`Skipping Rust package at ${packageDir}: publish = false`, 'debug');
          continue;
        }

        if (cargoData.package?.name && typeof cargoData.package?.version === 'string') {
          // Check if this is a valid workspace package (not in target/ or other build dirs)
          const relativePath = path.relative(workspaceRoot, packageDir);
          const pathParts = relativePath.split(path.sep);
          if (pathParts.includes('target') || pathParts.includes('node_modules')) {
            continue;
          }

          // When workspace members are declared, only include packages inside those globs.
          // The workspace root itself (relativePath === '') is always included — it is the
          // package whose Cargo.toml declares [workspace], so member globs don't apply to it.
          if (workspaceMembers !== null && relativePath !== '') {
            const normalizedRelative = relativePath.replace(/\\/g, '/');
            const matchesMember = workspaceMembers.some((member) =>
              minimatch(normalizedRelative, member, { dot: true }),
            );
            if (!matchesMember) {
              log(
                `Skipping Rust package ${cargoData.package.name} at ${relativePath}: not in workspace members`,
                'debug',
              );
              continue;
            }
          }

          rustPackages.push({
            packageJson: {
              name: cargoData.package.name,
              version: cargoData.package.version,
            },
            dir: packageDir,
            relativeDir: relativePath,
          });
          log(`Discovered Rust package: ${cargoData.package.name} at ${packageDir}`, 'debug');
        }
      } catch (error) {
        log(`Failed to parse Cargo.toml at ${cargoPath}: ${error}`, 'warning');
      }
    }

    return {
      packages: rustPackages,
      root: workspaceRoot,
      // biome-ignore lint/suspicious/noExplicitAny: Tool type from @manypkg doesn't support cargo-only packages
      tool: 'pnpm' as any,
      rootDir: workspaceRoot,
    };
  }

  /**
   * Discover pure Dart/Flutter packages (pubspec.yaml only) in the workspace. Mirrors the Cargo
   * discovery: directories that already carry a package.json are left to @manypkg, and the merge
   * step dedupes any directory shared with a Cargo crate.
   *
   * Skips packages with `publish_to: none` (pub's publish opt-out).
   * When pnpm-workspace.yaml exists at the workspace root, only packages whose paths match the
   * declared workspace globs are discovered.
   */
  private discoverPubspecPackages(workspaceRoot: string): PackagesWithRoot {
    // Read pnpm-workspace.yaml globs to scope pub discovery to declared paths.
    let pnpmWorkspaceGlobs: string[] | null = null;
    const pnpmWorkspacePath = path.join(workspaceRoot, 'pnpm-workspace.yaml');
    if (fs.existsSync(pnpmWorkspacePath)) {
      try {
        const pnpmWorkspaceContent = fs.readFileSync(pnpmWorkspacePath, 'utf-8');
        const pnpmWorkspace = yaml.parse(pnpmWorkspaceContent) as { packages?: string[] };
        if (Array.isArray(pnpmWorkspace?.packages) && pnpmWorkspace.packages.length > 0) {
          pnpmWorkspaceGlobs = pnpmWorkspace.packages;
          log(`pnpm workspace globs detected for pub discovery scoping: ${pnpmWorkspaceGlobs.join(', ')}`, 'debug');
        }
      } catch (error) {
        log(`Could not parse pnpm-workspace.yaml for pub discovery scoping: ${error}`, 'debug');
      }
    }

    const pubspecPaths: string[] = [];

    const findPubspec = (dir: string, relativePath: string = '') => {
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });

        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          const relPath = path.join(relativePath, entry.name);

          if (entry.isDirectory()) {
            // Skip dependency/build output dirs (incl. Dart's .dart_tool and build).
            if (
              entry.name === 'node_modules' ||
              entry.name === 'target' ||
              entry.name === '.git' ||
              entry.name === '.dart_tool' ||
              entry.name === 'build'
            ) {
              continue;
            }
            findPubspec(fullPath, relPath);
          } else if (entry.isFile() && entry.name === 'pubspec.yaml') {
            pubspecPaths.push(relPath);
          }
        }
      } catch (error) {
        log(`Cannot read directory ${dir}: ${error}`, 'debug');
      }
    };

    findPubspec(workspaceRoot);

    const dartPackages: Package[] = [];

    for (const pubspecPath of pubspecPaths) {
      try {
        const fullPubspecPath = path.join(workspaceRoot, pubspecPath);
        const packageDir = path.dirname(fullPubspecPath);

        // Skip if this directory already has a package.json (handled by @manypkg).
        if (fs.existsSync(path.join(packageDir, 'package.json'))) {
          continue;
        }

        const pubData = parsePubspec(fullPubspecPath);

        // Skip packages that explicitly opt out of publishing via pub's convention.
        if (pubData.publish_to === 'none') {
          log(`Skipping Dart package at ${packageDir}: publish_to: none`, 'debug');
          continue;
        }

        // Require an explicit version, like the Cargo path. A versionless pubspec is a Dart workspace
        // root or app manifest, not a publishable package — discovering it would feed a bogus baseline
        // into the version stage. (No target/node_modules path check: findPubspec already skips those
        // directories during the walk, so a found pubspec is never inside one.)
        if (pubData.name && typeof pubData.version === 'string') {
          const relativePath = path.relative(workspaceRoot, packageDir);

          // When pnpm workspace globs are declared, only include packages inside those globs.
          if (pnpmWorkspaceGlobs !== null) {
            const normalizedRelative = relativePath.replace(/\\/g, '/');
            const matchesGlob = pnpmWorkspaceGlobs.some((glob) => minimatch(normalizedRelative, glob, { dot: true }));
            if (!matchesGlob) {
              log(`Skipping Dart package ${pubData.name} at ${relativePath}: not in pnpm workspace globs`, 'debug');
              continue;
            }
          }

          dartPackages.push({
            packageJson: {
              name: pubData.name,
              version: pubData.version,
            },
            dir: packageDir,
            relativeDir: relativePath,
          });
          log(`Discovered Dart package: ${pubData.name} at ${packageDir}`, 'debug');
        }
      } catch (error) {
        log(`Failed to parse pubspec.yaml at ${pubspecPath}: ${error}`, 'warning');
      }
    }

    return {
      packages: dartPackages,
      root: workspaceRoot,
      // biome-ignore lint/suspicious/noExplicitAny: Tool type from @manypkg doesn't support pub-only packages
      tool: 'pnpm' as any,
      rootDir: workspaceRoot,
    };
  }

  /**
   * Merge two package lists by directory, keeping the base entry for any shared directory. Used to
   * fold Cargo and pubspec discoveries into the @manypkg set (and is run once per native ecosystem),
   * so it stays manifest-agnostic.
   */
  private mergePackageLists(basePackages: PackagesWithRoot, extraPackages: PackagesWithRoot): PackagesWithRoot {
    const mergedPackages = [...basePackages.packages];

    for (const extraPkg of extraPackages.packages) {
      // Same directory already discovered (a hybrid package.json + native manifest) — keep the base
      // entry, which carries the richer @manypkg data.
      const alreadyDiscovered = mergedPackages.some((pkg) => pkg.dir === extraPkg.dir);

      if (alreadyDiscovered) {
        log(`Hybrid package detected: ${extraPkg.packageJson.name} already discovered via package.json`, 'debug');
      } else {
        mergedPackages.push(extraPkg);
      }
    }

    return {
      packages: mergedPackages,
      root: basePackages.root || extraPackages.root,
      // biome-ignore lint/suspicious/noExplicitAny: Tool type from @manypkg doesn't support mixed packages
      tool: 'pnpm' as any,
      rootDir: basePackages.root || extraPackages.root,
    };
  }

  /**
   * Lightweight changed-detection for prerequisite resolution: a package is "changed" when it has
   * commits since its last release tag. Over-inclusive by design — a pulled-in prerequisite with no
   * *releasable* change is still skipped by the per-package bump calc downstream. Tag lookups are
   * independent per package, so they run in parallel.
   */
  private async detectChangedPackages(packages: Package[]): Promise<Set<string>> {
    const formattedPrefix = formatVersionPrefix(this.config.versionPrefix || 'v');
    const results = await Promise.all(
      packages.map(async (pkg) => {
        let tag = '';
        try {
          tag = await getLatestTagForPackage(pkg.packageJson.name, formattedPrefix, {
            tagTemplate: this.config.tagTemplate,
            packageSpecificTags: this.config.packageSpecificTags,
          });
          if (!tag) tag = await getLatestTag(formattedPrefix);
        } catch {
          // No tag resolvable — getCommitsLength falls back to git describe / full history.
        }
        return getCommitsLength(pkg.dir, tag) > 0 ? pkg.packageJson.name : null;
      }),
    );
    return new Set(results.filter((name): name is string => name !== null));
  }

  /**
   * Get workspace packages information - with caching for performance
   */
  public async getWorkspacePackages(): Promise<PackagesWithRoot> {
    try {
      // Return cached result if available for better performance
      if (this.workspaceCache) {
        return this.workspaceCache;
      }

      const workspaceRoot = cwd();

      // 1. Discover packages with package.json (existing behavior)
      const npmPackages = getPackagesSync(workspaceRoot) as PackagesWithRoot;
      if (!npmPackages?.packages) {
        throw createVersionError(VersionErrorCode.PACKAGES_NOT_FOUND);
      }

      // 2. Discover additional pure Rust (Cargo.toml) and Dart/Flutter (pubspec.yaml) packages
      const rustPackages = this.discoverCargoTomlPackages(workspaceRoot);
      const dartPackages = this.discoverPubspecPackages(workspaceRoot);

      // 3. Merge package lists with proper deduplication (by directory; npm wins for hybrids)
      const mergedPackages = this.mergePackageLists(this.mergePackageLists(npmPackages, rustPackages), dartPackages);

      // Log discovery results (pre-filter)
      const rustCount = rustPackages.packages.length;
      const dartCount = dartPackages.packages.length;
      const npmCount = npmPackages.packages.length;
      log(
        `Discovered ${npmCount} NPM, ${rustCount} Rust, and ${dartCount} Dart packages (${mergedPackages.packages.length} total)`,
        'info',
      );

      // Ensure the root property is set
      if (!mergedPackages.root) {
        log('Root path is undefined in packages result, setting to current working directory', 'warning');
        mergedPackages.root = workspaceRoot;
      }

      // --include-prerequisites: expand the explicit targets to the full release set (their changed
      // transitive dependencies + the rest of any group they belong to) and scope the bump/prerelease/
      // stable override to just the explicit, group-expanded targets. Runs on the full discovered set,
      // before the target pre-filter below, so prerequisites aren't pruned away.
      if (this.includePrerequisites && this.runtimeTargets.length > 0) {
        const graph = buildWorkspaceGraph(mergedPackages.packages);
        const changed = await this.detectChangedPackages(mergedPackages.packages);
        const { targets, overrideScope, prerequisiteOf } = resolvePrerequisiteTargets(
          graph,
          mergedPackages.packages,
          this.config,
          this.runtimeTargets,
          (name) => changed.has(name),
        );
        log(
          `Prerequisites: releasing ${targets.length} package(s); override scoped to [${overrideScope.join(', ')}].`,
          'info',
        );
        this.runtimeTargets = targets;
        this.config.overrideScope = overrideScope;
        this.prerequisiteOf = prerequisiteOf;
        // Rebuild strategies so they pick up the override scope derived from the workspace graph.
        this.strategies = createStrategyMap(this.config);
        this.currentStrategy = createStrategy(this.config);
      }

      // When explicit version groups are configured, do NOT pre-filter by runtime targets here.
      // The group strategy needs the full group membership to expand a `--target` that hits a
      // strict subset of a fixed group up to the whole group — pruning non-targeted members at
      // discovery time would silently split the group. The strategy applies group-aware target
      // filtering itself. (config.packages filtering still applies — it scopes the universe.)
      const deferTargetsToGroups = Object.keys(this.config.groups ?? {}).length > 0;

      // Filter packages based on config.packages if specified
      if (this.config.packages && this.config.packages.length > 0) {
        const originalCount = mergedPackages.packages.length;

        const filteredPackages = filterPackagesByConfig(
          mergedPackages.packages,
          this.config.packages,
          mergedPackages.root,
        );

        mergedPackages.packages = filteredPackages;

        // Log filtering results
        log(
          `Filtered ${originalCount} workspace packages to ${filteredPackages.length} based on packages config`,
          'info',
        );

        if (filteredPackages.length === 0) {
          log('Warning: No packages matched the specified patterns in config.packages', 'warning');
        }
      } else if (this.runtimeTargets.length > 0 && !deferTargetsToGroups) {
        // If no config.packages but runtime targets specified, use targets as primary filter
        const originalCount = mergedPackages.packages.length;
        mergedPackages.packages = mergedPackages.packages.filter((pkg) =>
          shouldMatchPackageTargets(pkg.packageJson.name, this.runtimeTargets),
        );
        log(
          `Filtered ${originalCount} workspace packages to ${mergedPackages.packages.length} based on runtime targets`,
          'info',
        );
      }

      // Apply runtime targets as secondary filter (after config.packages)
      if (this.runtimeTargets.length > 0 && mergedPackages.packages.length > 0 && !deferTargetsToGroups) {
        const beforeCount = mergedPackages.packages.length;
        mergedPackages.packages = mergedPackages.packages.filter((pkg) =>
          shouldMatchPackageTargets(pkg.packageJson.name, this.runtimeTargets),
        );
        log(`Runtime targets filter: ${beforeCount} → ${mergedPackages.packages.length} packages`, 'info');
      }

      // Final filter: drop explicitly excluded packages from the release set (standing-PR ad-hoc
      // deselection). Applied last so it overrides every inclusion above — an excluded package never
      // gets bumped, even if a target or prerequisite expansion pulled it in. Exact name match.
      if (this.excludePackages.length > 0) {
        const excluded = new Set(this.excludePackages);
        const beforeCount = mergedPackages.packages.length;
        mergedPackages.packages = mergedPackages.packages.filter((pkg) => !excluded.has(pkg.packageJson.name));
        log(`Exclude filter: ${beforeCount} → ${mergedPackages.packages.length} packages`, 'info');
      }

      // Cache the result for subsequent calls
      this.workspaceCache = mergedPackages;

      return mergedPackages;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log(`Failed to get packages information: ${errorMessage}`, 'error');
      console.error(error);

      // Throw a more specific error for better error handling upstream
      throw createVersionError(VersionErrorCode.WORKSPACE_ERROR, errorMessage);
    }
  }

  /**
   * Run the current strategy
   * @param packages Workspace packages to process
   * @param targets Optional package targets to process (only used by async strategy)
   */
  public async run(packages: PackagesWithRoot, targets: string[] = []): Promise<void> {
    try {
      // Execute the strategy function
      await this.currentStrategy(packages, targets);
      // Once the strategy has produced the updates, tag each one's role: explicit (group-expanded)
      // targets keep the override; derived prerequisites carry their own bump and record the
      // target(s) they were pulled in for. Only when prerequisites were actually derived.
      if (Object.keys(this.prerequisiteOf).length > 0) {
        tagPrerequisiteRoles(this.config.overrideScope ?? [], this.prerequisiteOf);
      }
    } catch (error) {
      if (error instanceof VersionError || error instanceof GitError) {
        log(`Version engine failed: ${error.message} (${error.code || 'UNKNOWN'})`, 'error');

        // Enhanced error logging for GitError
        if (error instanceof GitError) {
          console.error('Git error details:');
          if (error.message.includes('Command failed:')) {
            const cmdOutput = error.message.split('Command failed:')[1];
            if (cmdOutput) {
              console.error('Command output:', cmdOutput.trim());
            }
          }
        }
      } else {
        const errorMessage = error instanceof Error ? error.message : String(error);
        log(`Version engine failed: ${errorMessage}`, 'error');

        if (error instanceof Error && error.stack) {
          console.error('Error stack trace:');
          console.error(error.stack);
        }
      }
      throw error;
    }
  }

  /**
   * Change the current strategy
   * @param strategyType The strategy type to use: 'sync', 'single', or 'async'
   */
  public setStrategy(strategyType: StrategyType): void {
    this.currentStrategy = this.strategies[strategyType];
  }
}
