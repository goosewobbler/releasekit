import * as fs from 'node:fs';
import * as path from 'node:path';
import { cwd } from 'node:process';
import { inspect } from 'node:util';
import { getPackagesSync, type Package, type Packages } from '@manypkg/get-packages';
import {
  filterPackagesByConfig,
  isCratePublishable,
  matchesDirectoryExactly,
  parseCargoToml,
  parsePubspec,
} from '@releasekit/config';
import { isPrivatePackageJson, shouldMatchPackageTargets } from '@releasekit/core';
import { minimatch } from 'minimatch';
import * as yaml from 'yaml';
import { clearCargoBumps, syncCargoLockfiles } from '../cargo/cargoLock.js';
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

export interface PackagesWithRoot extends Packages {
  root: string;
}

export class VersionEngine {
  private config: Config;
  private workspaceCache: PackagesWithRoot | null = null;
  private strategies: Record<StrategyType, StrategyFunction>;
  private currentStrategy: StrategyFunction;
  private runtimeTargets: string[] = [];
  private includePrerequisites = false;
  private excludePackages: string[] = [];
  private prerequisiteOf: Record<string, string[]> = {};

  constructor(config: Config, runOptions?: VersionRunOptions) {
    if (!config) {
      throw createVersionError(VersionErrorCode.CONFIG_REQUIRED);
    }

    // Shallow copy so the caller's config is never mutated.
    const effective: Config = { ...config };

    if (runOptions) {
      if (runOptions.dryRun) {
        effective.dryRun = true;
      }
      if (runOptions.sync) {
        effective.sync = true;
      }
      if (runOptions.bump) {
        effective.type = runOptions.bump;
      }
      if (runOptions.prerelease) {
        effective.prereleaseIdentifier =
          typeof runOptions.prerelease === 'string' ? runOptions.prerelease : effective.prereleaseIdentifier || 'next';
        effective.isPrerelease = true;
      }
      if (runOptions.stable) {
        effective.stableOnly = true;
      }
      // The global `stable` flag graduates everything, so a scope would only narrow it. applyOverrideScope
      // clears stableOnly for packages outside the scope.
      if (!runOptions.stable && runOptions.graduate?.length) {
        effective.stableOnly = true;
        effective.graduateScope = runOptions.graduate;
      }
      // Twin of graduate above; the group strategy also gates group-level prerelease on the scope.
      if (!runOptions.prerelease && runOptions.prereleaseScope?.length) {
        effective.isPrerelease = true;
        effective.prereleaseIdentifier = effective.prereleaseIdentifier || 'next';
        effective.prereleaseScope = runOptions.prereleaseScope;
      }
      if (runOptions.allowFirstBump) {
        effective.allowFirstBump = true;
      }
      if (runOptions.targets?.length) {
        this.runtimeTargets = runOptions.targets;
      }
      if (runOptions.baseRef) {
        effective.baseRef = runOptions.baseRef;
      }
      if (runOptions.overrideScope) {
        effective.overrideScope = runOptions.overrideScope;
      }
      if (runOptions.includePrerequisites) {
        this.includePrerequisites = true;
      }
      if (runOptions.exclude?.length) {
        this.excludePackages = runOptions.exclude;
      }
    }

    this.config = effective;

    this.strategies = createStrategyMap(effective);

    this.currentStrategy = createStrategy(effective);
  }

