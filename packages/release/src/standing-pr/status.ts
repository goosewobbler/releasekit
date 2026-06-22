import { warn } from '@releasekit/core';
import type { CommitStatusState, Forge } from '@releasekit/forge';

const STATUS_CONTEXT = 'releasekit/standing-pr';

export type { CommitStatusState };

export async function postStandingPRStatus(
  forge: Forge,
  sha: string,
  state: CommitStatusState,
  description: string,
): Promise<void> {
  await forge.setCommitStatus({ sha, state, description, context: STATUS_CONTEXT });
}

export async function postStandingPRStatusSafe(
  forge: Forge,
  sha: string,
  state: CommitStatusState,
  description: string,
): Promise<void> {
  try {
    await postStandingPRStatus(forge, sha, state, description);
  } catch (err) {
    warn(`Failed to post commit status: ${err instanceof Error ? err.message : String(err)}`);
  }
}
