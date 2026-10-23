import { createGitCli, type Git } from '@releasekit/git';

export interface TagVerificationResult {
  exists: boolean;
  reachable: boolean;
  error?: string;
}

export async function verifyTag(
  tagName: string,
  cwd: string,
  git: Git = createGitCli(),
): Promise<TagVerificationResult> {
  if (!tagName || tagName.trim() === '') {
    return { exists: false, reachable: false, error: 'Empty tag name' };
  }

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

  // Existence isn't enough: a SHA from a shallow clone or a squash-merge can be present but not an
  // ancestor of HEAD, making `<ref>..HEAD` meaningless.
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
