import type { CIConfig } from '@releasekit/config';
import { info, warn } from '@releasekit/core';
import { isBotComment } from '@releasekit/forge';
import { getGitHubContext } from '../git.js';
import { forgeFor, MARKER } from '../github.js';

export interface MarkPreviewsStaleOptions {
  ciConfig: CIConfig | undefined;
  /** The branch the release moved. */
  branch: string;
}

const MAX_PRS_CHECKED = 50;

const MAX_COMMENT_LENGTH = 65_536;

const STALE_MARKER = '<!-- releasekit-preview-stale -->';
const STALE_NOTICE =
  "> **Stale:** a release has moved the base branch since this preview was posted. It updates on this PR's next push or label change.";

/**
 * Never throws, so the orchestrator can run it in-process after any successful publish. Forge-only (no git push), so
 * a `pull-requests: write` token suffices.
 */
export async function markFeederPreviewsStale(options: MarkPreviewsStaleOptions): Promise<void> {
  const prPreview = options.ciConfig?.prPreview;
  if (!prPreview?.enabled || !prPreview.markStaleAfterRelease) {
    return;
  }
  try {
    const context = getGitHubContext();
    if (!context?.token) {
      warn('Cannot mark feeder-PR previews stale: no GitHub token in the environment.');
      return;
    }

    const standingBranch = options.ciConfig?.standingPr?.branch ?? 'release/next';
    const forge = forgeFor(context);
    // One over the cap shows whether any were skipped, and one more allows for the standing PR.
    const open = await forge.listOpenPullRequests(options.branch, MAX_PRS_CHECKED + 2);
    const feeders = open.filter((pr) => pr.headRef !== standingBranch);
    if (feeders.length > MAX_PRS_CHECKED) {
      warn(
        `More than ${MAX_PRS_CHECKED} open PRs target ${options.branch}; checking the ${MAX_PRS_CHECKED} most recently updated and skipping the rest.`,
      );
    }

    let marked = 0;
    for (const pr of feeders.slice(0, MAX_PRS_CHECKED)) {
      try {
        const comment = await forge.findComment(pr.number, MARKER);
        if (!comment || !isBotComment(comment) || isMarkedStale(comment.body)) {
          continue;
        }
        // Straight after the read: GitHub has no conditional comment edit, so a preview re-posted in between is lost.
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

function isMarkedStale(body: string): boolean {
  return body.startsWith(`${MARKER}\n\n${STALE_MARKER}\n`);
}

function markStale(body: string): string {
  const header = `${MARKER}\n\n${STALE_MARKER}\n${STALE_NOTICE}`;
  const marked = `${header}${body.slice(MARKER.length)}`;
  // The preview is stale anyway, so drop it rather than fail GitHub's comment length limit.
  return marked.length > MAX_COMMENT_LENGTH ? header : marked;
}
