import { loadCIConfig } from '@releasekit/config';
import { info, warn } from '@releasekit/core';
import type { OpenPullRequest } from '@releasekit/forge';
import { getGitHubContext } from '../git.js';
import { forgeFor, MARKER } from '../github.js';
import { runStandingPRUpdate } from '../standing-pr/standing-pr.js';
import { runPreview } from './preview.js';

export interface RefreshAfterReleaseOptions {
  config?: string;
  projectDir: string;
}

const MAX_FEEDER_PR_REFRESH = 50;

/**
 * A release that bypasses the standing PR leaves its manifest on the old baseline, and the release commit suppresses
 * the push-triggered update, so reconcile it here. A reconcile failure fails the job: a stale standing PR can hold
 * already-published versions. It pushes the release branch, so it needs a workflow-triggering credential - hence a CLI
 * step rather than the orchestrator. The feeder-preview refresh is cosmetic and never fatal.
 */
export async function runRefreshAfterRelease(options: RefreshAfterReleaseOptions): Promise<void> {
  const ciConfig = loadCIConfig({ cwd: options.projectDir, configPath: options.config });
  const strategy = ciConfig?.releaseStrategy ?? 'direct';

  if (strategy === 'standing-pr') {
    info('Reconciling the standing PR after release...');
    await runStandingPRUpdate({
      config: options.config,
      projectDir: options.projectDir,
      reconcile: true,
      verbose: false,
      quiet: false,
      json: false,
    });
  }

  await refreshFeederPreviews(options);
}

/**
 * Never throws, so the orchestrator can run it in-process after any successful publish. Forge-only (no git push), so
 * a `pull-requests: write` token suffices.
 */
export async function refreshFeederPreviews(options: RefreshAfterReleaseOptions): Promise<void> {
  try {
    const ciConfig = loadCIConfig({ cwd: options.projectDir, configPath: options.config });
    const prPreview = ciConfig?.prPreview;
    if (!prPreview?.enabled || !prPreview.refreshAfterRelease) {
      return;
    }
    const branch = ciConfig?.standingPr?.branch ?? 'release/next';

    const context = getGitHubContext();
    if (!context?.token) {
      warn('Cannot refresh feeder-PR previews: no GitHub token in the environment.');
      return;
    }

    const forge = forgeFor(context);
    const repo = `${context.owner}/${context.repo}`;
    const open = await forge.listOpenPullRequests();

    const eligible: OpenPullRequest[] = [];
    for (const pr of open) {
      if (pr.draft) {
        continue; // drafts don't carry previews
      }
      if (pr.headRef === branch) {
        continue; // the standing PR's manifest is authoritative, never previewed
      }
      // Only PRs that already have a preview: never manufacture one on a PR that opted out.
      if (!(await forge.findComment(pr.number, MARKER))) {
        continue;
      }
      eligible.push(pr);
      // Open PRs come most-recently-updated first, so stop probing one past the cap (enough to know to warn).
      if (eligible.length > MAX_FEEDER_PR_REFRESH) {
        break;
      }
    }

    let toRefresh = eligible;
    if (eligible.length > MAX_FEEDER_PR_REFRESH) {
      warn(
        `More than ${MAX_FEEDER_PR_REFRESH} open PRs have a preview; refreshing the ${MAX_FEEDER_PR_REFRESH} most recently updated and skipping the rest.`,
      );
      toRefresh = eligible.slice(0, MAX_FEEDER_PR_REFRESH);
    }

    if (toRefresh.length === 0) {
      info('No open feeder PRs with a preview comment to refresh.');
      return;
    }

    info(`Refreshing previews on ${toRefresh.length} open PR(s)...`);
    for (const pr of toRefresh) {
      try {
        await runPreview({
          config: options.config,
          projectDir: options.projectDir,
          pr: String(pr.number),
          repo,
          dryRun: false,
          baseSha: pr.baseSha,
        });
      } catch (err) {
        // One PR's failure must not abort the sweep or fail the release.
        warn(`Could not refresh preview on PR #${pr.number}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  } catch (err) {
    warn(`Feeder-PR preview refresh failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}
