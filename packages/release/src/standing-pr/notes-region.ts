import { extractNotesRegion, wrapNotesRegion } from '@releasekit/core';

/**
 * The editable release-notes region of a standing-PR body. The bot seeds one keyed sub-region per
 * package; a human edits the prose between the markers; the bot extracts it back by marker slicing
 * (never by parsing the prose) so edits survive the body being regenerated and force-pushed.
 *
 * Per-package keying lets a multi-package standing PR carry several independently-editable blocks,
 * and lets `publishFromManifest` pull each package's notes out by name at merge time.
 */
const REGION_HEADING = '## Release Notes';
const REGION_HINT =
  '> Edit the release notes for each package below before merging. Keep the `<!-- releasekit-notes... -->` marker comments — they delimit the editable region.';

/**
 * Upper bound on a single package's rendered release notes. Release notes are otherwise unbounded
 * (the LLM output isn't length-capped, and raw commit bodies flow through), so an inflated note —
 * accidental or adversarial — could push the standing-PR body past GitHub's hard limit and wedge
 * every update. Generous enough that normal notes are untouched; a note beyond it is trimmed
 * at a line boundary with an explicit marker.
 */
export const MAX_NOTES_CHARS_PER_PACKAGE = 8000;
const NOTES_TRUNCATION_MARKER = '\n\n…(truncated)';

/** Trim one package's notes to {@link MAX_NOTES_CHARS_PER_PACKAGE}, on a line boundary where possible. */
export function truncatePackageNotes(notes: string): string {
  if (notes.length <= MAX_NOTES_CHARS_PER_PACKAGE) return notes;
  const budget = MAX_NOTES_CHARS_PER_PACKAGE - NOTES_TRUNCATION_MARKER.length;
  const slice = notes.slice(0, budget);
  const lastNewline = slice.lastIndexOf('\n');
  const kept = lastNewline > 0 ? slice.slice(0, lastNewline) : slice;
  return `${kept}${NOTES_TRUNCATION_MARKER}`;
}

/** Render the editable region for the given per-package notes, with keyed markers per package. */
export function renderNotesRegion(notesByPackage: Record<string, string>): string {
  const packages = Object.keys(notesByPackage).sort();
  if (packages.length === 0) return '';

  const lines: string[] = [REGION_HEADING, '', REGION_HINT, ''];
  for (const pkg of packages) {
    lines.push(`### \`${pkg}\``, '', wrapNotesRegion(truncatePackageNotes(notesByPackage[pkg] ?? ''), pkg), '');
  }
  return lines.join('\n').trimEnd();
}

/** Extract each package's edited notes from a PR body, keyed by package name. Missing → omitted. */
export function extractNotesRegions(body: string, packageNames: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const pkg of packageNames) {
    const region = extractNotesRegion(body, pkg);
    if (region !== undefined && region.length > 0) result[pkg] = region;
  }
  return result;
}

/**
 * Merge freshly generated notes with edited notes pulled from the live PR body. Edited content wins
 * per package; packages new since the last edit (absent from `edited`) fall back to the fresh notes.
 */
export function mergeNotesRegions(
  fresh: Record<string, string>,
  edited: Record<string, string>,
): Record<string, string> {
  return { ...fresh, ...edited };
}
