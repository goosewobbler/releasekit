import type { CIConfig } from '@releasekit/config';
import { createGitHubForge, type Forge } from '@releasekit/forge';
import { createGitCli } from '@releasekit/git';

export const MARKER = '<!-- releasekit-preview -->';

export function forgeFor(context: { token: string | null | undefined; owner: string; repo: string }): Forge {
  if (!context.token) {
    throw new Error('A GitHub token is required to access the forge.');
  }
  return createGitHubForge({ token: context.token, owner: context.owner, repo: context.repo });
}

export async function findMergedPRsForCommit(forge: Forge, commitSha: string): Promise<number[]> {
  try {
    const prs = await forge.listPullRequestsForCommit(commitSha);
    return prs.filter((pr) => pr.mergedAt !== null).map((pr) => pr.number);
  } catch {
    return [];
  }
}

export async function findMergedPRsSinceLastRelease(forge: Forge, projectDir: string): Promise<number[]> {
  const git = createGitCli();
  // No tags → the last 50 commits. `-50` is a count flag, not a range, so it rides in extraArgs: the seam rejects a
  // `-`-leading range as a would-be option.
  const lastTag = await git.describeTags(projectDir);
  const logOpts = lastTag
    ? { range: `${lastTag}..HEAD`, format: '%H', cwd: projectDir }
    : { format: '%H', extraArgs: ['-50'], cwd: projectDir };

  let mergeShas: string[];
  try {
    const output = (await git.log(logOpts)).trim();
    mergeShas = output ? output.split('\n').filter(Boolean) : [];
  } catch {
    return [];
  }

  const prGroups = await Promise.all(mergeShas.map((sha) => findMergedPRsForCommit(forge, sha)));
  const seen = new Set<number>();
  for (const prs of prGroups) {
    for (const n of prs) {
      seen.add(n);
    }
  }
  return [...seen];
}

export async function findPreviewComment(
  forge: Forge,
  prNumber: number,
  marker: string = MARKER,
): Promise<number | null> {
  return (await forge.findComment(prNumber, marker))?.id ?? null;
}

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
