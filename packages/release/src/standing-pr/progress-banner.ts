import { warn } from '@releasekit/core';
import type { Forge } from '@releasekit/forge';

const BANNER = /<!-- releasekit-processing:(\S+) -->[\s\S]*?<!-- releasekit-processing-end -->[\r\n]*/g;

function renderBanner(runId: string, runUrl: string): string {
  return [
    `<!-- releasekit-processing:${runId} -->`,
    `> 🔄 **Updating the release PR** to reflect your change… ([run details](${runUrl}))`,
    '<!-- releasekit-processing-end -->',
  ].join('\n');
}

/** The in-progress banner at the top of the standing PR's body, keyed by run ID so a run only ever clears its own. */
export class ProgressBanner {
  private posted?: { forge: Forge; prNumber: number; runId: string };
  private rewritten = false;

  async post(forge: Forge, prNumber: number): Promise<void> {
    const runId = process.env.GITHUB_RUN_ID;
    if (!runId) {
      return;
    }
    const server = process.env.GITHUB_SERVER_URL ?? 'https://github.com';
    const runUrl = `${server}/${process.env.GITHUB_REPOSITORY}/actions/runs/${runId}`;
    this.posted = { forge, prNumber, runId };
    try {
      const body = (await forge.getPullRequest(prNumber)).body.replace(BANNER, '');
      await forge.updatePullRequest(prNumber, { body: `${renderBanner(runId, runUrl)}\n\n${body}` });
    } catch (err) {
      warn(`Could not post the in-progress banner: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** The update's rewritten body has no banner, so there's nothing left to clear. */
  markRewritten(): void {
    this.rewritten = true;
  }

  async clear(): Promise<void> {
    if (!this.posted || this.rewritten) {
      return;
    }
    const { forge, prNumber, runId } = this.posted;
    try {
      const body = (await forge.getPullRequest(prNumber)).body;
      const cleared = body.replace(BANNER, (banner, id: string) => (id === runId ? '' : banner));
      if (cleared !== body) {
        await forge.updatePullRequest(prNumber, { body: cleared });
      }
    } catch (err) {
      warn(`Could not clear the in-progress banner: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
