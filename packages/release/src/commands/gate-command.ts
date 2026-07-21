import { setJsonMode, setLogLevel, setQuietMode } from '@releasekit/core';
import { Command } from 'commander';
import { runGate } from '../gate/gate.js';
import { emitResult } from './emitResult.js';

export function createGateCommand(): Command {
  return new Command('gate')
    .description('Check whether a release should proceed based on PR labels and config')
    .option('-c, --config <path>', 'Path to config file')
    .option('--scope <name>', 'Resolve scope name to target packages from ci.scopeLabels config')
    .option('-j, --json', 'Output results as JSON', false)
    .option('--output <path>', 'Write the JSON result to a file instead of stdout')
    .option('-v, --verbose', 'Verbose logging', false)
    .option('-q, --quiet', 'Suppress non-error output', false)
    .option('--project-dir <path>', 'Project directory', process.cwd())
    .action(async (opts) => {
      if (opts.json) setJsonMode(true);
      if (opts.verbose) setLogLevel('debug');
      if (opts.quiet) setQuietMode(true);

      try {
        const result = await runGate({
          config: opts.config,
          projectDir: opts.projectDir,
          scope: opts.scope,
          json: opts.json,
          verbose: opts.verbose,
          quiet: opts.quiet,
        });

        emitResult(result, { json: opts.json, output: opts.output });

        process.exit(0);
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });
}
