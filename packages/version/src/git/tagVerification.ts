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
    // Check if the ref object exists in the repository
    execSync('git', ['rev-parse', '--verify', tagName], {
      cwd,
      stdio: 'ignore',
    });
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
        error: `Ref '${tagName}' not found in repository`,
      };
    }

    // Other git errors (permissions, corrupted repo, etc.)
    return {
      exists: false,
      reachable: false,
      error: `Git error: ${errorMessage}`,
    };
  }

  // Ref exists — now confirm it is an ancestor of HEAD so that `<ref>..HEAD` produces a
  // meaningful range. `rev-parse --verify` only checks object existence, not DAG ancestry;
  // a SHA from a shallow clone or a squash-merge could be present but not reachable from HEAD.
  try {
    execSync('git', ['merge-base', '--is-ancestor', tagName, 'HEAD'], {
      cwd,
      stdio: 'ignore',
    });
    return { exists: true, reachable: true };
  } catch {
    return {
      exists: true,
      reachable: false,
      error: `Ref '${tagName}' exists but is not an ancestor of HEAD`,
    };
  }
}
