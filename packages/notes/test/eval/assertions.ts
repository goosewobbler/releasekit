/**
 * Deterministic quality checks for generated release notes. Each returns the list of violations it
 * found (empty = clean), so the spec can assert `toEqual([])` and surface the offending lines on
 * failure. Kept pure and content-based so they hold for both replayed fixtures and live-model output.
 */

/** Internal HTML markers (`<!-- releasekit-… -->`) must never leak into user-facing notes. */
export function findMarkerLeaks(text: string): string[] {
  return text.match(/<!--\s*releasekit-[^>]*-->/g) ?? [];
}

/** A model that restates "Updated dependencies" per bump produces noisy, duplicated churn lines. */
export function findDuplicateDependencyChurn(text: string): string[] {
  const lines = text.split('\n').filter((line) => /updated dependencies/i.test(line));
  return lines.length > 1 ? lines : [];
}

/** Guard against a truncated (empty/near-empty) or runaway generation. */
export function checkLengthBounds(text: string, min: number, max: number): string[] {
  const n = text.trim().length;
  if (n < min) return [`output too short: ${n} < ${min} chars`];
  if (n > max) return [`output too long: ${n} > ${max} chars`];
  return [];
}

const IRREGULAR_PAST = new Set(['made', 'built', 'brought', 'rewrote', 'drove', 'took', 'gave', 'kept', 'shipped']);

function looksPastTense(word: string): boolean {
  const w = word.toLowerCase().replace(/[^a-z]/g, '');
  return w.endsWith('ed') || IRREGULAR_PAST.has(w);
}

/** Markdown list-item lines — bullets (`- …`, `* …`) and ordered items (`1. …`). */
export function listItemLines(text: string): string[] {
  return text.split('\n').filter((line) => /^\s*(?:[-*]|\d+\.)\s+\S/.test(line));
}

/**
 * The style guides all mandate past tense ("Added feature", not "Add feature"). Check that a majority
 * of list items lead with a past-tense verb — a ratio, not all-or-nothing, since an item may
 * legitimately open with a proper noun or an API name. Both bullet and numbered lists are inspected,
 * so a model that switches to a numbered list can't bypass the check. Pure prose (no list items) has
 * no reliable per-change verb to inspect, so it is not tense-checked here.
 */
export function checkPastTenseLeaning(text: string, minRatio = 0.6): string[] {
  const items = listItemLines(text);
  if (items.length === 0) return [];
  const firstWords = items.map((line) => line.replace(/^\s*(?:[-*]|\d+\.)\s+/, '').split(/\s+/)[0] ?? '');
  const pastCount = firstWords.filter(looksPastTense).length;
  const ratio = pastCount / items.length;
  return ratio >= minRatio ? [] : [`only ${pastCount}/${items.length} items lead past-tense (< ${minRatio})`];
}
