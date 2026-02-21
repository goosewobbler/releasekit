/**
 * Tag verification utilities for checking tag existence and reachability
 */

import { execSync } from './commandExecutor.js';

export interface TagVerificationResult {
  exists: boolean;
  reachable: boolean;
  error?: string;
}

/**
 * Verify if a git tag exists and is reachable in the current repository
 * @param tagName The tag to verify
 * @param cwd Working directory for git commands
 * @returns TagVerificationResult with existence and reachability status
 */
export function verifyTag(tagName: string, cwd: string): TagVerificationResult {
  if (!tagName || tagName.trim() === '') {
    return { exists: false, reachable: false, error: 'Empty tag name' };
  }

  try {
    // Check if tag exists in the repository
    execSync(`git rev-parse --verify "${tagName}"`, {
      cwd,
      stdio: 'ignore',
    });

    // Tag exists and is reachable
    return { exists: true, reachable: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    // Check if it's a "not found" error
    if (
      errorMessage.includes('unknown revision') ||
      errorMessage.includes('bad revision') ||
      errorMessage.includes('No such ref')
    ) {
      return {
        exists: false,
        reachable: false,
        error: `Tag '${tagName}' not found in repository`,
      };
    }

    // Other git errors (permissions, corrupted repo, etc.)
    return {
      exists: false,
      reachable: false,
      error: `Git error: ${errorMessage}`,
    };
  }
}
