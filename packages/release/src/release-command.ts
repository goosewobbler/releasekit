import { EXIT_CODES } from '@releasekit/core';
import { Command, Option } from 'commander';
import { runRelease } from './release.js';
import type { ReleaseOptions } from './types.js';

export function createReleaseCommand(): Command {
  return new Command('release')
    .description('Run the full release pipeline')
    .option('-c, --config <path>', 'Path to config file')
    .option('-d, --dry-run', 'Preview all steps without side effects', false)
    .option('-b, --bump <type>', 'Force bump type (patch|minor|major)')
    .option('-p, --prerelease [identifier]', 'Create prerelease version')
    .option('--stable', 'Graduate prerelease packages to stable without bumping', false)
    .option('-s, --sync', 'Use synchronized versioning across all packages', false)
    .option('-t, --target <packages>', 'Target specific packages (comma-separated)')
    .option('--scope <name>', 'Resolve scope name to target packages from ci.scopeLabels config')
    .option('--branch <name>', 'Override the git branch used for push')
    .addOption(new Option('--npm-auth <method>', 'NPM auth method').choices(['auto', 'oidc', 'token']).default('auto'))
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
      if (opts.stable && opts.prerelease) {
        console.error('Error: Cannot use both --stable and --prerelease at the same time');
        process.exit(EXIT_CODES.INPUT_ERROR);
      }

      const options: ReleaseOptions = {
        config: opts.config,
        dryRun: opts.dryRun,
        bump: opts.bump,
        prerelease: opts.prerelease,
        stable: opts.stable,
        sync: opts.sync,
        target: opts.target,
        scope: opts.scope,
        branch: opts.branch,
        npmAuth: opts.npmAuth,
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
          process.exit(0);
        }
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exit(EXIT_CODES.GENERAL_ERROR);
      }
    });
}
