import { describe, expect, it } from 'vitest';
import {
  matchesPackageTarget,
  shouldMatchPackageTargets,
  shouldProcessPackage,
} from '../../../src/utils/packageMatching.js';

describe('Package Matching Utils', () => {
  describe('matchesPackageTarget', () => {
    it('should match exact package names', () => {
      expect(matchesPackageTarget('@scope/package-name', '@scope/package-name')).toBe(true);
      expect(matchesPackageTarget('unscoped-package', 'unscoped-package')).toBe(true);
      expect(matchesPackageTarget('@scope/package-name', '@different/package-name')).toBe(false);
    });

    it('should match scoped wildcards', () => {
      expect(matchesPackageTarget('@scope/package-a', '@scope/*')).toBe(true);
      expect(matchesPackageTarget('@scope/nested/package', '@scope/*')).toBe(true);
      expect(matchesPackageTarget('@different/package', '@scope/*')).toBe(false);
      expect(matchesPackageTarget('unscoped-package', '@scope/*')).toBe(false);
    });

    it('should match glob patterns', () => {
      // Test directory-based patterns
      expect(matchesPackageTarget('packages/pkg-a', 'packages/**/*')).toBe(true);
      expect(matchesPackageTarget('packages/nested/pkg-b', 'packages/**/*')).toBe(true);
      expect(matchesPackageTarget('packages/@scope/pkg-c', 'packages/**/*')).toBe(true);
      expect(matchesPackageTarget('other/pkg-d', 'packages/**/*')).toBe(false);

      // Test scoped package patterns
      expect(matchesPackageTarget('@wdio/pkg-a', '@wdio/**/*')).toBe(true);
      expect(matchesPackageTarget('@wdio/nested/pkg-b', '@wdio/**/*')).toBe(true);
      expect(matchesPackageTarget('@other/pkg-c', '@wdio/**/*')).toBe(false);
    });

    it('should handle invalid patterns gracefully', () => {
      expect(matchesPackageTarget('@scope/package', '[invalid-pattern')).toBe(false);
    });
  });

  describe('shouldMatchPackageTargets', () => {
    it('should match if any target pattern matches', () => {
      const targets = ['@scope/*', 'packages/**/*', 'specific-package'];

      expect(shouldMatchPackageTargets('@scope/package-a', targets)).toBe(true);
      expect(shouldMatchPackageTargets('packages/nested/pkg', targets)).toBe(true);
      expect(shouldMatchPackageTargets('specific-package', targets)).toBe(true);
      expect(shouldMatchPackageTargets('unmatched-package', targets)).toBe(false);
    });

    it('should handle empty targets array', () => {
      expect(shouldMatchPackageTargets('any-package', [])).toBe(false);
    });
  });

  describe('shouldProcessPackage', () => {
    it('should return true if package is not in skip list', () => {
      expect(shouldProcessPackage('package-a', [])).toBe(true);
      expect(shouldProcessPackage('package-a', ['package-b'])).toBe(true);
    });

    it('should return false if package is in skip list', () => {
      expect(shouldProcessPackage('package-a', ['package-a'])).toBe(false);
    });

    it('should handle undefined skip list', () => {
      expect(shouldProcessPackage('package-a')).toBe(true);
    });
  });
});
