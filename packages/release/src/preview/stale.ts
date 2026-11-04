import { type CIConfig, loadCIConfig } from '@releasekit/config';
import { info, warn } from '@releasekit/core';
import { forgeErrorStatus, isBotComment } from '@releasekit/forge';
import type { PublishCliOptions, PublishOutput } from '@releasekit/publish';
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
 * Never throws, so a publish path can run it in-process without a guard. Forge-only, so a `pull-requests: write`
 * token suffices.
 */
export async function markFeederPreviewsStale(options: MarkPreviewsStaleOptions): Promise<void> {
  if (!marksPreviewsStale(options.ciConfig)) {
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
        // Straight after the read, since GitHub has no conditional edit: a preview re-posted in between is overwritten.
        await forge.updateComment(comment.id, markStale(comment.body));
        marked++;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        // A refusal or rate limit hits every PR, so stop rather than repeat it; other failures are this PR's alone.
        const status = forgeErrorStatus(err);
        if (status === 403 || status === 429) {
          const rateLimited = status === 429 || /rate limit/i.test(message);
          const hint = rateLimited ? '' : ' The release job needs `pull-requests: write`.';
          warn(`Stopped marking feeder-PR previews stale: GitHub refused PR #${pr.number} (${message}).${hint}`);
          break;
        }
        warn(`Could not mark the preview on PR #${pr.number} stale: ${message}`);
      }
    }
    info(`Marked ${marked} feeder-PR preview(s) stale.`);
  } catch (err) {
    warn(`Marking feeder-PR previews stale failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export function marksPreviewsStale(ciConfig: CIConfig | undefined): boolean {
  return Boolean(ciConfig?.prPreview?.enabled && ciConfig.prPreview.markStaleAfterRelease);
}

/** A publish has moved the branch once it pushed it, even if a later stage failed. */
export async function markPreviewsStaleIfPushed(
  output: PublishOutput | undefined,
  ciConfig: CIConfig | undefined,
): Promise<void> {
  const branch = output?.git.branch;
  if (branch) {
    await markFeederPreviewsStale({ ciConfig, branch });
  }
}

export async function markPreviewsStaleAfterPublish(output: PublishOutput, options: PublishCliOptions): Promise<void> {
  if (!options.dryRun) {
    await markPreviewsStaleIfPushed(output, loadCIConfig({ configPath: options.config }));
  }
}

function isMarkedStale(body: string): boolean {
  // Editing a comment in GitHub's web UI saves it with CRLF line endings.
  return body.replace(/\r\n/g, '\n').startsWith(`${MARKER}\n\n${STALE_MARKER}\n`);
}

function markStale(body: string): string {
  const header = `${MARKER}\n\n${STALE_MARKER}\n${STALE_NOTICE}`;
  const marked = `${header}${body.slice(MARKER.length)}`;
  // The preview is stale anyway, so drop it rather than fail GitHub's comment length limit.
  return marked.length > MAX_COMMENT_LENGTH ? header : marked;
}
