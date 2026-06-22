/**
 * Markers delimiting a maintainer-editable *selection* region inside a standing-PR body: a GitHub
 * task-list where a ticked row means "release this package". The tool seeds the region (all ticked
 * by default), a maintainer ticks/unticks rows, and the tool reads the choice back out on the next
 * run — by marker slicing, never by parsing the surrounding prose.
 *
 * Two layers of marker:
 * - The region opener/closer ({@link SELECTION_MARKER} / {@link SELECTION_MARKER_END}) bound the
 *   whole block so it can be extracted as a unit (the second {@link extractMarkerRegion} adapter,
 *   after notes-region — this is why the region primitive exists).
 * - A per-row identity marker ({@link rkSelMarker}) carries the package name. The row's checked
 *   state is the GitHub `- [x]` / `- [ ]` glyph (the only thing a human can toggle); the package it
 *   refers to is read from this marker, NOT from the backticked display text — so a maintainer
 *   editing or truncating the visible label can never mis-identify which package a row selects.
 */
import { extractMarkerRegion, wrapMarkerRegion } from './marker.js';

export const SELECTION_MARKER = '<!-- releasekit-selection -->';
export const SELECTION_MARKER_END = '<!-- releasekit-selection-end -->';

/** The per-row identity marker carrying a package name (machine-read; never the row's prose). */
export function rkSelMarker(packageName: string): string {
  return `<!-- rk-sel:${packageName} -->`;
}

/** Wrap rendered selection rows in the region markers so the block can be recognised and extracted. */
export function wrapSelectionRegion(content: string): string {
  return wrapMarkerRegion(content, SELECTION_MARKER, SELECTION_MARKER_END);
}

/**
 * Extract the selection region's content from a body, or `undefined` when the opener is absent —
 * the selection-region adapter over {@link extractMarkerRegion} (pure marker slicing).
 */
export function extractSelectionRegion(body: string): string | undefined {
  return extractMarkerRegion(body, SELECTION_MARKER, SELECTION_MARKER_END);
}