  private discoverCargoTomlPackages(workspaceRoot: string): PackagesWithRoot {
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

    const findCargoToml = (dir: string, relativePath: string = '') => {
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });

        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          const relPath = path.join(relativePath, entry.name);

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
        log(`Cannot read directory ${dir}: ${error}`, 'debug');
      }
    };

    findCargoToml(workspaceRoot);

    const rustPackages: Package[] = [];

    for (const cargoPath of cargoTomlPaths) {
      try {
        const fullCargoPath = path.join(workspaceRoot, cargoPath);
        const packageDir = path.dirname(fullCargoPath);

        // package.json directories are discovered by @manypkg.
        if (fs.existsSync(path.join(packageDir, 'package.json'))) {
          continue;
        }

        const cargoData = parseCargoToml(fullCargoPath);

        if (!isCratePublishable(cargoData)) {
          log(`Skipping Rust package at ${packageDir}: publish = false`, 'debug');
          continue;
        }

        if (cargoData.package?.name && typeof cargoData.package?.version === 'string') {
          const relativePath = path.relative(workspaceRoot, packageDir);
          const pathParts = relativePath.split(path.sep);
          if (pathParts.includes('target') || pathParts.includes('node_modules')) {
            continue;
          }

          // The workspace root (relativePath === '') declares [workspace], so member globs don't apply to it.
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

  private discoverPubspecPackages(workspaceRoot: string): PackagesWithRoot {
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

        if (fs.existsSync(path.join(packageDir, 'package.json'))) {
          continue;
        }

        const pubData = parsePubspec(fullPubspecPath);

        if (pubData.publish_to === 'none') {
          log(`Skipping Dart package at ${packageDir}: publish_to: none`, 'debug');
          continue;
        }

        // A versionless pubspec is a Dart workspace root or app manifest, not a publishable package.
        if (pubData.name && typeof pubData.version === 'string') {
          const relativePath = path.relative(workspaceRoot, packageDir);

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

  private mergePackageLists(basePackages: PackagesWithRoot, extraPackages: PackagesWithRoot): PackagesWithRoot {
    const mergedPackages = [...basePackages.packages];

    for (const extraPkg of extraPackages.packages) {
      // A hybrid (package.json & native manifest) keeps the base entry, which carries the richer @manypkg data.
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
   * Over-inclusive by design (any commit since the last tag counts) - a pulled-in prerequisite with no
   * *releasable* change is still skipped by the per-package bump calc downstream.
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
          if (!tag) {
            tag = await getLatestTag(formattedPrefix);
          }
        } catch {
          // No tag resolvable - getCommitsLength falls back to git describe / full history.
        }
        return (await getCommitsLength(pkg.dir, tag)) > 0 ? pkg.packageJson.name : null;
      }),
    );
    return new Set(results.filter((name): name is string => name !== null));
  }

  private isNativelyPublishable(packageDir: string): boolean {
    const cargoPath = path.join(packageDir, 'Cargo.toml');
    if (fs.existsSync(cargoPath)) {
      try {
        const pkg = parseCargoToml(cargoPath).package;
        const publish = pkg?.publish;
        if (pkg?.name && publish !== false && !(Array.isArray(publish) && publish.length === 0)) {
          return true;
        }
      } catch {
        // Unparseable: a malformed manifest must never resurrect a private package.
      }
    }
    const pubspecPath = path.join(packageDir, 'pubspec.yaml');
    if (fs.existsSync(pubspecPath)) {
      try {
        if (parsePubspec(pubspecPath).publish_to !== 'none') {
          return true;
        }
      } catch {
        // Unparseable pubspec - fall through.
      }
    }
    return false;
  }

  public async getWorkspacePackages(workspaceRoot: string = cwd()): Promise<PackagesWithRoot> {
    try {
      if (this.workspaceCache) {
        return this.workspaceCache;
      }

      const npmPackages = getPackagesSync(workspaceRoot) as PackagesWithRoot;
      if (!npmPackages?.packages) {
        throw createVersionError(VersionErrorCode.PACKAGES_NOT_FOUND);
      }

      const rustPackages = this.discoverCargoTomlPackages(workspaceRoot);
      const dartPackages = this.discoverPubspecPackages(workspaceRoot);

      const mergedPackages = this.mergePackageLists(this.mergePackageLists(npmPackages, rustPackages), dartPackages);

      const rustCount = rustPackages.packages.length;
      const dartCount = dartPackages.packages.length;
      const npmCount = npmPackages.packages.length;
      log(
        `Discovered ${npmCount} NPM, ${rustCount} Rust, and ${dartCount} Dart packages (${mergedPackages.packages.length} total)`,
        'info',
      );

      if (!mergedPackages.root) {
        log('Root path is undefined in packages result, setting to current working directory', 'warning');
        mergedPackages.root = workspaceRoot;
      }

      // Captured before release-set filtering so the repo-level changelog classifier can tell "touches a
      // non-releasing package" from "genuinely repo-level" and resolve shared-package globs against every package.
      this.config.allWorkspacePackages = mergedPackages.packages.map((p) => ({
        name: p.packageJson.name,
        dir: p.dir,
      }));

      const discoveredPackages = mergedPackages.packages;
      const skippedPrivate = new Set<Package>();

      // npm refuses to publish `"private": true` packages. Filtered before prerequisite and group expansion
      // so a private package can't be pulled in transitively. Exemptions:
      //  - a private package listed in version.packages by its EXACT name or directory (a broad glob would
      //    silently disable the skip for everything it matches); and
      //  - a hybrid whose native sibling still publishes - npm `private` only suppresses the npm publish.
      if (!this.config.includePrivate) {
        const configEntries = this.config.packages ?? [];
        const listedExactly = (pkg: Package) =>
          configEntries.some(
            (entry) => entry === pkg.packageJson.name || matchesDirectoryExactly(pkg, entry, mergedPackages.root),
          );
        mergedPackages.packages = mergedPackages.packages.filter((pkg) => {
          if (!isPrivatePackageJson(pkg.packageJson, path.join(pkg.dir, 'package.json'))) {
            return true;
          }
          if (listedExactly(pkg)) {
            return true;
          }
          if (this.isNativelyPublishable(pkg.dir)) {
            return true;
          }
          log(`Skipping private npm package ${pkg.packageJson.name}: package.json "private": true`, 'debug');
          skippedPrivate.add(pkg);
          return false;
        });
        if (skippedPrivate.size > 0) {
          log(`Private filter: ${discoveredPackages.length} → ${mergedPackages.packages.length} packages`, 'debug');
        }
      }

      // Runs on the full discovered set, before the target pre-filter below, so prerequisites aren't pruned.
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

      // The group strategy filters targets itself: it needs full membership to expand a `--target` on part
      // of an atomic group to the whole group. config.packages still applies - it scopes the universe.
      const deferTargetsToGroups = Object.keys(this.config.groups ?? {}).length > 0;

      if (this.config.packages && this.config.packages.length > 0) {
        const matchedPackages = filterPackagesByConfig(discoveredPackages, this.config.packages, mergedPackages.root);

        log(
          `Filtered ${discoveredPackages.length} workspace packages to ${matchedPackages.length} based on packages config`,
          'info',
        );

        if (matchedPackages.length === 0) {
          log('Warning: No packages matched the specified patterns in config.packages', 'warning');
        }

        const matchedButPrivate = matchedPackages.filter((pkg) => skippedPrivate.has(pkg));
        if (matchedButPrivate.length > 0) {
          const names = matchedButPrivate.map((pkg) => pkg.packageJson.name).join(', ');
          log(
            `Skipping private packages matched by version.packages: ${names}. Set version.includePrivate: true, ` +
              'or list each one in version.packages by its exact name or directory path.',
            'warning',
          );
        }

        mergedPackages.packages = matchedPackages.filter((pkg) => !skippedPrivate.has(pkg));
      } else if (this.runtimeTargets.length > 0 && !deferTargetsToGroups) {
        const originalCount = mergedPackages.packages.length;
        mergedPackages.packages = mergedPackages.packages.filter((pkg) =>
          shouldMatchPackageTargets(pkg.packageJson.name, this.runtimeTargets),
        );
        log(
          `Filtered ${originalCount} workspace packages to ${mergedPackages.packages.length} based on runtime targets`,
          'info',
        );
      }

      if (this.runtimeTargets.length > 0 && mergedPackages.packages.length > 0 && !deferTargetsToGroups) {
        const beforeCount = mergedPackages.packages.length;
        mergedPackages.packages = mergedPackages.packages.filter((pkg) =>
          shouldMatchPackageTargets(pkg.packageJson.name, this.runtimeTargets),
        );
        log(`Runtime targets filter: ${beforeCount} → ${mergedPackages.packages.length} packages`, 'info');
      }

      // Last, so it overrides every inclusion above (see VersionRunOptions.exclude).
      if (this.excludePackages.length > 0) {
        const excluded = new Set(this.excludePackages);
        const beforeCount = mergedPackages.packages.length;
        mergedPackages.packages = mergedPackages.packages.filter((pkg) => !excluded.has(pkg.packageJson.name));
        log(`Exclude filter: ${beforeCount} → ${mergedPackages.packages.length} packages`, 'info');
      }

      this.workspaceCache = mergedPackages;

      return mergedPackages;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log(`Failed to get packages information: ${errorMessage}`, 'error');
      log(inspect(error), 'error');

      throw createVersionError(VersionErrorCode.WORKSPACE_ERROR, errorMessage);
    }
  }

  public async run(packages: PackagesWithRoot, targets: string[] = []): Promise<void> {
    try {
      clearCargoBumps();
      await this.currentStrategy(packages, targets);
      await syncCargoLockfiles(packages.root ?? cwd(), this.config.dryRun ?? false);
      if (Object.keys(this.prerequisiteOf).length > 0) {
        tagPrerequisiteRoles(this.config.overrideScope ?? [], this.prerequisiteOf);
      }
    } catch (error) {
      if (error instanceof VersionError || error instanceof GitError) {
        log(`Version engine failed: ${error.message} (${error.code || 'UNKNOWN'})`, 'error');

        if (error instanceof GitError) {
          log('Git error details:', 'error');
          if (error.message.includes('Command failed:')) {
            const cmdOutput = error.message.split('Command failed:')[1];
            if (cmdOutput) {
              log(`Command output: ${cmdOutput.trim()}`, 'error');
            }
          }
        }
      } else {
        const errorMessage = error instanceof Error ? error.message : String(error);
        log(`Version engine failed: ${errorMessage}`, 'error');

        if (error instanceof Error && error.stack) {
          log('Error stack trace:', 'error');
          log(error.stack, 'error');
        }
      }
      throw error;
    }
  }

  public setStrategy(strategyType: StrategyType): void {
    this.currentStrategy = this.strategies[strategyType];
  }
}
