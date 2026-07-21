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

/** Hard cap on feeder-PR previews refreshed in one run — keeps the cost bounded on busy repos. */
const MAX_FEEDER_PR_REFRESH = 50;

/**
 * Post-release cleanup of state that goes stale when a release moves `main`. Two halves with
 * deliberately different failure semantics:
 *
 * 1. **Standing-PR reconcile (release-critical).** A direct/manual/immediate release that bypasses
 *    the standing PR leaves its manifest computed against the old baseline — and the `chore: release `
 *    commit suppresses the normal push-triggered update. Reusing the existing `--reconcile` path
 *    re-syncs it. A failure here propagates: a stale standing PR can hold already-published versions.
 *    This half pushes the release branch, so it needs a workflow-triggering credential — hence it
 *    lives in this CLI step rather than being driven from the orchestrator.
 * 2. **Feeder-PR preview refresh (cosmetic, opt-in).** Delegated to {@link refreshFeederPreviews},
 *    which the release orchestrator also calls in-process after a successful publish (so a consumer
 *    no longer needs this CLI step purely for the cosmetic half).
 */
export async function runRefreshAfterRelease(options: RefreshAfterReleaseOptions): Promise<void> {
  const ciConfig = loadCIConfig({ cwd: options.projectDir, configPath: options.config });
  const strategy = ciConfig?.releaseStrategy ?? 'direct';

  // — Half 1: reconcile the standing PR (RELEASE-CRITICAL) —
  // Only standing-pr mode has a standing PR. No try/catch: a failure must fail the job rather than
  // silently leave the standing PR stating versions that may already be published.
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

  // — Half 2: refresh feeder-PR previews (COSMETIC, opt-in, never fatal) —
  await refreshFeederPreviews(options);
}

/**
 * Replay the (idempotent) "what would release" preview comment on still-open feeder PRs after a
 * release moves `main`, so their estimate isn't frozen at the pre-release baseline. Cosmetic and
 * opt-in (`ci.prPreview.refreshAfterRelease`); a pure forge-API operation (no git push) needing only
 * a `pull-requests: write` token. Best-effort — it **never throws**, so the release orchestrator can
 * drive it in-process after any successful publish (the standing-PR publish path as well as the
 * direct/scoped path) without risking the release.
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
      if (pr.draft) continue; // drafts don't carry previews
      if (pr.headRef === branch) continue; // the standing PR's manifest is authoritative, never previewed
      // Only refresh PRs that already have a preview — never manufacture one on a PR that opted out.
      if (!(await forge.findComment(pr.number, MARKER))) continue;
      eligible.push(pr);
      // Open PRs come back most-recently-updated first, so the first MAX_FEEDER_PR_REFRESH are exactly
      // the set we refresh. Stop probing once one past the cap is in hand — bounds the per-PR
      // findComment calls instead of fetching comments for every open PR on a busy repo.
      if (eligible.length > MAX_FEEDER_PR_REFRESH) break;
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
          // Supply the PR's base SHA so standing-pr advisory scoping matches the event-driven path —
          // there's no pull_request event payload on this push/dispatch-triggered run.
          baseSha: pr.baseSha,
        });
      } catch (err) {
        // One PR's failure must not abort the sweep or fail the release.
        warn(`Could not refresh preview on PR #${pr.number}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  } catch (err) {
    // Best-effort — config/enumeration/forge errors only warn, never fail the release.
    warn(`Feeder-PR preview refresh failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}
