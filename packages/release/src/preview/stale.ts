import { loadCIConfig } from '@releasekit/config';
import { info, warn } from '@releasekit/core';
import { isBotComment } from '@releasekit/forge';
import { createGitCli } from '@releasekit/git';
import { getGitHubContext } from '../git.js';
import { forgeFor, MARKER } from '../github.js';

export interface MarkPreviewsStaleOptions {
  config?: string;
  projectDir: string;
  /** The branch the release moved, to HEAD. */
  branch: string;
}

const MAX_PRS_CHECKED = 50;

const MAX_COMMENT_LENGTH = 65_536;

const STALE_NOTICE =
  "> **Stale:** a release has moved the base branch since this preview was posted. It updates on this PR's next push or label change.";

const staleMarkerLine = (releaseSha: string): string => `<!-- releasekit-preview-stale:${releaseSha} -->`;

/** Follows the preview marker: the stale marker line, then the notice line. */
const STALE_HEADER = new RegExp(`^\\n\\n${staleMarkerLine('([0-9a-f]+)')}\\n[^\\n]*`);

/**
 * Never throws, so the orchestrator can run it in-process after any successful publish. Forge-only (no git push), so
 * a `pull-requests: write` token suffices.
 */
export async function markFeederPreviewsStale(options: MarkPreviewsStaleOptions): Promise<void> {
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

    const releaseSha = await createGitCli().headSha(options.projectDir);
    const forge = forgeFor(context);
    // Not the job's event: in a standing-PR publish, that's the standing PR's. The standing PR is never previewed.
    const feeders = (await forge.listOpenPullRequests()).filter(
      (pr) => pr.baseRef === options.branch && pr.headRef !== standingBranch,
    );
    if (feeders.length > MAX_PRS_CHECKED) {
      warn(
        `More than ${MAX_PRS_CHECKED} open PRs target ${options.branch}; checking the ${MAX_PRS_CHECKED} most recently updated and skipping the rest.`,
      );
    }

    let marked = 0;
    for (const pr of feeders.slice(0, MAX_PRS_CHECKED)) {
      try {
        const comment = await forge.findComment(pr.number, MARKER);
        if (!comment || !isBotComment(comment) || staleReleaseSha(comment.body) === releaseSha) {
          continue;
        }
        // Straight after the read, so a preview re-posted in the meantime isn't overwritten with the old one.
        await forge.updateComment(comment.id, markStale(comment.body, releaseSha));
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

/** The release commit a preview body was marked stale for. */
export function staleReleaseSha(body: string): string | undefined {
  return body.startsWith(MARKER) ? STALE_HEADER.exec(body.slice(MARKER.length))?.[1] : undefined;
}

/** Replaces any earlier stale mark. */
export function markStale(body: string, releaseSha: string): string {
  const header = `${MARKER}\n\n${staleMarkerLine(releaseSha)}\n${STALE_NOTICE}`;
  const marked = `${header}${body.slice(MARKER.length).replace(STALE_HEADER, '')}`;
  // The preview is stale anyway, so drop it rather than fail GitHub's comment length limit.
  return marked.length > MAX_COMMENT_LENGTH ? header : marked;
}
