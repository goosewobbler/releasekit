import { EXIT_CODES } from '@releasekit/core';
import { Command } from 'commander';
import type { StandingPROptions } from '../standing-pr/standing-pr.js';
import { runStandingPRMerge, runStandingPRPublish, runStandingPRUpdate } from '../standing-pr/standing-pr.js';

export function createStandingPRCommand(): Command {
  const cmd = new Command('standing-pr').description(
    'Manage the standing release PR (create/update or publish on merge)',
  );

  const sharedOptions = (c: Command): Command =>
    c
      .option('-c, --config <path>', 'Path to config file')
      .option('--project-dir <path>', 'Project directory', process.cwd())
      .option('--npm-auth <method>', 'NPM auth method (auto|oidc|token)', 'auto')
      .option('-j, --json', 'Output results as JSON', false)
      .option('-v, --verbose', 'Verbose logging', false)
      .option('-q, --quiet', 'Suppress non-error output', false);

  sharedOptions(
    cmd
      .command('update')
      .description('Calculate versions, commit to release branch, and create/update the standing PR'),
  ).action(async (opts) => {
    const options: StandingPROptions = {
      config: opts.config,
      projectDir: opts.projectDir,
      npmAuth: opts.npmAuth,
      json: opts.json,
      verbose: opts.verbose,
      quiet: opts.quiet,
    };

    try {
      const result = await runStandingPRUpdate(options);
      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
      }
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(EXIT_CODES.GENERAL_ERROR);
    }
  });

  sharedOptions(
    cmd
      .command('publish')
      .description('Publish packages from a merged standing release PR (reads manifest from PR comment)')
      .option(
        '--pr <number>',
        'PR number of the merged standing release PR. Use when the workflow runs on a push event (auto-detected from pull_request event when omitted)',
      ),
  ).action(async (opts) => {
    const options: StandingPROptions = {
      config: opts.config,
      projectDir: opts.projectDir,
      npmAuth: opts.npmAuth,
      json: opts.json,
      verbose: opts.verbose,
      quiet: opts.quiet,
    };

    let prNumber: number | undefined;
    if (opts.pr !== undefined) {
      // Use a strict regex rather than parseInt — the latter silently accepts trailing
      // non-digit characters ('123abc' → 123), which would mask genuine input errors.
      const trimmed = String(opts.pr).trim();
      if (!/^[1-9]\d*$/.test(trimmed)) {
        console.error(`--pr must be a positive integer (got: ${opts.pr})`);
        process.exit(EXIT_CODES.GENERAL_ERROR);
      }
      prNumber = Number.parseInt(trimmed, 10);
    }

    try {
      const result = await runStandingPRPublish(options, prNumber);
      if (opts.json && result) {
        console.log(JSON.stringify(result, null, 2));
      }
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(EXIT_CODES.GENERAL_ERROR);
    }
  });

  sharedOptions(
    cmd
      .command('merge')
      .description('Merge the open standing release PR, optionally publishing immediately')
      .option('--publish', 'Publish packages immediately after merging', false),
  ).action(async (opts) => {
    const options: StandingPROptions = {
      config: opts.config,
      projectDir: opts.projectDir,
      npmAuth: opts.npmAuth,
      json: opts.json,
      verbose: opts.verbose,
      quiet: opts.quiet,
    };

    try {
      const result = await runStandingPRMerge(options, { publish: opts.publish });
      if (opts.json && result) {
        console.log(JSON.stringify(result, null, 2));
      }
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(EXIT_CODES.GENERAL_ERROR);
    }
  });

  return cmd;
}
