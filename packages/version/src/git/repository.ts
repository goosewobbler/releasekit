import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createGitCli, type Git } from '@releasekit/git';

export async function isGitRepository(directory: string, git: Git = createGitCli()): Promise<boolean> {
  const gitDir = join(directory, '.git');

  if (!existsSync(gitDir)) {
    return false;
  }

  const stats = statSync(gitDir);
  if (!stats.isDirectory()) {
    return false;
  }

  return git.isRepository(directory);
}

export function getCurrentBranch(git: Git = createGitCli()): Promise<string> {
  return git.currentBranch();
}
