import {
  EXIT_CODES,
  errorEnvelope,
  setJsonMode,
  setLogLevel,
  successEnvelope,
  toEnvelopeError,
  writeEnvelope,
} from '@releasekit/core';
import { Command } from 'commander';
import { loadConfig } from './config.js';
import { BasePublishError, PipelineError } from './errors/index.js';
import { publishDidChange } from './output.js';
import { runPipeline } from './pipeline/index.js';
import { parseInput } from './stages/input.js';
import type { PublishCliOptions } from './types.js';

export function createPublishCommand(): Command {
  return new Command('publish')
    .description('Publish packages to registries with git tagging and GitHub releases')
    .option('--input <path>', 'Path to version output JSON (default: stdin)')
    .option('--config <path>', 'Path to releasekit config')
    .option('--registry <type>', 'Registry to publish to (npm, cargo, pub, all)', 'all')
    .option('--npm-auth <method>', 'NPM auth method (oidc, token, auto)', 'auto')
    .option('--dry-run', 'Simulate all operations', false)
    .option('--skip-git', 'Skip git commit/tag/push', false)
    .option('--skip-publish', 'Skip registry publishing', false)
    .option('--skip-github-release', 'Skip GitHub Release creation', false)
    .option('--skip-verification', 'Skip post-publish verification', false)
    .option('--json', 'Output results as JSON', false)
    .option('--output <path>', 'Write the JSON result to a file instead of stdout')
    .option('--verbose', 'Verbose logging', false)
    .action(async (options) => {
      const io = { json: options.json, output: options.output };

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

        writeEnvelope(successEnvelope(output, { changed: publishDidChange(output) }), io);
      } catch (err) {
        if (err instanceof PipelineError) {
          // Carry what landed before the failure — the retry needs it. `failedStage` has no envelope
          // field of its own, so it goes in the message rather than being dropped.
          const error = toEnvelopeError(err);
          writeEnvelope(
            errorEnvelope([{ ...error, message: `publish failed in the ${err.failedStage} stage: ${error.message}` }], {
              data: err.partialOutput,
              changed: publishDidChange(err.partialOutput),
            }),
            io,
          );
          err.logError();
          process.exit(EXIT_CODES.PUBLISH_ERROR);
        }
        writeEnvelope(errorEnvelope([toEnvelopeError(err)]), io);
        if (BasePublishError.isPublishError(err)) {
          err.logError();
          process.exit(EXIT_CODES.PUBLISH_ERROR);
        }
        console.error(err instanceof Error ? err.message : String(err));
        process.exit(EXIT_CODES.GENERAL_ERROR);
      }
    });
}
