import { describe, expect, it } from 'vitest';
import { getDistTag, isPrerelease } from '../../../src/utils/semver.js';

describe('semver utils', () => {
  describe('isPrerelease', () => {
    it('should return false for stable versions', () => {
      expect(isPrerelease('1.0.0')).toBe(false);
      expect(isPrerelease('0.1.0')).toBe(false);
      expect(isPrerelease('10.20.30')).toBe(false);
    });

    it('should return true for pre-release versions', () => {
      expect(isPrerelease('1.0.0-next.1')).toBe(true);
      expect(isPrerelease('1.0.0-beta.2')).toBe(true);
      expect(isPrerelease('1.0.0-rc.1')).toBe(true);
      expect(isPrerelease('1.0.0-alpha.0')).toBe(true);
    });
  });

  describe('getDistTag', () => {
    it('should return "latest" for stable versions', () => {
      expect(getDistTag('1.0.0')).toBe('latest');
      expect(getDistTag('2.3.4')).toBe('latest');
    });

    it('should extract pre-release identifier as dist-tag', () => {
      expect(getDistTag('1.0.0-next.1')).toBe('next');
      expect(getDistTag('1.0.0-beta.2')).toBe('beta');
      expect(getDistTag('1.0.0-rc.1')).toBe('rc');
      expect(getDistTag('1.0.0-alpha.0')).toBe('alpha');
    });

    it('should return "next" for numeric-only pre-release', () => {
      expect(getDistTag('1.0.0-0')).toBe('next');
    });

    it('should use custom default tag', () => {
      expect(getDistTag('1.0.0', 'stable')).toBe('stable');
    });
  });
});
