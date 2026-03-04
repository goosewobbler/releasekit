#!/usr/bin/env node
import { EXIT_CODES } from '@releasekit/core';
import { Command } from 'commander';
import { runRelease } from './release.js';
import type { ReleaseOptions } from './types.js';

const program = new Command();

program
  .name('releasekit')
  .description('Unified release pipeline: version, changelog, and publish')
  .version('0.1.0')
  .command('release', { isDefault: true })
  .description('Run the full release pipeline')
  .option('-c, --config <path>', 'Path to config file')
  .option('-d, --dry-run', 'Preview all steps without side effects', false)
  .option('-b, --bump <type>', 'Force bump type (patch|minor|major)')
  .option('-p, --prerelease [identifier]', 'Create prerelease version')
  .option('-s, --sync', 'Use synchronized versioning across all packages', false)
  .option('-t, --target <packages>', 'Target specific packages (comma-separated)')
  .option('--skip-notes', 'Skip changelog generation', false)
  .option('--skip-publish', 'Skip registry publishing and git operations', false)
  .option('--skip-git', 'Skip git commit/tag/push', false)
  .option('--skip-github-release', 'Skip GitHub release creation', false)
  .option('--skip-verification', 'Skip post-publish verification', false)
  .option('-j, --json', 'Output results as JSON', false)
  .option('-v, --verbose', 'Verbose logging', false)
  .option('-q, --quiet', 'Suppress non-error output', false)
  .option('--project-dir <path>', 'Project directory', process.cwd())
  .action(async (opts) => {
    const options: ReleaseOptions = {
      config: opts.config,
      dryRun: opts.dryRun,
      bump: opts.bump,
      prerelease: opts.prerelease,
      sync: opts.sync,
      target: opts.target,
      skipNotes: opts.skipNotes,
      skipPublish: opts.skipPublish,
      skipGit: opts.skipGit,
      skipGithubRelease: opts.skipGithubRelease,
      skipVerification: opts.skipVerification,
      json: opts.json,
      verbose: opts.verbose,
      quiet: opts.quiet,
      projectDir: opts.projectDir,
    };

    try {
      const result = await runRelease(options);

      if (options.json && result) {
        console.log(JSON.stringify(result, null, 2));
      }

      if (!result) {
        // No releasable changes — exit cleanly
        process.exit(0);
      }
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(EXIT_CODES.GENERAL_ERROR);
    }
  });

program.parse();
