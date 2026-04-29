import { EXIT_CODES } from '@releasekit/core';
import { Command } from 'commander';
import { runPreview } from '../preview/preview.js';

export function createPreviewCommand(): Command {
  return new Command('preview')
    .description('Post a release preview comment on the current pull request')
    .option('-c, --config <path>', 'Path to config file')
    .option('--project-dir <path>', 'Project directory', process.cwd())
    .option('--pr <number>', 'PR number (auto-detected from GitHub Actions)')
    .option('--repo <owner/repo>', 'Repository (auto-detected from GITHUB_REPOSITORY)')
    .option('-p, --prerelease [identifier]', 'Force prerelease preview (auto-detected by default)')
    .option('--stable', 'Force stable release preview (graduation from prerelease)', false)
    .option('-t, --target <packages>', 'Target specific packages (comma-separated)')
    .option(
      '-d, --dry-run',
      'Print the comment to stdout without posting (GitHub context not available in dry-run mode)',
      false,
    )
    .action(async (opts) => {
      try {
        await runPreview({
          config: opts.config,
          projectDir: opts.projectDir,
          pr: opts.pr,
          repo: opts.repo,
          prerelease: opts.prerelease,
          stable: opts.stable,
          dryRun: opts.dryRun,
          target: opts.target,
        });
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exit(EXIT_CODES.GENERAL_ERROR);
      }
    });
}
