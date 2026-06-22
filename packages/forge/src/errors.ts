/**
 * The HTTP status carried by a forge error, if any, without depending on a concrete adapter's error
 * type. Octokit's `RequestError` exposes `.status`; a GitLab/Bitbucket adapter would surface the same
 * field. Callers branch on the number so status-specific handling (401/403/404, …) survives swapping
 * the forge — instead of `instanceof RequestError`, which only ever matches the GitHub adapter.
 */
export function forgeErrorStatus(error: unknown): number | undefined {
  if (error && typeof error === 'object' && 'status' in error) {
    const { status } = error as { status?: unknown };
    if (typeof status === 'number') return status;
  }
  return undefined;
}
