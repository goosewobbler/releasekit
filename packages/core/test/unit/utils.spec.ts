import { describe, expect, it } from 'vitest';
import { assertNotOption, sanitizePackageName } from '../../src/utils.js';

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

  describe('assertNotOption', () => {
    it('should throw for a value starting with a dash', () => {
      expect(() => assertNotOption('-rf', 'tag')).toThrow(/looks like an option/);
      expect(() => assertNotOption('--repo=evil', 'tag')).toThrow(/tag '--repo=evil'/);
    });

    it('should include the kind in the error message', () => {
      expect(() => assertNotOption('-x', 'ref')).toThrow(/ref '-x'/);
    });

    it('should not throw for values that do not start with a dash', () => {
      expect(() => assertNotOption('v1.0.0', 'tag')).not.toThrow();
      expect(() => assertNotOption('@scope/pkg@v1.0.0', 'tag')).not.toThrow();
      expect(() => assertNotOption('', 'tag')).not.toThrow();
      // An interior dash is fine — only a leading dash is parsed as a flag.
      expect(() => assertNotOption('release-v1.0.0', 'tag')).not.toThrow();
    });
  });
});
