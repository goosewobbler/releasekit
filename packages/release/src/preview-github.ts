import { execFileSync } from 'node:child_process';
import { Octokit } from '@octokit/rest';
import { MARKER } from './preview-format.js';

export function createOctokit(token: string): Octokit {
  return new Octokit({ auth: token });
}

/**
 * Find merged PR(s) associated with a commit.
 * Returns the PR numbers that were merged and included this commit.
 */
export async function findMergedPRsForCommit(
  octokit: Octokit,
  owner: string,
  repo: string,
  commitSha: string,
): Promise<number[]> {
  try {
    const { data: prs } = await octokit.rest.repos.listPullRequestsAssociatedWithCommit({
      owner,
      repo,
      commit_sha: commitSha,
    });

    return prs.filter((pr) => pr.merged_at !== null).map((pr) => pr.number);
  } catch {
    return [];
  }
}

/**
 * Find all merged PRs since the last release tag.
 * Uses git to enumerate merge commits in the window `<lastTag>..HEAD`, then looks up each
 * commit's associated PR via the GitHub API. Falls back to the last 50 merge commits when
 * no release tags exist. Returns a deduped list of PR numbers.
 */
export async function findMergedPRsSinceLastRelease(
  octokit: Octokit,
  owner: string,
  repo: string,
  projectDir: string,
): Promise<number[]> {
  let range: string;
  try {
    const lastTag = execFileSync('git', ['describe', '--tags', '--abbrev=0'], {
      cwd: projectDir,
      encoding: 'utf8',
    }).trim();
    range = `${lastTag}..HEAD`;
  } catch {
    range = '-50';
  }

  let mergeShas: string[];
  try {
    const output = execFileSync('git', ['log', '--merges', '--format=%H', range], {
      cwd: projectDir,
      encoding: 'utf8',
    }).trim();
    mergeShas = output ? output.split('\n').filter(Boolean) : [];
  } catch {
    return [];
  }

  const seen = new Set<number>();
  for (const sha of mergeShas) {
    const prs = await findMergedPRsForCommit(octokit, owner, repo, sha);
    for (const n of prs) seen.add(n);
  }
  return [...seen];
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
