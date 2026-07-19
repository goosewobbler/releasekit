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

    it('should resolve the dist-tag per package in a mixed (stable + prerelease) release', () => {
      // A standing PR with permanently-mixed maturity publishes each package on its own channel.
      // getDistTag is per-version, so the same run yields `latest` for the stable packages and the
      // prerelease identifier for the `-next` ones with no extra wiring.
      const versions = ['10.2.0', '1.1.0-next.0', '2.0.0', '0.3.0-beta.4'];
      expect(versions.map((v) => getDistTag(v, 'latest'))).toEqual(['latest', 'next', 'latest', 'beta']);
    });
  });
});
