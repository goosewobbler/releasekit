/** The maintainer-editable task list in a standing-PR body, where a ticked row means "release this package". */
import { extractMarkerRegion, wrapMarkerRegion } from './marker.js';

export const SELECTION_MARKER = '<!-- releasekit-selection -->';
export const SELECTION_MARKER_END = '<!-- releasekit-selection-end -->';

/**
 * Identifies a row's package while the row's `- [x]` / `- [ ]` glyph carries the choice. Rows are read by this marker,
 * never the visible label, so a maintainer editing the label can't change which package a row selects.
 */
export function rkSelMarker(packageName: string): string {
  return `<!-- rk-sel:${packageName} -->`;
}

/** A stable row's nested "ship as a prerelease" toggle. */
export function rkPreMarker(packageName: string): string {
  return `<!-- rk-pre:${packageName} -->`;
}

/** A prerelease row's nested "graduate to stable" toggle. */
export function rkGradMarker(packageName: string): string {
  return `<!-- rk-grad:${packageName} -->`;
}

export function wrapSelectionRegion(content: string): string {
  return wrapMarkerRegion(content, SELECTION_MARKER, SELECTION_MARKER_END);
}

export function extractSelectionRegion(body: string): string | undefined {
  return extractMarkerRegion(body, SELECTION_MARKER, SELECTION_MARKER_END);
}
