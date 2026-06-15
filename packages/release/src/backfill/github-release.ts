import { execFileSync } from 'node:child_process';

/**
 * Marker that identifies a GitHub release body releasekit authored. Embedded at the top of every
 * backfilled body so re-runs can recognise their own work (see `decideReleaseUpdate`) — the same
 * idempotent-marker convention the preview/manifest/publish-failure comments use.
 */
export const NOTES_MARKER = '<!-- releasekit-notes -->';

export type UpdateDecision =
  | { action: 'update' }
  | { action: 'skip'; reason: 'no-release' | 'already-backfilled' | 'hand-edited' };

/**
 * Decide whether to (re)write a release body during backfill.
 *
 * - No release exists for the tag (`existingBody === null`) → skip; backfill edits, it doesn't create.
 * - `--only-missing` and the body already carries our marker → skip; we've backfilled it before.
 * - Default mode + non-empty body without marker + not `--force` → skip; suspected hand-edit.
 * - Otherwise update. An empty body or one carrying our marker is safe to overwrite.
 */
export function decideReleaseUpdate(
  existingBody: string | null,
  onlyMissing: boolean,
  force: boolean = false,
): UpdateDecision {
  if (existingBody === null) return { action: 'skip', reason: 'no-release' };
  if (onlyMissing && existingBody.includes(NOTES_MARKER)) return { action: 'skip', reason: 'already-backfilled' };
  if (!force && !onlyMissing && existingBody.trim() && !existingBody.includes(NOTES_MARKER)) {
    return { action: 'skip', reason: 'hand-edited' };
  }
  return { action: 'update' };
}

/** Prepend the marker to rendered notes so the written body is recognisable on a later run. */
export function withMarker(body: string): string {
  return `${NOTES_MARKER}\n\n${body.trim()}\n`;
}

/**
 * Read a GitHub release body by tag via `gh`, or null when no release exists for the tag.
 *
 * `gh release view` exits non-zero both for a genuinely missing release ("release not found") and
 * for auth/network/rate-limit failures, so a blanket catch would report a broken `gh` session as
 * "no release" for every tag. Only the not-found case maps to null; everything else (a missing CLI,
 * or any other failure) throws so the caller surfaces it instead of silently skipping the work.
 */
export function getReleaseBody(tag: string): string | null {
  try {
    return execFileSync('gh', ['release', 'view', tag, '--json', 'body', '--jq', '.body'], { encoding: 'utf8' });
  } catch (err) {
    const e = err as { code?: string; stderr?: string | Buffer; message?: string };
    if (e.code === 'ENOENT') {
      throw new Error('GitHub CLI (`gh`) not found — install it and run `gh auth login` to update release bodies.');
    }
    const stderr = (typeof e.stderr === 'string' ? e.stderr : e.stderr?.toString()) || e.message || '';
    if (/release not found/i.test(stderr)) return null;
    throw new Error(`\`gh release view ${tag}\` failed: ${stderr.trim() || 'unknown error'}`);
  }
}

/** Overwrite a GitHub release body via `gh release edit`. */
export function editReleaseBody(tag: string, body: string): void {
  execFileSync('gh', ['release', 'edit', tag, '--notes', body], { encoding: 'utf8' });
}
