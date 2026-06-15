/**
 * Normalize a package.json `repository` field to a bare URL. Accepts the string shorthand or the
 * `{ url }` object form, then strips the `git+` prefix and `.git` suffix independently — a url may
 * carry either alone (e.g. `git+https://…/repo` with no suffix), and leaving the prefix breaks the
 * compare links the notes pipeline builds from it. Returns undefined when no URL is present.
 */
export function normalizeRepoUrl(repo: unknown): string | undefined {
  let url: string | undefined;
  if (typeof repo === 'string') url = repo;
  else if (repo && typeof repo === 'object' && typeof (repo as { url?: unknown }).url === 'string')
    url = (repo as { url: string }).url;
  if (url?.startsWith('git+')) url = url.slice(4);
  if (url?.endsWith('.git')) url = url.slice(0, -4);
  return url;
}
