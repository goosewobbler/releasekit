import { execFileSync } from 'node:child_process';

/**
 * Marker that identifies a GitHub release body releasekit authored. Embedded at the top of every
 * backfilled body so re-runs can recognise their own work (see `decideReleaseUpdate`) — the same
 * idempotent-marker convention the preview/manifest/publish-failure comments use.
 */
export const NOTES_MARKER = '<!-- releasekit-notes -->';

export type UpdateDecision = { action: 'update' } | { action: 'skip'; reason: 'no-release' | 'already-backfilled' };

/**
 * Decide whether to (re)write a release body during backfill.
 *
 * - No release exists for the tag (`existingBody === null`) → skip; backfill edits, it doesn't create.
 * - `--only-missing` and the body already carries our marker → skip; we've backfilled it before.
 * - Otherwise update. An unmarked body (empty, GitHub auto-generated, or pre-releasekit hand-written)
 *   is treated as a gap to fill; the default (non-`--only-missing`) run also refreshes marked bodies.
 */
export function decideReleaseUpdate(existingBody: string | null, onlyMissing: boolean): UpdateDecision {
  if (existingBody === null) return { action: 'skip', reason: 'no-release' };
  if (onlyMissing && existingBody.includes(NOTES_MARKER)) return { action: 'skip', reason: 'already-backfilled' };
  return { action: 'update' };
}

/** Prepend the marker to rendered notes so the written body is recognisable on a later run. */
export function withMarker(body: string): string {
  return `${NOTES_MARKER}\n\n${body.trim()}\n`;
}

/**
 * Read a GitHub release body by tag via `gh`, or null when no release exists for the tag.
 * Throws a clear error if `gh` itself is missing (ENOENT) so a missing CLI isn't silently read
 * as "every release is absent".
 */
export function getReleaseBody(tag: string): string | null {
  try {
    return execFileSync('gh', ['release', 'view', tag, '--json', 'body', '--jq', '.body'], { encoding: 'utf8' });
  } catch (err) {
    if ((err as { code?: string }).code === 'ENOENT') {
      throw new Error('GitHub CLI (`gh`) not found — install it and run `gh auth login` to update release bodies.');
    }
    return null;
  }
}

/** Overwrite a GitHub release body via `gh release edit`. */
export function editReleaseBody(tag: string, body: string): void {
  execFileSync('gh', ['release', 'edit', tag, '--notes', body], { encoding: 'utf8' });
}
