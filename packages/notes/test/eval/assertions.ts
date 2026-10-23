/**
 * Deterministic quality checks for generated release notes. Kept pure and content-based so they hold
 * for both replayed fixtures and live-model output.
 */

export function findMarkerLeaks(text: string): string[] {
  return text.match(/<!--\s*releasekit-[^>]*-->/g) ?? [];
}

export function findDuplicateDependencyChurn(text: string): string[] {
  const lines = text.split('\n').filter((line) => /updated dependencies/i.test(line));
  return lines.length > 1 ? lines : [];
}

export function checkLengthBounds(text: string, min: number, max: number): string[] {
  const n = text.trim().length;
  if (n < min) {
    return [`output too short: ${n} < ${min} chars`];
  }
  if (n > max) {
    return [`output too long: ${n} > ${max} chars`];
  }
  return [];
}

const IRREGULAR_PAST = new Set(['made', 'built', 'brought', 'rewrote', 'drove', 'took', 'gave', 'kept', 'shipped']);

function looksPastTense(word: string): boolean {
  const w = word.toLowerCase().replace(/[^a-z]/g, '');
  return w.endsWith('ed') || IRREGULAR_PAST.has(w);
}

export function listItemLines(text: string): string[] {
  return text.split('\n').filter((line) => /^\s*(?:[-*]|\d+\.)\s+\S/.test(line));
}

/**
 * A ratio, not all-or-nothing, since an item may legitimately open with a proper noun or an API name.
 * Numbered lists are inspected too, so a model that switches to one can't bypass the check. Pure prose
 * has no reliable per-change verb to inspect, so it is not tense-checked.
 */
export function checkPastTenseLeaning(text: string, minRatio = 0.6): string[] {
  const items = listItemLines(text);
  if (items.length === 0) {
    return [];
  }
  const firstWords = items.map((line) => line.replace(/^\s*(?:[-*]|\d+\.)\s+/, '').split(/\s+/)[0] ?? '');
  const pastCount = firstWords.filter(looksPastTense).length;
  const ratio = pastCount / items.length;
  return ratio >= minRatio ? [] : [`only ${pastCount}/${items.length} items lead past-tense (< ${minRatio})`];
}

/** Structural stand-in for the pipeline's `CategorizedEntries`. */
interface CategoryGroup {
  category: string;
  entries: unknown[];
}

/** Flags a grouping that passes validation but is useless, e.g. everything in one category. */
export function checkCategoryDistribution(
  categories: CategoryGroup[],
  opts: { minCategories?: number; maxShare?: number } = {},
): string[] {
  const { minCategories = 2, maxShare = 0.8 } = opts;
  const total = categories.reduce((n, c) => n + c.entries.length, 0);
  if (total === 0) {
    return ['no categorized entries'];
  }

  const violations: string[] = [];
  const populated = categories.filter((c) => c.entries.length > 0);

  if (populated.length < minCategories) {
    violations.push(`only ${populated.length} populated categor(ies), expected >= ${minCategories}`);
  }

  const empty = categories.filter((c) => c.entries.length === 0).map((c) => c.category);
  if (empty.length > 0) {
    violations.push(`empty categories emitted: ${empty.join(', ')}`);
  }

  if (total >= 4) {
    const largest = populated.reduce<CategoryGroup | undefined>(
      (a, b) => (!a || b.entries.length > a.entries.length ? b : a),
      undefined,
    );
    if (largest && largest.entries.length / total > maxShare) {
      violations.push(`"${largest.category}" holds ${largest.entries.length}/${total} entries (> ${maxShare})`);
    }
  }

  return violations;
}

/**
 * Compared by identity (categories reuse the enhanced entry objects), since a drop and a duplicate
 * cancel out in a count.
 */
export function checkNoEntryLoss(categories: CategoryGroup[], entries: unknown[], expectedCount: number): string[] {
  const violations: string[] = [];
  if (entries.length !== expectedCount) {
    violations.push(`enhanced ${entries.length} entries, expected ${expectedCount}`);
  }

  const occurrences = new Map<unknown, number>();
  for (const group of categories) {
    for (const entry of group.entries) {
      occurrences.set(entry, (occurrences.get(entry) ?? 0) + 1);
    }
  }

  entries.forEach((entry, i) => {
    const n = occurrences.get(entry) ?? 0;
    if (n === 0) {
      violations.push(`entry ${i} was dropped from categorization`);
    } else if (n > 1) {
      violations.push(`entry ${i} was categorized ${n} times`);
    }
  });

  const known = new Set(entries);
  const strays = [...occurrences.keys()].filter((entry) => !known.has(entry)).length;
  if (strays > 0) {
    violations.push(`${strays} categorized entr(ies) are not among the enhanced entries`);
  }
  return violations;
}
