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

/** Render the editable region for the given per-package notes, with keyed markers per package. */
export function renderNotesRegion(notesByPackage: Record<string, string>): string {
  const packages = Object.keys(notesByPackage).sort();
  if (packages.length === 0) return '';

  const lines: string[] = [REGION_HEADING, '', REGION_HINT, ''];
  for (const pkg of packages) {
    lines.push(`### \`${pkg}\``, '', wrapNotesRegion(notesByPackage[pkg] ?? '', pkg), '');
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
