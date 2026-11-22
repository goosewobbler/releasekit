import { loadConfig } from '@releasekit/config';
import { EXIT_CODES, error, info, success, warn } from '@releasekit/core';
import { Command } from 'commander';
import { findReusableDraft } from '../draft/draft.js';
import { forgeFor } from '../github.js';
import { resolveLabelsContext } from './labels-command.js';
import { enterProjectDir } from './project-dir.js';

export interface MigrateOptions {
  config?: string;
  projectDir: string;
  repo?: string;
}

export function createMigrateCommand(): Command {
  return new Command('migrate')
    .description('Seed releasekit.versions.json with each package’s last release from its tags')
    .option('-c, --config <path>', 'Path to config file')
    .option('--project-dir <path>', 'Project directory to run commands in', process.cwd())
    .option('--repo <owner/repo>', 'Repository (auto-detected from GITHUB_REPOSITORY or the origin remote)')
    .hook('preAction', enterProjectDir)
    .action(async (opts) => {
      try {
        await runMigrate({ config: opts.config, projectDir: opts.projectDir, repo: opts.repo });
      } catch (err) {
        error(err instanceof Error ? err.message : String(err));
        process.exit(EXIT_CODES.GENERAL_ERROR);
      }
    });
}

/** A standing PR or release draft holds a release computed without the record, so it must land or close first. */
async function assertNoPendingRelease(options: MigrateOptions): Promise<void> {
  const releaseKitConfig = loadConfig({ cwd: options.projectDir, configPath: options.config });
  const { owner, repo, token } = await resolveLabelsContext({ repo: options.repo, projectDir: options.projectDir });
  const forge = forgeFor({ token, owner, repo });

  const standingPr = await forge.findStandingPR(releaseKitConfig.ci?.standingPr?.branch ?? 'release/next');
  if (standingPr) {
    throw new Error(`Standing PR #${standingPr.number} is open. Merge or close it, then run releasekit migrate again.`);
  }
  const draft = await findReusableDraft(forge);
  if (draft !== undefined) {
    throw new Error(
      `Release draft #${draft} hasn't been published. Publish it with \`releasekit release --from-draft ${draft}\` ` +
        'or close it, then run releasekit migrate again.',
    );
  }
}

export async function runMigrate(options: MigrateOptions): Promise<void> {
  await assertNoPendingRelease(options);

  const { migrateVersionRecord, VERSION_RECORD_FILE } = await import('@releasekit/version');
  const result = await migrateVersionRecord({ cwd: options.projectDir, configPath: options.config });

  for (const { path, name, version, tag } of result.seeded) {
    info(`Seeded ${path} (${name}) at ${version} from ${tag}`);
  }
  for (const { path, name } of result.kept) {
    info(`Kept the existing entry for ${path} (${name})`);
  }
  for (const { path, name, reason } of result.unseeded) {
    warn(`Not seeded: ${path} (${name}), ${reason}. If it has been released, add its entry by hand.`);
  }
  if (result.seeded.length > 0) {
    success(`Wrote ${VERSION_RECORD_FILE}. Commit it to finish migrating.`);
  } else {
    info(`Nothing to seed, so ${VERSION_RECORD_FILE} is unchanged.`);
  }
}
