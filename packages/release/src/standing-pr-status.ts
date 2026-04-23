import { warn } from '@releasekit/core';
import type { createOctokit } from './preview-github.js';

type OctokitInstance = ReturnType<typeof createOctokit>;

const STATUS_CONTEXT = 'releasekit/standing-pr';

export type CommitStatusState = 'success' | 'pending' | 'failure' | 'error';

export async function postStandingPRStatus(
  octokit: OctokitInstance,
  owner: string,
  repo: string,
  sha: string,
  state: CommitStatusState,
  description: string,
): Promise<void> {
  await octokit.rest.repos.createCommitStatus({
    owner,
    repo,
    sha,
    state,
    description,
    context: STATUS_CONTEXT,
  });
}

export async function postStandingPRStatusSafe(
  octokit: OctokitInstance,
  owner: string,
  repo: string,
  sha: string,
  state: CommitStatusState,
  description: string,
): Promise<void> {
  try {
    await postStandingPRStatus(octokit, owner, repo, sha, state, description);
  } catch (err) {
    warn(`Failed to post commit status: ${err instanceof Error ? err.message : String(err)}`);
  }
}
