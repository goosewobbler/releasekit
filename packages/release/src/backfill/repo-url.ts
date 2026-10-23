/**
 * Strips the `git+` prefix and `.git` suffix independently: a URL may carry either alone, and a leftover prefix breaks
 * the compare links the notes pipeline builds.
 */
export function normalizeRepoUrl(repo: unknown): string | undefined {
  let url: string | undefined;
  if (typeof repo === 'string') {
    url = repo;
  } else if (repo && typeof repo === 'object' && typeof (repo as { url?: unknown }).url === 'string') {
    url = (repo as { url: string }).url;
  }
  if (url?.startsWith('git+')) {
    url = url.slice(4);
  }
  if (url?.endsWith('.git')) {
    url = url.slice(0, -4);
  }
  return url;
}
