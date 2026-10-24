import { loadCIConfig } from '@releasekit/config';
import { info, warn } from '@releasekit/core';
import { type ForgeComment, isBotComment } from '@releasekit/forge';
import { getGitHubContext } from '../git.js';
import { forgeFor, MARKER } from '../github.js';
import { runStandingPRUpdate } from '../standing-pr/standing-pr.js';

export interface RefreshAfterReleaseOptions {
  config?: string;
  projectDir: string;
}

const MAX_FEEDER_PR_REFRESH = 50;

const STALE_MARKER = '<!-- releasekit-preview-stale -->';
const STALE_NOTICE =
  "> **Stale:** a release has moved the base branch since this preview was posted. It updates on this PR's next push.";

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
      warn('Cannot mark feeder-PR previews stale: no GitHub token in the environment.');
      return;
    }

    const forge = forgeFor(context);
    // Not the job's event: in a standing-PR publish, that's the standing PR's.
    const open = await forge.listOpenPullRequests();

    const eligible: Array<{ number: number; comment: ForgeComment }> = [];
    for (const pr of open) {
      if (pr.draft) {
        continue; // drafts don't carry previews
      }
      if (pr.headRef === branch) {
        continue; // the standing PR's manifest is authoritative, never previewed
      }
      const comment = await forge.findComment(pr.number, MARKER);
      if (!comment || !isBotComment(comment) || comment.body.includes(STALE_MARKER)) {
        continue;
      }
      eligible.push({ number: pr.number, comment });
      // Open PRs come most-recently-updated first, so stop probing one past the cap (enough to know to warn).
      if (eligible.length > MAX_FEEDER_PR_REFRESH) {
        break;
      }
    }

    let toMark = eligible;
    if (eligible.length > MAX_FEEDER_PR_REFRESH) {
      warn(
        `More than ${MAX_FEEDER_PR_REFRESH} open PRs have a current preview; marking the ${MAX_FEEDER_PR_REFRESH} most recently updated stale and skipping the rest.`,
      );
      toMark = eligible.slice(0, MAX_FEEDER_PR_REFRESH);
    }

    if (toMark.length === 0) {
      info('No open feeder PRs with a current preview to mark stale.');
      return;
    }

    // Marked, not recomputed: this job's checkout doesn't have the PRs' trees.
    info(`Marking previews stale on ${toMark.length} open PR(s)...`);
    for (const { number, comment } of toMark) {
      try {
        await forge.updateComment(comment.id, markStale(comment.body));
      } catch (err) {
        // One PR's failure must not abort the sweep or fail the release.
        warn(`Could not mark the preview on PR #${number} stale: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  } catch (err) {
    warn(`Feeder-PR preview refresh failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function markStale(body: string): string {
  const end = body.indexOf(MARKER) + MARKER.length;
  return `${body.slice(0, end)}\n\n${STALE_MARKER}\n${STALE_NOTICE}${body.slice(end)}`;
}
