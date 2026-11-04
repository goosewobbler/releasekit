import {
  exitCodeForError,
  setJsonMode,
  setLogLevel,
  successEnvelope,
  warn,
  writeEnvelope,
  writeErrorEnvelope,
} from '@releasekit/core';
import { Command } from 'commander';
import { loadConfig } from './config.js';
import { BasePublishError, PipelineError } from './errors/index.js';
import { publishDidChange } from './output.js';
import { runPipeline } from './pipeline/index.js';
import { pipelineErrorEnvelope } from './pipeline-error-envelope.js';
import { parseInput } from './stages/input.js';
import type { PublishCliOptions, PublishOutput } from './types.js';

export interface PublishCommandHooks {
  /** Runs after the pipeline, with its output or a failure's partial output. Its errors only warn. */
  afterRun?: (output: PublishOutput, options: PublishCliOptions) => Promise<void>;
}

export function createPublishCommand(hooks: PublishCommandHooks = {}): Command {
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

      if (options.verbose) {
        setLogLevel('debug');
      }
      if (options.json) {
        setJsonMode(true);
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

      try {
        const config = loadConfig({ configPath: options.config });
        const input = await parseInput(options.input);

        if (options.npmAuth !== 'auto') {
          config.npm.auth = options.npmAuth;
        }

        const output = await runPipeline(input, config, cliOptions);

        writeEnvelope(successEnvelope(output, { changed: publishDidChange(output) }), io);
        await runAfterRun(hooks, output, cliOptions);
      } catch (err) {
        if (err instanceof PipelineError) {
          writeEnvelope(pipelineErrorEnvelope(err), io);
          err.logError();
          await runAfterRun(hooks, err.partialOutput, cliOptions);
        } else {
          writeErrorEnvelope(err, io);
          if (BasePublishError.isPublishError(err)) {
            err.logError();
          } else {
            console.error(err instanceof Error ? err.message : String(err));
          }
        }
        process.exit(exitCodeForError(err));
      }
    });
}

async function runAfterRun(
  hooks: PublishCommandHooks,
  output: PublishOutput,
  options: PublishCliOptions,
): Promise<void> {
  try {
    await hooks.afterRun?.(output, options);
  } catch (err) {
    warn(`The post-publish step failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}
