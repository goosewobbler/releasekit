import { execFileSync } from 'node:child_process';
import type { CIConfig } from '@releasekit/config';
import { createGitHubForge, type Forge } from '@releasekit/forge';

export const MARKER = '<!-- releasekit-preview -->';

/**
 * Build a {@link Forge} for the repository described by a GitHub context. Callers guard on a present
 * token before reaching the forge-backed paths; the assertion is a safety net for that invariant.
 */
export function forgeFor(context: { token: string | null | undefined; owner: string; repo: string }): Forge {
  if (!context.token) throw new Error('A GitHub token is required to access the forge.');
  return createGitHubForge({ token: context.token, owner: context.owner, repo: context.repo });
}

/**
 * Find merged PR(s) associated with a commit.
 * Returns the PR numbers that were merged and included this commit.
 */
export async function findMergedPRsForCommit(forge: Forge, commitSha: string): Promise<number[]> {
  try {
    const prs = await forge.listPullRequestsForCommit(commitSha);
    return prs.filter((pr) => pr.mergedAt !== null).map((pr) => pr.number);
  } catch {
    return [];
  }
}

/**
 * Find all merged PRs since the last release tag.
 * Uses git to enumerate commits in the window `<lastTag>..HEAD`, then looks up each
 * commit's associated PR via the forge API. Falls back to the last 50 commits when
 * no release tags exist. Returns a deduped list of PR numbers.
 */
export async function findMergedPRsSinceLastRelease(forge: Forge, projectDir: string): Promise<number[]> {
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

  const prGroups = await Promise.all(mergeShas.map((sha) => findMergedPRsForCommit(forge, sha)));
  const seen = new Set<number>();
  for (const prs of prGroups) {
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
  forge: Forge,
  prNumber: number,
  marker: string = MARKER,
): Promise<number | null> {
  return (await forge.findComment(prNumber, marker))?.id ?? null;
}

/**
 * Fetch the label names on a PR.
 */
export async function fetchPRLabels(forge: Forge, prNumber: number): Promise<string[]> {
  const issue = await forge.getIssue(prNumber);
  return issue.labels;
}

/**
 * Find the open standing release PR for the configured branch. Swallows errors (returns null) and
 * drops labels — callers that need labels use `forge.findStandingPR(branch)` directly.
 */
export async function findStandingPR(
  forge: Forge,
  ciConfig: CIConfig | undefined,
): Promise<{ number: number; url: string } | null> {
  const branch = ciConfig?.standingPr?.branch ?? 'release/next';
  try {
    const pr = await forge.findStandingPR(branch);
    return pr ? { number: pr.number, url: pr.url } : null;
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
  forge: Forge,
  prNumber: number,
  body: string,
  marker: string = MARKER,
): Promise<void> {
  await forge.upsertMarkerComment(prNumber, marker, body);
}
