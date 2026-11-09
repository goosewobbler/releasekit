import { createGitCli } from '@releasekit/git';

export async function getHeadCommitMessage(cwd?: string): Promise<string | null> {
  return headLog('%s', cwd);
}

/** Each tag's commit, peeled through annotated tags. */
export async function getTagCommits(cwd?: string): Promise<Map<string, string>> {
  const lines = await createGitCli().forEachRef({
    format: '%(refname:strip=2)%09%(objectname)%09%(*objectname)',
    pattern: 'refs/tags',
    cwd,
  });
  const commits = new Map<string, string>();
  for (const line of lines) {
    const [name, object, peeled] = line.split('\t');
    if (name && object) {
      commits.set(name, peeled || object);
    }
  }
  return commits;
}

/** HEAD and its first-parent ancestors, newest first. */
export async function getRecentCommits(count: number, cwd?: string): Promise<Array<{ sha: string; subject: string }>> {
  const out = await createGitCli().log({ format: '%H%x09%s', extraArgs: [`-${count}`, '--first-parent'], cwd });
  return out
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [sha = '', ...subject] = line.split('\t');
      return { sha, subject: subject.join('\t') };
    });
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
