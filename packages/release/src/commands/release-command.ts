import { EXIT_CODES, exitCodeForError } from '@releasekit/core';
import { Command, Option } from 'commander';
import { publishFromDraft, runReleaseDraft } from '../draft/draft.js';
import { runRelease } from '../release.js';
import type { ReleaseOptions } from '../types.js';
import { emitError, emitResult } from './emitResult.js';

export function createReleaseCommand(): Command {
  return new Command('release')
    .description('Run the full release pipeline')
    .option('-c, --config <path>', 'Path to config file')
    .option('-d, --dry-run', 'Preview all steps without side effects', false)
    .option('-b, --bump <type>', 'Force bump type (patch|minor|major|prerelease)')
    .option('-p, --prerelease [identifier]', 'Create prerelease version')
    .option('--stable', 'Graduate prerelease packages to stable without bumping', false)
    .option(
      '--allow-first-bump',
      'Acknowledge applying a bump on a first release with an already-stable manifest (silences the overshoot warning)',
      false,
    )
    .option('-s, --sync', 'Use synchronized versioning across all packages', false)
    .option('-t, --target <packages>', 'Target specific packages (comma-separated)')
    .option(
      '--include-prerequisites',
      'Also release the changed internal dependencies of --target packages (and the rest of their groups)',
      false,
    )
    .option('--scope <name>', 'Resolve scope name to target packages from ci.scopeLabels config')
    .option('--branch <name>', 'Override the git branch used for push')
    .addOption(new Option('--npm-auth <method>', 'NPM auth method').choices(['auto', 'oidc', 'token']).default('auto'))
    .option(
      '--draft',
      'Manual mode: compute the release and open a tracking issue with editable notes for review, instead of publishing (#319)',
      false,
    )
    .option(
      '--from-draft <number>',
      'Manual mode: publish from a reviewed draft tracking issue (applies its edited notes), then close it',
    )
    .option('--skip-notes', 'Skip changelog generation', false)
    .option('--skip-publish', 'Skip registry publishing and git operations', false)
    .option('--skip-git', 'Skip git commit/tag/push', false)
    .option('--skip-github-release', 'Skip GitHub release creation', false)
    .option('--skip-verification', 'Skip post-publish verification', false)
    .option('-j, --json', 'Output results as JSON', false)
    .option('--output <path>', 'Write the JSON result to a file instead of stdout')
    .option('-v, --verbose', 'Verbose logging', false)
    .option('-q, --quiet', 'Suppress non-error output', false)
    .option('--project-dir <path>', 'Project directory', process.cwd())
    .action(async (opts) => {
      if (opts.stable && opts.prerelease) {
        console.error('Error: Cannot use both --stable and --prerelease at the same time');
        process.exit(EXIT_CODES.INPUT_ERROR);
      }

      if (opts.draft && opts.fromDraft !== undefined) {
        console.error('Error: Cannot use both --draft and --from-draft at the same time');
        process.exit(EXIT_CODES.INPUT_ERROR);
      }

      let fromDraftNumber: number | undefined;
      if (opts.fromDraft !== undefined) {
        fromDraftNumber = Number(opts.fromDraft);
        if (!Number.isInteger(fromDraftNumber) || fromDraftNumber <= 0) {
          console.error(`Error: --from-draft expects a positive issue number, got "${opts.fromDraft}"`);
          process.exit(EXIT_CODES.INPUT_ERROR);
        }
      }

      const options: ReleaseOptions = {
        config: opts.config,
        dryRun: opts.dryRun,
        bump: opts.bump,
        prerelease: opts.prerelease,
        stable: opts.stable,
        allowFirstBump: opts.allowFirstBump,
        sync: opts.sync,
        target: opts.target,
        includePrerequisites: opts.includePrerequisites,
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
        const result =
          fromDraftNumber !== undefined
            ? await publishFromDraft(fromDraftNumber, options)
            : opts.draft
              ? await runReleaseDraft(options)
              : await runRelease(options);

        // A dry run plans but never mutates state, so it is never "changed"; a real run changed
        // state iff it produced version updates.
        const changed = !opts.dryRun && Boolean(result?.versionOutput?.updates?.length);
        emitResult(result, { json: options.json, output: opts.output, changed });

        if (!result) {
          process.exit(0);
        }
      } catch (error) {
        emitError(error, { json: opts.json, output: opts.output });
        console.error(error instanceof Error ? error.message : String(error));
        process.exit(exitCodeForError(error));
      }
    });
}
