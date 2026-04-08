import { describe, expect, it } from 'vitest';
import { sanitizePackageName } from '../../src/utils.js';

describe('utils', () => {
  describe('sanitizePackageName', () => {
    it('should convert scoped package name to tag-safe string', () => {
      expect(sanitizePackageName('@releasekit/core')).toBe('releasekit-core');
      expect(sanitizePackageName('@scope/pkg')).toBe('scope-pkg');
    });

    it('should return non-scoped package name unchanged', () => {
      expect(sanitizePackageName('my-package')).toBe('my-package');
      expect(sanitizePackageName('pkg')).toBe('pkg');
    });

    it('should handle empty string', () => {
      expect(sanitizePackageName('')).toBe('');
    });

    it('should handle special characters', () => {
      expect(sanitizePackageName('@scope/pkg-name')).toBe('scope-pkg-name');
      expect(sanitizePackageName('@scope/pkg_name')).toBe('scope-pkg_name');
    });
  });
});
