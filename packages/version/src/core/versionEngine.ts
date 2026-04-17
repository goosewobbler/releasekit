import * as fs from 'node:fs';
import * as path from 'node:path';
import { cwd } from 'node:process';
import { getPackagesSync, type Package, type Packages } from '@manypkg/get-packages';
import { filterPackagesByConfig, parseCargoToml } from '@releasekit/config';
import { GitError } from '../errors/gitError.js';
import { createVersionError, VersionError, VersionErrorCode } from '../errors/versionError.js';
import type { Config, VersionRunOptions } from '../types.js';
import { log } from '../utils/logging.js';
import { createStrategy, createStrategyMap, type StrategyFunction, type StrategyType } from './versionStrategies.js';

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
      if (runOptions.targets?.length) effective.packages = runOptions.targets;
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
   * Discover pure Rust packages (Cargo.toml only) in the workspace
   */
  private discoverCargoTomlPackages(workspaceRoot: string): PackagesWithRoot {
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
        const cargoContent = fs.readFileSync(fullCargoPath, 'utf-8');
        const cargoData = parseCargoToml(cargoContent);

        if (cargoData.package?.name && cargoData.package?.version) {
          // Check if this is a valid workspace package (not in target/ or other build dirs)
          const relativePath = path.relative(workspaceRoot, packageDir);
          if (!relativePath.includes('target') && !relativePath.includes('node_modules')) {
            rustPackages.push({
              packageJson: {
                name: cargoData.package.name,
                version: cargoData.package.version,
                // Add minimal required fields
                private: true,
              },
              dir: packageDir,
              relativeDir: relativePath,
            });
            log(`Discovered Rust package: ${cargoData.package.name} at ${packageDir}`, 'debug');
          }
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
   * Merge NPM and Rust package lists with proper deduplication
   */
  private mergePackageLists(npmPackages: PackagesWithRoot, rustPackages: PackagesWithRoot): PackagesWithRoot {
    const mergedPackages = [...npmPackages.packages];

    for (const rustPkg of rustPackages.packages) {
      // Check if this Rust package already exists in NPM packages (hybrid package)
      const existingIndex = mergedPackages.findIndex((pkg) => pkg.dir === rustPkg.dir);

      if (existingIndex >= 0) {
        // Hybrid package: prefer NPM package data, but log that Cargo.toml was found
        log(`Hybrid package detected: ${rustPkg.packageJson.name} has both package.json and Cargo.toml`, 'debug');
        // NPM package already includes the data we need
      } else {
        // Pure Rust package: add it to the list
        mergedPackages.push(rustPkg);
      }
    }

    return {
      packages: mergedPackages,
      root: npmPackages.root || rustPackages.root,
      // biome-ignore lint/suspicious/noExplicitAny: Tool type from @manypkg doesn't support mixed packages
      tool: 'pnpm' as any,
      rootDir: npmPackages.root || rustPackages.root,
    };
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

      // 2. Discover additional pure Rust packages (Cargo.toml only)
      const rustPackages = this.discoverCargoTomlPackages(workspaceRoot);

      // 3. Merge package lists with proper deduplication
      const mergedPackages = this.mergePackageLists(npmPackages, rustPackages);

      // Ensure the root property is set
      if (!mergedPackages.root) {
        log('Root path is undefined in packages result, setting to current working directory', 'warning');
        mergedPackages.root = workspaceRoot;
      }

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
      }

      // Cache the result for subsequent calls
      this.workspaceCache = mergedPackages;

      const rustCount = rustPackages.packages.length;
      const npmCount = npmPackages.packages.length;
      log(
        `Discovered ${npmCount} NPM packages and ${rustCount} Rust packages (${mergedPackages.packages.length} total)`,
        'info',
      );

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
      return this.currentStrategy(packages, targets);
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
