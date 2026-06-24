import { loadCIConfig } from '@releasekit/config';
import { EXIT_CODES, error, info, success } from '@releasekit/core';
import { createGitCli } from '@releasekit/git';
import { Command } from 'commander';
import { forgeFor } from '../github.js';
import { checkLabels, deriveLabelDefinitions, syncLabels } from '../label-definitions.js';

interface LabelsCommandContext {
  owner: string;
  repo: string;
  token: string;
}

/**
 * Resolve the repo + token context for label operations. Unlike the preview context this does
 * not need a PR number, so it can run from a plain checkout or CI. Repo comes from `--repo`,
 * then `GITHUB_REPOSITORY`, then the `origin` git remote. Token comes from `GITHUB_TOKEN` then
 * `GH_TOKEN`.
 */
export async function resolveLabelsContext(opts: {
  repo?: string;
  projectDir?: string;
}): Promise<LabelsCommandContext> {
  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
  if (!token) {
    throw new Error('A GitHub token is required. Set GITHUB_TOKEN (or GH_TOKEN).');
  }

  const repoStr = opts.repo ?? process.env.GITHUB_REPOSITORY ?? (await detectRepoFromGit(opts.projectDir));
  if (!repoStr) {
    throw new Error(
      'Could not determine repository. Use --repo <owner/repo>, set GITHUB_REPOSITORY, or run inside a clone with an origin remote.',
    );
  }

  const parts = repoStr.split('/');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error(`Invalid repository format: ${repoStr}. Expected "owner/repo".`);
  }

  return { owner: parts[0], repo: parts[1], token };
}

async function detectRepoFromGit(projectDir?: string): Promise<string | undefined> {
  try {
    // remoteUrl returns null (not throws) when the origin remote is absent.
    const url = await createGitCli().remoteUrl('origin', projectDir ?? process.cwd());
    if (!url) return undefined;
    // Handle both SSH (git@github.com:owner/repo.git) and HTTPS (https://github.com/owner/repo.git).
    const match = url.match(/github\.com[:/]([^/]+)\/(.+?)(?:\.git)?$/);
    if (match?.[1] && match[2]) {
      return `${match[1]}/${match[2]}`;
    }
  } catch {
    // git missing / unexpected failure — fall through to undefined.
  }
  return undefined;
}

export function createLabelsCommand(): Command {
  const cmd = new Command('labels').description('Create and reconcile the GitHub labels ReleaseKit relies on');

  cmd
    .command('sync')
    .description('Ensure every config-implied label exists in the repo (idempotent)')
    .option('-c, --config <path>', 'Path to config file')
    .option('--project-dir <path>', 'Project directory', process.cwd())
    .option('--repo <owner/repo>', 'Repository (auto-detected from GITHUB_REPOSITORY or the origin remote)')
    .option('--check', 'Report missing/misnamed labels and exit non-zero without making changes', false)
    .action(async (opts) => {
      try {
        await runLabelsSync({
          config: opts.config,
          projectDir: opts.projectDir,
          repo: opts.repo,
          check: opts.check,
        });
      } catch (err) {
        error(err instanceof Error ? err.message : String(err));
        process.exit(EXIT_CODES.GENERAL_ERROR);
      }
    });

  return cmd;
}

export interface LabelsSyncOptions {
  config?: string;
  projectDir?: string;
  repo?: string;
  check?: boolean;
}

/**
 * Core of `releasekit labels sync`. In `--check` mode it performs no mutations and exits
 * non-zero (via the thrown error path / explicit exit) when labels are missing. Otherwise it
 * idempotently creates the missing labels.
 */
export async function runLabelsSync(options: LabelsSyncOptions): Promise<void> {
  const ciConfig = loadCIConfig({ cwd: options.projectDir, configPath: options.config });
  const definitions = deriveLabelDefinitions(ciConfig);

  const { owner, repo, token } = await resolveLabelsContext({ repo: options.repo, projectDir: options.projectDir });
  const forge = forgeFor({ token, owner, repo });

  if (options.check) {
    const { missing } = await checkLabels(forge, definitions);
    if (missing.length > 0) {
      error(`Missing ${missing.length} label(s) in ${owner}/${repo}:`);
      for (const name of missing) {
        error(`  - ${name}`);
      }
      info('Run `releasekit labels sync` to create them.');
      process.exit(EXIT_CODES.GENERAL_ERROR);
    }
    success(`All ${definitions.length} ReleaseKit label(s) present in ${owner}/${repo}`);
    return;
  }

  const { created, existing } = await syncLabels(forge, definitions);
  if (created.length > 0) {
    for (const name of created) {
      info(`Created label: ${name}`);
    }
  }
  success(
    `Synced ${definitions.length} label(s) in ${owner}/${repo} (${created.length} created, ${existing.length} already present)`,
  );
}
