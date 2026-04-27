import { execFileSync } from 'node:child_process';
import { Octokit } from '@octokit/rest';
import type { CIConfig } from '@releasekit/config';
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
 * Uses git to enumerate commits in the window `<lastTag>..HEAD`, then looks up each
 * commit's associated PR via the GitHub API. Falls back to the last 50 commits when
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
    const output = execFileSync('git', ['log', '--format=%H', range], { cwd: projectDir, encoding: 'utf8' }).trim();
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
 * Accepts an optional `marker` to find comments produced by other surfaces (e.g. the
 * gate's notify path uses a distinct marker so it doesn't collide with the preview).
 */
export async function findPreviewComment(
  octokit: Octokit,
  owner: string,
  repo: string,
  prNumber: number,
  marker: string = MARKER,
): Promise<number | null> {
  const iterator = octokit.paginate.iterator(octokit.rest.issues.listComments, {
    owner,
    repo,
    issue_number: prNumber,
    per_page: 100,
  });

  for await (const response of iterator) {
    for (const comment of response.data) {
      if (comment.body?.startsWith(marker)) {
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
 * Find the open standing release PR for the configured branch.
 */
export async function findStandingPR(
  octokit: Octokit,
  owner: string,
  repo: string,
  ciConfig: CIConfig | undefined,
): Promise<{ number: number; url: string } | null> {
  const branch = ciConfig?.standingPr?.branch ?? 'release/next';
  try {
    const { data: prs } = await octokit.rest.pulls.list({
      owner,
      repo,
      head: `${owner}:${branch}`,
      state: 'open',
      per_page: 1,
    });
    const pr = prs[0];
    return pr ? { number: pr.number, url: pr.html_url } : null;
  } catch {
    return null;
  }
}

/**
 * Create or update a marker-keyed comment on a PR. The body is expected to start with
 * the marker so subsequent calls find and update the same comment.
 *
 * Defaults to the release preview marker for backward compatibility. Pass an alternative
 * marker (e.g. the gate notify marker) to manage distinct comments on the same PR.
 */
export async function postOrUpdateComment(
  octokit: Octokit,
  owner: string,
  repo: string,
  prNumber: number,
  body: string,
  marker: string = MARKER,
): Promise<void> {
  const existingId = await findPreviewComment(octokit, owner, repo, prNumber, marker);

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
