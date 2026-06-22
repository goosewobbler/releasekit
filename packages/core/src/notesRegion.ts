/**
 * Markers delimiting a human-editable release-notes region inside a round-trippable surface
 * (a GitHub release body, or a standing-PR body). The tool seeds the region, a human may edit it,
 * and the tool extracts it back out — by marker slicing, never by parsing the surrounding prose.
 *
 * `NOTES_MARKER` is the region opener and is byte-identical to the original backfill provenance tag,
 * so `decideReleaseUpdate`'s `includes(NOTES_MARKER)` ownership check keeps working unchanged: a body
 * carrying the opener is recognised as releasekit-authored. The `-end` closer does not contain the
 * opener as a substring, so it never false-matches that check on its own.
 *
 * Multiple packages share one surface (a multi-package standing PR) by keying the markers:
 * `<!-- releasekit-notes:<key> -->` … `<!-- releasekit-notes-end:<key> -->`.
 */
import { extractMarkerRegion, wrapMarkerRegion } from './marker.js';

export const NOTES_MARKER = '<!-- releasekit-notes -->';
export const NOTES_MARKER_END = '<!-- releasekit-notes-end -->';

function openMarker(pkgKey?: string): string {
  return pkgKey ? `<!-- releasekit-notes:${pkgKey} -->` : NOTES_MARKER;
}

function closeMarker(pkgKey?: string): string {
  return pkgKey ? `<!-- releasekit-notes-end:${pkgKey} -->` : NOTES_MARKER_END;
}

/** Wrap rendered notes in the editable-region markers so they can be recognised and extracted later. */
export function wrapNotesRegion(content: string, pkgKey?: string): string {
  return wrapMarkerRegion(content, openMarker(pkgKey), closeMarker(pkgKey));
}

/**
 * Extract the editable-region content from a body, or `undefined` when the opener is absent. The
 * notes-region adapter over {@link extractMarkerRegion}: pure marker slicing, with the legacy
 * "opener but no closer" body falling back to everything after the opener.
 */
export function extractNotesRegion(body: string, pkgKey?: string): string | undefined {
  return extractMarkerRegion(body, openMarker(pkgKey), closeMarker(pkgKey));
}
