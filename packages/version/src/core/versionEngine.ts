import { cwd } from 'node:process';

import { getPackagesSync, type Packages } from '@manypkg/get-packages';

import { GitError } from '../errors/gitError.js';
import { createVersionError, VersionError, VersionErrorCode } from '../errors/versionError.js';
import type { Config, VersionRunOptions } from '../types.js';
import { log } from '../utils/logging.js';
import { filterPackagesByConfig } from '../utils/packageFiltering.js';
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
        effective.prereleaseIdentifier = typeof runOptions.prerelease === 'string' ? runOptions.prerelease : 'next';
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
   * Get workspace packages information - with caching for performance
   */
  public async getWorkspacePackages(): Promise<PackagesWithRoot> {
    try {
      // Return cached result if available for better performance
      if (this.workspaceCache) {
        return this.workspaceCache;
      }

      const pkgsResult = getPackagesSync(cwd()) as PackagesWithRoot;
      if (!pkgsResult?.packages) {
        throw createVersionError(VersionErrorCode.PACKAGES_NOT_FOUND);
      }

      // Ensure the root property is set
      if (!pkgsResult.root) {
        log('Root path is undefined in packages result, setting to current working directory', 'warning');
        pkgsResult.root = cwd();
      }

      // Filter packages based on config.packages if specified
      if (this.config.packages && this.config.packages.length > 0) {
        const originalCount = pkgsResult.packages.length;

        const filteredPackages = filterPackagesByConfig(pkgsResult.packages, this.config.packages, pkgsResult.root);

        pkgsResult.packages = filteredPackages;

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
      this.workspaceCache = pkgsResult;
      return pkgsResult;
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
