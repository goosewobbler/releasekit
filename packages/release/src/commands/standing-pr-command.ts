import { exitCodeForError } from '@releasekit/core';
import { publishDidChange } from '@releasekit/publish';
import { Command } from 'commander';
import type { StandingPROptions } from '../standing-pr/standing-pr.js';
import {
  resolveStandingRelease,
  runStandingPRMerge,
  runStandingPRPublish,
  runStandingPRUpdate,
} from '../standing-pr/standing-pr.js';
import { emitError, emitResult, failInput } from './emitResult.js';
import { enterProjectDir } from './project-dir.js';

export function createStandingPRCommand(): Command {
  const cmd = new Command('standing-pr').description(
    'Manage the standing release PR (create/update or publish on merge)',
  );

  const sharedOptions = (c: Command): Command =>
    c
      .option('-c, --config <path>', 'Path to config file')
      .option('--project-dir <path>', 'Project directory to run commands in', process.cwd())
      .hook('preAction', enterProjectDir)
      .option('--npm-auth <method>', 'NPM auth method (auto|oidc|token)', 'auto')
      .option('-j, --json', 'Output results as JSON', false)
      .option('--output <path>', 'Write the JSON result to a file instead of stdout')
      .option('-v, --verbose', 'Verbose logging', false)
      .option('-q, --quiet', 'Suppress non-error output', false);

  sharedOptions(
    cmd
      .command('update')
      .description('Calculate versions, commit to release branch, and create/update the standing PR')
      .option('-t, --target <packages>', 'Ad-hoc override: release only these packages (comma-separated)')
      .option(
        '--include-prerequisites',
        'With --target, also release the changed internal dependencies (and group members) of the targets',
        false,
      )
      .option(
        '--reconcile',
        'Bypass the skip-pattern guard so a post-release reconcile run still updates the standing PR (HEAD is a release commit at that point), and analyse the latest origin/<base> rather than the checkout',
        false,
      )
      .option(
        '--ack',
        'Show an in-progress banner on the standing PR while a label edit, body edit or dispatched run updates it',
        false,
      ),
  ).action(async (opts) => {
    const options: StandingPROptions = {
      config: opts.config,
      projectDir: opts.projectDir,
      npmAuth: opts.npmAuth,
      json: opts.json,
      verbose: opts.verbose,
      quiet: opts.quiet,
      reconcile: opts.reconcile,
      ack: opts.ack,
      target: opts.target,
      includePrerequisites: opts.includePrerequisites,
    };

    try {
      const result = await runStandingPRUpdate(options);
      emitResult(result, { json: opts.json, output: opts.output, changed: result.action !== 'noop' });
    } catch (err) {
      emitError(err, { json: opts.json, output: opts.output });
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(exitCodeForError(err));
    }
  });

  sharedOptions(
    cmd
      .command('publish')
      .description('Publish packages from a merged standing release PR (reads manifest from PR comment)')
      .option(
        '--pr <number>',
        'PR number of the merged standing release PR. When omitted, falls back to the pull_request event payload; on a push, to the merged standing PR still waiting for its tags (none: nothing to publish); otherwise to the most recently merged standing PR via the GitHub API',
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

    const prNumber = parsePrOption(opts);

    try {
      const result = await runStandingPRPublish(options, prNumber);
      // The manifest is on main whether or not anything published, so `changed` comes from the publish output.
      emitResult(result, { json: opts.json, output: opts.output, changed: publishDidChange(result?.publishOutput) });
    } catch (err) {
      emitError(err, { json: opts.json, output: opts.output });
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(exitCodeForError(err));
    }
  });

  sharedOptions(
    cmd
      .command('resolve')
      .description(
        'Print the merged standing PR a publish would take and its merge commit, which the publish must run from',
      )
      .option(
        '--pr <number>',
        'PR number of the merged standing release PR. When omitted, the merged standing PR still waiting for its tags (none: null)',
      ),
  ).action(async (opts) => {
    const options: StandingPROptions = {
      config: opts.config,
      projectDir: opts.projectDir,
      json: opts.json,
      verbose: opts.verbose,
      quiet: opts.quiet,
    };
    const prNumber = parsePrOption(opts);

    try {
      const result = await resolveStandingRelease(options, prNumber);
      emitResult(result, { json: opts.json, output: opts.output, changed: false });
    } catch (err) {
      emitError(err, { json: opts.json, output: opts.output });
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(exitCodeForError(err));
    }
  });

  sharedOptions(cmd.command('merge').description('Merge the open standing release PR')).action(async (opts) => {
    const options: StandingPROptions = {
      config: opts.config,
      projectDir: opts.projectDir,
      npmAuth: opts.npmAuth,
      json: opts.json,
      verbose: opts.verbose,
      quiet: opts.quiet,
    };

    try {
      const result = await runStandingPRMerge(options);
      emitResult(result, { json: opts.json, output: opts.output, changed: result != null });
    } catch (err) {
      emitError(err, { json: opts.json, output: opts.output });
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(exitCodeForError(err));
    }
  });

  return cmd;
}

function parsePrOption(opts: { pr?: unknown; json?: boolean; output?: string }): number | undefined {
  if (opts.pr === undefined) {
    return undefined;
  }
  // Not parseInt, which silently accepts trailing junk ('123abc' → 123).
  const trimmed = String(opts.pr).trim();
  if (!/^[1-9]\d*$/.test(trimmed)) {
    failInput(`--pr must be a positive integer (got: ${opts.pr})`, { json: opts.json, output: opts.output });
  }
  return Number.parseInt(trimmed, 10);
}
