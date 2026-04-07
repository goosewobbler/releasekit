import { Command } from 'commander';
import { loadConfig } from './config.js';
import { VersionEngine } from './core/versionEngine.js';
import type { Config } from './types.js';
import { enableJsonOutput, printJsonOutput } from './utils/jsonOutput.js';
import { log } from './utils/logging.js';

export function createVersionCommand(): Command {
  return new Command('version')
    .description('Version a package or packages based on configuration')
    .option('-c, --config <path>', 'Path to config file (defaults to releasekit.config.json in current directory)')
    .option('-d, --dry-run', 'Dry run (no changes made)', false)
    .option('-b, --bump <type>', 'Specify bump type (patch|minor|major)')
    .option('-p, --prerelease [identifier]', 'Create prerelease version')
    .option('-s, --sync', 'Use synchronized versioning across all packages')
    .option('-j, --json', 'Output results as JSON', false)
    .option('-t, --target <packages>', 'Comma-delimited list of package names to target')
    .option('--project-dir <path>', 'Project directory to run commands in', process.cwd())
    .action(async (options) => {
      if (options.json) {
        enableJsonOutput(options.dryRun);
      }

      try {
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

        const config: Config = loadConfig({ cwd: options.projectDir, configPath: options.config });
        log(`Loaded configuration from ${options.config || 'releasekit.config.json'}`, 'info');

        const cliTargets: string[] = options.target ? options.target.split(',').map((t: string) => t.trim()) : [];

        if (cliTargets.length > 0) {
          log(`CLI targets specified: ${cliTargets.join(', ')}`, 'info');
        }

        const runOptions = {
          bump: options.bump,
          prerelease: options.prerelease,
          dryRun: options.dryRun,
          sync: options.sync,
          targets: cliTargets.length > 0 ? cliTargets : undefined,
        };

        const engine = new VersionEngine(config, runOptions);

        const pkgsResult = await engine.getWorkspacePackages();
        const resolvedCount = pkgsResult.packages.length;

        log(`Resolved ${resolvedCount} packages from workspace`, 'debug');
        log(`Config packages: ${JSON.stringify(config.packages)}`, 'debug');
        log(`Config sync: ${config.sync}`, 'debug');

        const effectiveSync = options.sync || config.sync;
        if (effectiveSync) {
          log('Using sync versioning strategy.', 'info');
          engine.setStrategy('sync');
          await engine.run(pkgsResult);
        } else if (resolvedCount === 1) {
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

        printJsonOutput();
      } catch (error) {
        const { BaseVersionError } = await import('./errors/baseError.js');

        if (BaseVersionError.isVersionError(error)) {
          error.logError();
        } else {
          log(`Error: ${error instanceof Error ? error.message : String(error)}`, 'error');
        }
        process.exit(1);
      }
    });
}
