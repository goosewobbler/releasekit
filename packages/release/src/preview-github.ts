import { Octokit } from '@octokit/rest';
import { MARKER } from './preview-format.js';

export function createOctokit(token: string): Octokit {
  return new Octokit({ auth: token });
}

/**
 * Find an existing release preview comment on the PR by looking for the HTML marker.
 */
export async function findPreviewComment(
  octokit: Octokit,
  owner: string,
  repo: string,
  prNumber: number,
): Promise<number | null> {
  const iterator = octokit.paginate.iterator(octokit.rest.issues.listComments, {
    owner,
    repo,
    issue_number: prNumber,
    per_page: 100,
  });

  for await (const response of iterator) {
    for (const comment of response.data) {
      if (comment.body?.startsWith(MARKER)) {
        return comment.id;
      }
    }
  }

  return null;
}

/**
 * Fetch the label names on a PR.
 */
export async function fetchPRLabels(
  octokit: Octokit,
  owner: string,
  repo: string,
  prNumber: number,
): Promise<string[]> {
  const { data } = await octokit.rest.issues.get({
    owner,
    repo,
    issue_number: prNumber,
  });
  return (data.labels ?? []).map((label) => (typeof label === 'string' ? label : (label.name ?? '')));
}

/**
 * Create or update the release preview comment on a PR.
 */
export async function postOrUpdateComment(
  octokit: Octokit,
  owner: string,
  repo: string,
  prNumber: number,
  body: string,
): Promise<void> {
  const existingId = await findPreviewComment(octokit, owner, repo, prNumber);

  if (existingId) {
    await octokit.rest.issues.updateComment({
      owner,
      repo,
      comment_id: existingId,
      body,
    });
  } else {
    await octokit.rest.issues.createComment({
      owner,
      repo,
      issue_number: prNumber,
      body,
    });
  }
}
