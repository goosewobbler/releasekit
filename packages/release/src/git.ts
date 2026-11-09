import { createGitCli } from '@releasekit/git';

export async function getHeadCommitMessage(cwd?: string): Promise<string | null> {
  return headLog('%s', cwd);
}

export async function getHeadTags(cwd?: string): Promise<string[]> {
  return ((await headLog('%D', cwd)) ?? '')
    .split(', ')
    .filter((ref) => ref.startsWith('tag: '))
    .map((ref) => ref.slice('tag: '.length));
}

export async function getHeadParents(cwd?: string): Promise<string[]> {
  return (await headLog('%P', cwd))?.split(' ') ?? [];
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

export function matchesSkipPattern(commitMessage: string, patterns: string[]): string | undefined {
  return patterns.find((p) => commitMessage.includes(p));
}
