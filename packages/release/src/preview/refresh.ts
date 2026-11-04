import { loadCIConfig } from '@releasekit/config';
import { info, warn } from '@releasekit/core';
import { isBotComment } from '@releasekit/forge';
import { getGitHubContext } from '../git.js';
import { forgeFor, MARKER } from '../github.js';
import { runStandingPRUpdate } from '../standing-pr/standing-pr.js';

export interface RefreshAfterReleaseOptions {
  config?: string;
  projectDir: string;
}

const MAX_PREVIEWS_CHECKED = 50;

const MAX_COMMENT_LENGTH = 65_536;

const STALE_MARKER = '<!-- releasekit-preview-stale -->';
const STALE_NOTICE =
  "> **Stale:** a release has moved the base branch since this preview was posted. It updates on this PR's next push.";

/**
 * A release that bypasses the standing PR leaves its manifest on the old baseline, and the release commit suppresses
 * the push-triggered update, so reconcile it here. A reconcile failure fails the job: a stale standing PR can hold
 * already-published versions. It pushes the release branch, so it needs a workflow-triggering credential - hence a CLI
 * step rather than the orchestrator. Marking feeder previews stale is cosmetic and never fatal.
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

  await markFeederPreviewsStale(options);
}

/**
 * Never throws, so the orchestrator can run it in-process after any successful publish. Forge-only (no git push), so
 * a `pull-requests: write` token suffices.
 */
export async function markFeederPreviewsStale(options: RefreshAfterReleaseOptions): Promise<void> {
  try {
    const ciConfig = loadCIConfig({ cwd: options.projectDir, configPath: options.config });
    const prPreview = ciConfig?.prPreview;
    if (!prPreview?.enabled || !prPreview.markStaleAfterRelease) {
      return;
    }
    const standingBranch = ciConfig?.standingPr?.branch ?? 'release/next';

    const context = getGitHubContext();
    if (!context?.token) {
      warn('Cannot mark feeder-PR previews stale: no GitHub token in the environment.');
      return;
    }

    const forge = forgeFor(context);
    // Not the job's event: in a standing-PR publish, that's the standing PR's.
    const open = await forge.listOpenPullRequests();
    const releasedBranch = resolveReleasedBranch();

    let checked = 0;
    let marked = 0;
    for (const pr of open) {
      if (pr.headRef === standingBranch) {
        continue; // the standing PR's manifest is authoritative, never previewed
      }
      if (releasedBranch && pr.baseRef !== releasedBranch) {
        continue;
      }
      const comment = await forge.findComment(pr.number, MARKER);
      if (!comment || !isBotComment(comment)) {
        continue;
      }
      // Already-stale previews count too, or a sweep over mostly stale PRs would probe every open PR.
      if (++checked > MAX_PREVIEWS_CHECKED) {
        warn(
          `More than ${MAX_PREVIEWS_CHECKED} open PRs have a preview; checked the ${MAX_PREVIEWS_CHECKED} most recently updated and skipped the rest.`,
        );
        break;
      }
      if (isMarkedStale(comment.body)) {
        continue;
      }
      // Straight after the read, so a preview re-posted in the meantime isn't overwritten with the old one.
      try {
        await forge.updateComment(comment.id, markStale(comment.body));
        marked++;
      } catch (err) {
        // One PR's failure must not abort the sweep or fail the release.
        warn(
          `Could not mark the preview on PR #${pr.number} stale: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    info(`Marked ${marked} feeder-PR preview(s) stale.`);
  } catch (err) {
    warn(`Marking feeder-PR previews stale failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** A PR event's base branch, else the pushed or dispatched branch. */
function resolveReleasedBranch(): string | undefined {
  if (process.env.GITHUB_BASE_REF) {
    return process.env.GITHUB_BASE_REF;
  }
  const ref = process.env.GITHUB_REF;
  return ref?.startsWith('refs/heads/') ? ref.slice('refs/heads/'.length) : undefined;
}

function isMarkedStale(body: string): boolean {
  return body.startsWith(`${MARKER}\n\n${STALE_MARKER}`);
}

function markStale(body: string): string {
  const header = `${MARKER}\n\n${STALE_MARKER}\n${STALE_NOTICE}`;
  const marked = `${header}${body.slice(MARKER.length)}`;
  // The preview is stale anyway, so drop it rather than fail GitHub's comment length limit.
  return marked.length > MAX_COMMENT_LENGTH ? header : marked;
}
