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

/** Same shape as the pipeline's `CategorizedEntries`, kept structural so the assertions stay pure. */
interface CategoryGroup {
  category: string;
  entries: unknown[];
}

/**
 * Grouping has to discriminate, not just be legal. The task validator already rejects category names
 * outside the configured set, so a model that drops every entry into one bucket passes validation and
 * still produces a useless grouping. Checks the two ways that degrades: too few distinct categories,
 * and one category swallowing most of the entries.
 *
 * `maxShare` is only meaningful once there are enough entries to spread, so it is skipped below four.
 */
export function checkCategoryDistribution(
  categories: CategoryGroup[],
  opts: { minCategories?: number; maxShare?: number } = {},
): string[] {
  const { minCategories = 2, maxShare = 0.8 } = opts;
  const total = categories.reduce((n, c) => n + c.entries.length, 0);
  if (total === 0) return ['no categorized entries'];

  const violations: string[] = [];
  const populated = categories.filter((c) => c.entries.length > 0);

  if (populated.length < minCategories) {
    violations.push(`only ${populated.length} populated categor(ies), expected >= ${minCategories}`);
  }

  const empty = categories.filter((c) => c.entries.length === 0).map((c) => c.category);
  if (empty.length > 0) violations.push(`empty categories emitted: ${empty.join(', ')}`);

  if (total >= 4) {
    const largest = populated.reduce((a, b) => (b.entries.length > a.entries.length ? b : a), populated[0]);
    if (largest && largest.entries.length / total > maxShare) {
      violations.push(`"${largest.category}" holds ${largest.entries.length}/${total} entries (> ${maxShare})`);
    }
  }

  return violations;
}

/** Every entry survived categorization exactly once — none dropped, none duplicated across buckets. */
export function checkNoEntryLoss(categories: CategoryGroup[], expectedCount: number): string[] {
  const total = categories.reduce((n, c) => n + c.entries.length, 0);
  return total === expectedCount ? [] : [`categorized ${total} entries, expected ${expectedCount}`];
}
