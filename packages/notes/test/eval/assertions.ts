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

/** Extract markdown bullet lines (`- …` / `* …`). */
export function bulletLines(text: string): string[] {
  return text.split('\n').filter((line) => /^\s*[-*]\s+\S/.test(line));
}

/**
 * The style guides all mandate past tense ("Added feature", not "Add feature"). Check that a majority
 * of bullets lead with a past-tense verb — a ratio, not all-or-nothing, since a bullet may legitimately
 * open with a proper noun or an API name.
 */
export function checkPastTenseLeaning(text: string, minRatio = 0.6): string[] {
  const bullets = bulletLines(text);
  if (bullets.length === 0) return [];
  const firstWords = bullets.map((line) => line.replace(/^\s*[-*]\s+/, '').split(/\s+/)[0] ?? '');
  const pastCount = firstWords.filter(looksPastTense).length;
  const ratio = pastCount / bullets.length;
  return ratio >= minRatio ? [] : [`only ${pastCount}/${bullets.length} bullets lead past-tense (< ${minRatio})`];
}
