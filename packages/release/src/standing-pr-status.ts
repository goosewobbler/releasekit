import type { createOctokit } from './preview-github.js';

type OctokitInstance = ReturnType<typeof createOctokit>;

export async function postStandingPRStatus(
  octokit: OctokitInstance,
  owner: string,
  repo: string,
  sha: string,
  state: 'success' | 'pending' | 'failure',
  description: string,
): Promise<void> {
  await octokit.rest.repos.createCommitStatus({
    owner,
    repo,
    sha,
    state,
    context: 'releasekit/standing-pr',
    description,
  });
}
