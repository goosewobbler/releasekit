/**
 * Reads `.status` structurally rather than via `instanceof RequestError` (which only matches the GitHub adapter), so
 * callers' status-specific handling survives swapping the forge.
 */
export function forgeErrorStatus(error: unknown): number | undefined {
  if (error && typeof error === 'object' && 'status' in error) {
    const { status } = error as { status?: unknown };
    if (typeof status === 'number') {
      return status;
    }
  }
  return undefined;
}
