import { extractNotesRegion, wrapNotesRegion } from '@releasekit/core';

/** Edits are read back by marker slicing, never by parsing prose, so they survive the body being regenerated. */
const REGION_HEADING = '## Release Notes';
const REGION_HINT =
  '> Edit the release notes for each package below before merging. Keep the `<!-- releasekit-notes... -->` marker comments — they delimit the editable region.';

/**
 * Notes are otherwise unbounded (LLM output, raw commit bodies), so one inflated note could push the standing-PR body
 * past GitHub's limit and wedge every update.
 */
export const MAX_NOTES_CHARS_PER_PACKAGE = 8000;
const NOTES_TRUNCATION_MARKER = '\n\n…(truncated)';

export function truncatePackageNotes(notes: string): string {
  if (notes.length <= MAX_NOTES_CHARS_PER_PACKAGE) {
    return notes;
  }
  const budget = MAX_NOTES_CHARS_PER_PACKAGE - NOTES_TRUNCATION_MARKER.length;
  const slice = notes.slice(0, budget);
  const lastNewline = slice.lastIndexOf('\n');
  const kept = lastNewline > 0 ? slice.slice(0, lastNewline) : slice;
  return `${kept}${NOTES_TRUNCATION_MARKER}`;
}

export function renderNotesRegion(notesByPackage: Record<string, string>): string {
  const packages = Object.keys(notesByPackage).sort();
  if (packages.length === 0) {
    return '';
  }

  const lines: string[] = [REGION_HEADING, '', REGION_HINT, ''];
  for (const pkg of packages) {
    lines.push(`### \`${pkg}\``, '', wrapNotesRegion(truncatePackageNotes(notesByPackage[pkg] ?? ''), pkg), '');
  }
  return lines.join('\n').trimEnd();
}

export function extractNotesRegions(body: string, packageNames: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const pkg of packageNames) {
    const region = extractNotesRegion(body, pkg);
    if (region !== undefined && region.length > 0) {
      result[pkg] = region;
    }
  }
  return result;
}

export function mergeNotesRegions(
  fresh: Record<string, string>,
  edited: Record<string, string>,
): Record<string, string> {
  return { ...fresh, ...edited };
}
