import { ReleaseKitError } from '@releasekit/core';
import { createGitCli, isTagAfter } from '@releasekit/git';

export async function getHeadCommitMessage(cwd?: string): Promise<string | null> {
  return headLog('%s', cwd);
}

export async function getHeadParents(cwd?: string): Promise<string[]> {
  return (await headLog('%P', cwd))?.split(' ') ?? [];
}

/** The checkout's nearest tag when it comes after `sha`, so `sha` was already released. */
export async function tagAfter(sha: string, cwd?: string): Promise<string | null> {
  const git = createGitCli();
  const tag = await git.describeTags(cwd);
  return tag && (await isTagAfter(git, tag, sha, cwd)) ? tag : null;
}

/**
 * The branch a release lands on: `branch`, else the checked-out branch, else the workflow's branch. Null when none is
 * known, as in a detached checkout for a tag push.
 */
export async function releaseBranch(branch: string | undefined, cwd?: string): Promise<string | null> {
  if (branch) {
    return branch;
  }
  const current = await createGitCli()
    .currentBranch(cwd)
    .catch(() => 'HEAD');
  return current === 'HEAD' ? (process.env.GITHUB_REF?.match(/^refs\/heads\/(.+)$/)?.[1] ?? null) : current;
}

async function headLog(format: string, cwd?: string): Promise<string | null> {
  try {
    return (await createGitCli().log({ format, extraArgs: ['-1'], cwd })).trim();
  } catch {
    return null;
  }
}

export interface GitHubContext {
  owner: string;
  repo: string;
  sha: string | null;
  token: string | null;
}

export function getGitHubContext(): GitHubContext | null {
  const repo = process.env.GITHUB_REPOSITORY;
  if (!repo) {
    return null;
  }

  const [owner, repoName] = repo.split('/');
  if (!owner || !repoName) {
    return null;
  }

  return {
    owner,
    repo: repoName,
    sha: process.env.GITHUB_SHA ?? null,
    token: process.env.GITHUB_TOKEN ?? null,
  };
}

class GitHubContextError extends ReleaseKitError {
  readonly code = 'GITHUB_ERROR';
  readonly suggestions: string[] = [];
}

export function requireGitHubContext(consequence: string): GitHubContext {
  const context = getGitHubContext();
  if (context?.token) {
    return context;
  }
  const repository = process.env.GITHUB_REPOSITORY;
  const [cause, fix] = !repository
    ? ['GITHUB_REPOSITORY is not set', 'Set GITHUB_REPOSITORY to owner/repo']
    : !context
      ? [`GITHUB_REPOSITORY '${repository}' is not owner/repo`, 'Set GITHUB_REPOSITORY to owner/repo']
      : ['GITHUB_TOKEN is not set', `Set GITHUB_TOKEN to a token with access to ${repository}`];
  throw new GitHubContextError(`No GitHub context: ${cause}, so ${consequence}. ${fix}.`);
}

export function matchesSkipPattern(commitMessage: string, patterns: string[]): string | undefined {
  return patterns.find((p) => commitMessage.includes(p));
}
