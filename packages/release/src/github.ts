import type { CIConfig } from '@releasekit/config';
import { createGitHubForge, type Forge } from '@releasekit/forge';

export const MARKER = '<!-- releasekit-preview -->';

export function forgeFor(context: { token: string | null | undefined; owner: string; repo: string }): Forge {
  if (!context.token) {
    throw new Error('A GitHub token is required to access the forge.');
  }
  return createGitHubForge({ token: context.token, owner: context.owner, repo: context.repo });
}

export async function findMergedPRsForCommit(forge: Forge, commitSha: string): Promise<number[]> {
  const prs = await forge.listPullRequestsForCommit(commitSha);
  return prs.filter((pr) => pr.mergedAt !== null).map((pr) => pr.number);
}

/** The forge couldn't list the merged PRs, which isn't the same as none having merged. */
export class PRLookupError extends Error {}

export async function fetchPRLabels(forge: Forge, prNumber: number): Promise<string[]> {
  const issue = await forge.getIssue(prNumber);
  return issue.labels;
}

/** Swallows errors and drops labels; callers needing labels use `forge.findStandingPR(branch)` directly. */
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

/** The body must start with the marker so later calls find and update the same comment. */
export async function postOrUpdateComment(
  forge: Forge,
  prNumber: number,
  body: string,
  marker: string = MARKER,
): Promise<void> {
  await forge.upsertMarkerComment(prNumber, marker, body);
}
