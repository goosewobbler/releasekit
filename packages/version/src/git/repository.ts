import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from './commandExecutor.js';

/**
 * Check if a directory is a git repository
 * @param directory Directory to check
 * @returns True if directory is a git repository
 */
export function isGitRepository(directory: string): boolean {
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

  // Final check: run git command
  try {
    execSync('git rev-parse --is-inside-work-tree', { cwd: directory });
    return true;
  } catch (_error) {
    return false;
  }
}

/**
 * Get current branch name
 * @returns Current branch name
 */
export function getCurrentBranch(): string {
  const result = execSync('git rev-parse --abbrev-ref HEAD');
  return result.toString().trim();
}
