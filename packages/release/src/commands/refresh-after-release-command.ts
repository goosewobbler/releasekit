import { EXIT_CODES } from '@releasekit/core';
import { Command } from 'commander';
import { runRefreshAfterRelease } from '../preview/refresh.js';

export function createRefreshAfterReleaseCommand(): Command {
  return new Command('refresh-after-release')
    .description('After a release, reconcile the standing PR (if any) and mark feeder-PR previews stale')
    .option('-c, --config <path>', 'Path to config file')
    .option('--project-dir <path>', 'Project directory', process.cwd())
    .action(async (opts) => {
      try {
        await runRefreshAfterRelease({ config: opts.config, projectDir: opts.projectDir });
      } catch (error) {
        // Only the release-critical reconcile throws; the feeder-preview refresh swallows its own errors.
        console.error(error instanceof Error ? error.message : String(error));
        process.exit(EXIT_CODES.GENERAL_ERROR);
      }
    });
}
