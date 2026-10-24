/** A human-editable notes region in a GitHub release or standing-PR body, delimited by markers so it round-trips. */
import { extractMarkerRegion, neutralizeMarkers, wrapMarkerRegion } from './marker.js';

/**
 * `decideReleaseUpdate` treats a body containing this opener as releasekit-authored, and existing release bodies carry
 * it, so it must stay byte-identical. The closer must not contain it as a substring.
 */
export const NOTES_MARKER = '<!-- releasekit-notes -->';
export const NOTES_MARKER_END = '<!-- releasekit-notes-end -->';

function openMarker(pkgKey?: string): string {
  return pkgKey ? `<!-- releasekit-notes:${pkgKey} -->` : NOTES_MARKER;
}

function closeMarker(pkgKey?: string): string {
  return pkgKey ? `<!-- releasekit-notes-end:${pkgKey} -->` : NOTES_MARKER_END;
}

/** The single wrap boundary for notes, so every source is neutralized here. */
export function wrapNotesRegion(content: string, pkgKey?: string): string {
  return wrapMarkerRegion(neutralizeMarkers(content), openMarker(pkgKey), closeMarker(pkgKey));
}

/** `undefined` for an unterminated region too: past a missing closer lie later regions and the body's footer. */
export function extractNotesRegion(body: string, pkgKey?: string): string | undefined {
  const region = extractMarkerRegion(body, openMarker(pkgKey), closeMarker(pkgKey));
  return region?.closed ? region.content : undefined;
}

export function hasUnterminatedNotesRegion(body: string, pkgKey?: string): boolean {
  return extractMarkerRegion(body, openMarker(pkgKey), closeMarker(pkgKey))?.closed === false;
}
