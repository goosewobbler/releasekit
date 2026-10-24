import { extractNotesRegion, type VersionOutput, wrapNotesRegion } from '@releasekit/core';

/** Edits are read back by marker slicing, never by parsing prose, so they survive the body being regenerated. */
const REGION_HEADING = '## Release Notes';
const REGION_HINT =
  '> Edit the release notes for each package below before merging. Keep the `<!-- releasekit-notes... -->` marker comments — they delimit the editable region.';

/**
 * Notes are otherwise unbounded (LLM output, raw commit bodies), so one inflated note could push the standing-PR body
 * past GitHub's limit and wedge every update.
 */
export const MAX_NOTES_CHARS_PER_PACKAGE = 8000;
const TRUNCATION_NOTE = '…(truncated)';
const NOTES_TRUNCATION_MARKER = `\n\n${TRUNCATION_NOTE}`;

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

/** Notes are keyed by changelog packageName, which is `monorepo` for a sync release without `mainPackage`. */
export function notesRegionKeys(versionOutput: VersionOutput): string[] {
  return versionOutput.changelogs.map((changelog) => changelog.packageName).filter((name) => name.length > 0);
}

export function extractNotesRegions(body: string, versionOutput: VersionOutput): Record<string, string> {
  const result: Record<string, string> = {};
  for (const pkg of notesRegionKeys(versionOutput)) {
    const region = extractNotesRegion(body, pkg);
    // Still ending in the truncation note means nobody edited it, so the full fresh notes should win.
    if (region !== undefined && region.length > 0 && !region.trimEnd().endsWith(TRUNCATION_NOTE)) {
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
