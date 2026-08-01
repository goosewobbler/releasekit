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
    it('should catch dropped and duplicated entries', () => {
      expect(checkNoEntryLoss([group('New', 2)], 3)).toHaveLength(1);
      expect(checkNoEntryLoss([group('New', 2), group('Fixed', 2)], 3)).toHaveLength(1);
    });

    it('should accept every entry surviving exactly once', () => {
      expect(checkNoEntryLoss([group('New', 2), group('Fixed', 1)], 3)).toEqual([]);
    });
  });
});
