import { describe, expect, it } from 'vitest';
import {
  checkCategoryDistribution,
  checkLengthBounds,
  checkNoEntryLoss,
  checkPastTenseLeaning,
  findDuplicateDependencyChurn,
  findMarkerLeaks,
} from './assertions.js';

/**
 * The eval assertions are the regression net, so each needs a case that actually trips it. A net that
 * only ever returns `[]` would pass every eval run while catching nothing.
 */
describe('eval assertions', () => {
  const group = (category: string, n: number) => ({ category, entries: Array.from({ length: n }, (_, i) => i) });

  describe('findMarkerLeaks', () => {
    it('should catch an internal marker leaking into user-facing notes', () => {
      expect(findMarkerLeaks('## Notes\n<!-- releasekit-notes -->\nText')).toEqual(['<!-- releasekit-notes -->']);
    });

    it('should pass clean notes and unrelated HTML comments', () => {
      expect(findMarkerLeaks('## Notes\n<!-- just a note -->\nText')).toEqual([]);
    });
  });

  describe('findDuplicateDependencyChurn', () => {
    it('should catch a restated dependency line', () => {
      expect(findDuplicateDependencyChurn('- Updated dependencies\n- Updated dependencies for core')).toHaveLength(2);
    });

    it('should allow a single dependency line', () => {
      expect(findDuplicateDependencyChurn('- Updated dependencies')).toEqual([]);
    });
  });

  describe('checkLengthBounds', () => {
    it('should catch a truncated and a runaway generation', () => {
      expect(checkLengthBounds('tiny', 80, 4000)).toHaveLength(1);
      expect(checkLengthBounds('x'.repeat(5000), 80, 4000)).toHaveLength(1);
      expect(checkLengthBounds('x'.repeat(100), 80, 4000)).toEqual([]);
    });
  });

  describe('checkPastTenseLeaning', () => {
    it('should catch imperative-mood items', () => {
      expect(checkPastTenseLeaning('- Add streaming\n- Fix a crash\n- Improve errors')).toHaveLength(1);
    });

    it('should accept past-tense items in bullet or numbered form', () => {
      expect(checkPastTenseLeaning('- Added streaming\n- Fixed a crash')).toEqual([]);
      expect(checkPastTenseLeaning('1. Added streaming\n2. Fixed a crash')).toEqual([]);
    });

    it('should not judge prose with no list items', () => {
      expect(checkPastTenseLeaning('This release adds streaming support.')).toEqual([]);
    });
  });

  describe('checkCategoryDistribution', () => {
    it('should catch every entry dumped into one category', () => {
      // The task validator accepts this — "Changed" is a legal name — so only this check sees it.
      expect(checkCategoryDistribution([group('Changed', 6)])).not.toEqual([]);
    });

    it('should catch one category swallowing most entries', () => {
      expect(checkCategoryDistribution([group('Changed', 9), group('Fixed', 1)])).not.toEqual([]);
    });

    it('should catch an emitted-but-empty category', () => {
      const violations = checkCategoryDistribution([group('New', 3), group('Fixed', 3), group('Removed', 0)]);
      expect(violations.some((v) => v.includes('Removed'))).toBe(true);
    });

    it('should catch nothing categorized at all', () => {
      expect(checkCategoryDistribution([])).toEqual(['no categorized entries']);
    });

    it('should accept a genuinely spread grouping', () => {
      expect(checkCategoryDistribution([group('New', 2), group('Fixed', 2), group('Changed', 2)])).toEqual([]);
    });

    it('should not apply the share bound to a set too small to spread', () => {
      // 2 of 3 in one bucket exceeds maxShare, but with three entries that is not evidence of laziness.
      expect(checkCategoryDistribution([group('New', 2), group('Fixed', 1)])).toEqual([]);
    });
  });

  describe('checkNoEntryLoss', () => {
    const [a, b, c] = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    const bucket = (category: string, entries: object[]) => ({ category, entries });

    it('should catch a dropped entry', () => {
      expect(checkNoEntryLoss([bucket('New', [a, b])], [a, b, c], 3)).toEqual([
        'entry 2 was dropped from categorization',
      ]);
    });

    it('should catch an entry categorized twice', () => {
      expect(checkNoEntryLoss([bucket('New', [a, b]), bucket('Fixed', [b, c])], [a, b, c], 3)).toEqual([
        'entry 1 was categorized 2 times',
      ]);
    });

    it('should catch a drop and a duplicate that cancel out in a total', () => {
      // Three entries in, three bucketed — a count-only check passes this.
      expect(checkNoEntryLoss([bucket('New', [a, c]), bucket('Fixed', [c])], [a, b, c], 3)).toEqual([
        'entry 1 was dropped from categorization',
        'entry 2 was categorized 2 times',
      ]);
    });

    it('should catch enhancement dropping an entry before grouping', () => {
      expect(checkNoEntryLoss([bucket('New', [a, b])], [a, b], 3)).toEqual(['enhanced 2 entries, expected 3']);
    });

    it('should catch a bucketed entry that is not an enhanced entry', () => {
      expect(checkNoEntryLoss([bucket('New', [a, b, { id: 'a' }])], [a, b], 2)).toEqual([
        '1 categorized entr(ies) are not among the enhanced entries',
      ]);
    });

    it('should report copied entries as a broken identity assumption, not as data loss', () => {
      const copies = [{ ...a }, { ...b }, { ...c }];
      expect(checkNoEntryLoss([bucket('New', copies)], [a, b, c], 3)).toEqual([
        'categories hold copies of 3 enhanced entr(ies), not the same objects — this check compares by identity, so compare by content instead',
      ]);
    });

    it('should report a partial copy as a copy', () => {
      expect(checkNoEntryLoss([bucket('New', [a, { ...b }, c])], [a, b, c], 3)).toEqual([
        'categories hold copies of 1 enhanced entr(ies), not the same objects — this check compares by identity, so compare by content instead',
      ]);
    });

    it('should not call different objects copies — bucketing the wrong entries is a real loss', () => {
      // e.g. grouping the un-enhanced input instead of the enhanced entries
      expect(checkNoEntryLoss([bucket('New', [{ id: 'x' }, { id: 'y' }, { id: 'z' }])], [a, b, c], 3)).toEqual([
        'entry 0 was dropped from categorization',
        'entry 1 was dropped from categorization',
        'entry 2 was dropped from categorization',
        '3 categorized entr(ies) are not among the enhanced entries',
      ]);
    });

    it('should not let a copy hide a real drop', () => {
      // One entry copied, another genuinely gone: not a clean copy, so both read as loss.
      expect(checkNoEntryLoss([bucket('New', [a, { ...b }])], [a, b, c], 3)).toEqual([
        'entry 1 was dropped from categorization',
        'entry 2 was dropped from categorization',
        '1 categorized entr(ies) are not among the enhanced entries',
      ]);
    });

    it('should match a copy whose keys were rebuilt in another order', () => {
      const entry = { id: 'a', scope: 'api' };
      expect(checkNoEntryLoss([bucket('New', [{ scope: 'api', id: 'a' }])], [entry], 1)).toEqual([
        'categories hold copies of 1 enhanced entr(ies), not the same objects — this check compares by identity, so compare by content instead',
      ]);
    });

    it('should not call a duplicated copy a clean copy', () => {
      const copy = { ...b };
      expect(checkNoEntryLoss([bucket('New', [a, copy, c]), bucket('Fixed', [copy])], [a, b, c], 3)).toEqual([
        'entry 1 was dropped from categorization',
        '1 categorized entr(ies) are not among the enhanced entries',
      ]);
    });

    it('should accept every entry surviving exactly once', () => {
      expect(checkNoEntryLoss([bucket('New', [a, b]), bucket('Fixed', [c])], [a, b, c], 3)).toEqual([]);
    });
  });
});
