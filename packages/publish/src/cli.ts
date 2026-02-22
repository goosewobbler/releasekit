#!/usr/bin/env node
import { EXIT_CODES, setJsonMode, setLogLevel } from '@releasekit/core';
import { Command } from 'commander';
import { loadConfig } from './config.js';
import { BasePublishError, PipelineError } from './errors/index.js';
import { runPipeline } from './pipeline/index.js';
import { parseInput } from './stages/input.js';
import type { PublishCliOptions } from './types.js';

const program = new Command();

program
  .name('releasekit-publish')
  .description('Publish packages to registries with git tagging and GitHub releases')
  .version('0.1.0')
  .option('--input <path>', 'Path to version output JSON (default: stdin)')
  .option('--config <path>', 'Path to releasekit config')
  .option('--registry <type>', 'Registry to publish to (npm, cargo, all)', 'all')
  .option('--npm-auth <method>', 'NPM auth method (oidc, token, auto)', 'auto')
  .option('--dry-run', 'Simulate all operations', false)
  .option('--skip-git', 'Skip git commit/tag/push', false)
  .option('--skip-publish', 'Skip registry publishing', false)
  .option('--skip-github-release', 'Skip GitHub Release creation', false)
  .option('--skip-verification', 'Skip post-publish verification', false)
  .option('--json', 'Output results as JSON', false)
  .option('--verbose', 'Verbose logging', false)
  .action(async (options) => {
    if (options.verbose) setLogLevel('debug');
    if (options.json) setJsonMode(true);

    try {
      const config = loadConfig({ configPath: options.config });
      const input = await parseInput(options.input);

      if (options.npmAuth !== 'auto') {
        config.npm.auth = options.npmAuth;
      }

      const cliOptions: PublishCliOptions = {
        input: options.input,
        config: options.config,
        registry: options.registry,
        npmAuth: options.npmAuth,
        dryRun: options.dryRun,
        skipGit: options.skipGit,
        skipPublish: options.skipPublish,
        skipGithubRelease: options.skipGithubRelease,
        skipVerification: options.skipVerification,
        json: options.json,
        verbose: options.verbose,
      };

      const output = await runPipeline(input, config, cliOptions);

      if (options.json) {
        console.log(JSON.stringify(output, null, 2));
      }
    } catch (err) {
      if (err instanceof PipelineError && options.json) {
        console.log(
          JSON.stringify(
            {
              error: err.message,
              failedStage: err.failedStage,
              partialOutput: err.partialOutput,
            },
            null,
            2,
          ),
        );
        process.exit(EXIT_CODES.PUBLISH_ERROR);
      }
      if (BasePublishError.isPublishError(err)) {
        err.logError();
        process.exit(EXIT_CODES.PUBLISH_ERROR);
      }
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(EXIT_CODES.GENERAL_ERROR);
    }
  });

program.parse();
