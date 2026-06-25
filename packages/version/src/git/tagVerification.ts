/**
 * Tag verification utilities for checking tag existence and reachability
 */

import { createGitCli, type Git } from '@releasekit/git';

export interface TagVerificationResult {
  exists: boolean;
  reachable: boolean;
  error?: string;
}

/**
 * Verify if a git tag exists and is reachable in the current repository
 * @param tagName The tag to verify
 * @param cwd Working directory for git commands
 * @param git Injected git seam (defaults to the real CLI adapter)
 * @returns TagVerificationResult with existence and reachability status
 */
export async function verifyTag(
  tagName: string,
  cwd: string,
  git: Git = createGitCli(),
): Promise<TagVerificationResult> {
  if (!tagName || tagName.trim() === '') {
    return { exists: false, reachable: false, error: 'Empty tag name' };
  }

  // Check if the ref object exists in the repository. The seam's refExists is a "soft" lookup:
  // a non-zero git exit (unknown revision / bad ref) is the answer (false), so an absent ref is
  // reported as "not found" rather than thrown — preserving the dominant not-found branch below.
  let exists: boolean;
  try {
    exists = await git.refExists(tagName, cwd);
  } catch (error) {
    // refExists only throws when git itself is missing/fails unexpectedly (e.g. binary not found).
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      exists: false,
      reachable: false,
      error: `Git error: ${errorMessage}`,
    };
  }

  if (!exists) {
    return {
      exists: false,
      reachable: false,
      error: `Ref '${tagName}' not found in repository`,
    };
  }

  // Ref exists — now confirm it is an ancestor of HEAD so that `<ref>..HEAD` produces a
  // meaningful range. ref existence alone doesn't check DAG ancestry; a SHA from a shallow clone
  // or a squash-merge could be present but not reachable from HEAD.
  const reachable = await git.isAncestor(tagName, 'HEAD', cwd);
  if (reachable) {
    return { exists: true, reachable: true };
  }
  return {
    exists: true,
    reachable: false,
    error: `Ref '${tagName}' exists but is not an ancestor of HEAD`,
  };
}
