import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createGitCli, type Git } from '@releasekit/git';

/**
 * Check if a directory is a git repository
 * @param directory Directory to check
 * @param git Injected git seam (defaults to the real CLI adapter)
 * @returns True if directory is a git repository
 */
export async function isGitRepository(directory: string, git: Git = createGitCli()): Promise<boolean> {
  const gitDir = join(directory, '.git');

  // Check if .git directory exists
  if (!existsSync(gitDir)) {
    return false;
  }

  // Check if .git is a directory
  const stats = statSync(gitDir);
  if (!stats.isDirectory()) {
    return false;
  }

  // Final check: run git command (soft lookup — a non-repo exits non-zero → false).
  return git.isRepository(directory);
}

/**
 * Get current branch name
 * @param git Injected git seam (defaults to the real CLI adapter)
 * @returns Current branch name
 */
export function getCurrentBranch(git: Git = createGitCli()): Promise<string> {
  return git.currentBranch();
}
