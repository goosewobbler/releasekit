#!/usr/bin/env node
import * as fs from 'node:fs';
import path from 'node:path';
import { Command } from 'commander';
import { loadConfig } from './config.js';
import { VersionEngine } from './core/versionEngine.js';
import type { Config } from './types.js';
import { enableJsonOutput, printJsonOutput } from './utils/jsonOutput.js';
import { log } from './utils/logging.js';

/**
 * Read package version from package.json
 * @returns The package version or a fallback value
 */
function getPackageVersion(): string {
  try {
    // Read version from package.json
    const packageJsonPath = path.resolve(path.dirname(import.meta.url.replace('file:', '')), '../package.json');
    const packageJsonContent = fs.readFileSync(packageJsonPath, 'utf-8');
    const packageJson = JSON.parse(packageJsonContent);
    return packageJson.version || '0.0.0';
  } catch (error) {
    // Fallback in case of any errors
    console.error('Failed to read package version:', error);
    return '0.0.0';
  }
}

/**
 * Main execution function for releasekit-version
 */
export async function run(): Promise<void> {
  try {
    // Add build timestamp and version for debug verification
    const buildTimestamp = new Date().toISOString();
    const packageVersion = getPackageVersion();
    log(`releasekit-version v${packageVersion} (Build: ${buildTimestamp})`, 'debug');

    const program = new Command();

    // Configure the CLI options
    program
      .name('releasekit-version')
      .description(
        'A lightweight yet powerful CLI tool for automated semantic versioning based on Git history and conventional commits.',
      )
      .version(packageVersion);

    // Main versioning command (default)
    program
      .command('version', { isDefault: true })
      .description('Version a package or packages based on configuration')
      .option('-c, --config <path>', 'Path to config file (defaults to version.config.json in current directory)')
      .option('-d, --dry-run', 'Dry run (no changes made)', false)
      .option('-b, --bump <type>', 'Specify bump type (patch|minor|major)')
      .option('-p, --prerelease [identifier]', 'Create prerelease version')
      .option('-s, --sync', 'Use synchronized versioning across all packages')
      .option('-j, --json', 'Output results as JSON', false)
      .option('-t, --target <packages>', 'Comma-delimited list of package names to target')
      .option('--project-dir <path>', 'Project directory to run commands in', process.cwd())
      .action(async (options) => {
        // Enable JSON output mode if requested
        if (options.json) {
          enableJsonOutput(options.dryRun);
        }

        try {
          // Change to the specified directory if provided
          const originalCwd = process.cwd();
          if (options.projectDir && options.projectDir !== originalCwd) {
            try {
              process.chdir(options.projectDir);
              log(`Changed working directory to: ${options.projectDir}`, 'debug');
            } catch (error) {
              throw new Error(
                `Failed to change to directory "${options.projectDir}": ${error instanceof Error ? error.message : String(error)}`,
              );
            }
          }

          // Load config
          const config: Config = await loadConfig(options.config);
          log(`Loaded configuration from ${options.config || 'version.config.json'}`, 'info');

          // Override config with CLI options
          if (options.dryRun) config.dryRun = true;
          if (options.sync) config.sync = true; // Allow forcing sync mode
          if (options.bump) config.type = options.bump;
          if (options.prerelease) {
            config.prereleaseIdentifier = options.prerelease === true ? 'next' : options.prerelease;
            config.isPrerelease = true; // Track that prerelease was explicitly requested
          }

          // Parse targets
          const cliTargets: string[] = options.target ? options.target.split(',').map((t: string) => t.trim()) : [];

          // Override config packages with CLI targets for isolation
          if (cliTargets.length > 0) {
            config.packages = cliTargets;
            log(`CLI targets specified: ${cliTargets.join(', ')}`, 'info');
          }

          // Initialize engine with JSON mode setting
          const engine = new VersionEngine(config, !!options.json);

          // Resolve actual packages before selecting strategy
          const pkgsResult = await engine.getWorkspacePackages();
          const resolvedCount = pkgsResult.packages.length;

          log(`Resolved ${resolvedCount} packages from workspace`, 'debug');
          log(`Config packages: ${JSON.stringify(config.packages)}`, 'debug');
          log(`Config sync: ${config.sync}`, 'debug');

          // Determine strategy based on resolved package count
          if (config.sync) {
            log('Using sync versioning strategy.', 'info');
            engine.setStrategy('sync');
            await engine.run(pkgsResult);
          } else if (resolvedCount === 1) {
            // Check if the resolved package is a real package (not a glob pattern)
            log('Using single package versioning strategy.', 'info');
            if (cliTargets.length > 0) {
              log('--target flag is ignored for single package strategy.', 'warning');
            }
            engine.setStrategy('single');
            await engine.run(pkgsResult);
          } else if (resolvedCount === 0) {
            throw new Error('No packages found in workspace');
          } else {
            log('Using async versioning strategy.', 'info');
            if (cliTargets.length > 0) {
              log(`Targeting specific packages: ${cliTargets.join(', ')}`, 'info');
            }
            engine.setStrategy('async');
            await engine.run(pkgsResult, cliTargets);
          }

          log('Versioning process completed.', 'success');

          // Print JSON output if enabled (this will be the only output in JSON mode)
          printJsonOutput();
        } catch (error) {
          // Import base error class for streamlined handling
          const { BaseVersionError } = await import('./errors/baseError.js');

          // Use streamlined error handling for version errors
          if (BaseVersionError.isVersionError(error)) {
            error.logError(); // Centralized error logging with suggestions
          } else {
            // Handle unexpected errors
            log(error instanceof Error ? error.message : String(error), 'error');

            // Add more detailed error logging for better debugging in CI
            if (error instanceof Error) {
              // Log the full stack trace
              console.error('Error details:');
              console.error(error.stack || error.message);
            }
            process.exit(1);
          }
        }
      });

    program.parse(process.argv);
  } catch (error) {
    console.error('Fatal error:', error);
    process.exit(1);
  }
}

// Entry point
run().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
