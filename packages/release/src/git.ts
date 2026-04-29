import { execSync } from 'node:child_process';

export function getHeadCommitMessage(cwd?: string): string | null {
  try {
    return execSync('git log -1 --pretty=%s', { encoding: 'utf-8', cwd }).trim();
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
  if (!repo) return null;

  const [owner, repoName] = repo.split('/');
  if (!owner || !repoName) return null;

  return {
    owner,
    repo: repoName,
    sha: process.env.GITHUB_SHA ?? null,
    token: process.env.GITHUB_TOKEN ?? null,
  };
}

export function matchesSkipPattern(commitMessage: string, patterns: string[]): string | undefined {
  return patterns.find((p) => commitMessage.startsWith(p) || commitMessage.includes(p));
}
