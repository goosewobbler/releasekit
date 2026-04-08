import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('minimatch', async (importOriginal) => {
  const actual = await importOriginal<typeof import('minimatch')>();
  return {
    minimatch: vi.fn((...args: Parameters<typeof actual.minimatch>) => actual.minimatch(...args)),
  };
});

import { minimatch } from 'minimatch';
import { matchesPackageTarget, shouldMatchPackageTargets, shouldProcessPackage } from '../../src/packageUtils.js';

describe('packageUtils', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('matchesPackageTarget', () => {
    it('should return true for exact package name match', () => {
      expect(matchesPackageTarget('@releasekit/core', '@releasekit/core')).toBe(true);
    });

    it('should return true for scope wildcard pattern', () => {
      expect(matchesPackageTarget('@releasekit/core', '@releasekit/*')).toBe(true);
      expect(matchesPackageTarget('@releasekit/notes', '@releasekit/*')).toBe(true);
      expect(matchesPackageTarget('@other/pkg', '@releasekit/*')).toBe(false);
    });

    it('should return true for scoped glob pattern', () => {
      expect(matchesPackageTarget('@releasekit/core', '@releasekit/**/*')).toBe(true);
      expect(matchesPackageTarget('@releasekit/notes', '@releasekit/**/*')).toBe(true);
      expect(matchesPackageTarget('@other/pkg', '@releasekit/**/*')).toBe(false);
    });

    it('should return true for unscoped wildcard (using **)', () => {
      expect(matchesPackageTarget('@releasekit/core', '**/*')).toBe(true);
      expect(matchesPackageTarget('some-pkg', '*')).toBe(true);
    });

    it('should handle invalid minimatch patterns gracefully', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      vi.mocked(minimatch).mockImplementationOnce(() => {
        throw new Error('simulated minimatch failure');
      });

      // Pattern must reach minimatch (not exact match or @scope/* shortcut)
      const result = matchesPackageTarget('test-pkg', 'pkg-*');

      expect(result).toBe(false);
      expect(minimatch).toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it('should handle empty strings', () => {
      expect(matchesPackageTarget('', 'pkg')).toBe(false);
      expect(matchesPackageTarget('pkg', '')).toBe(false);
    });
  });

  describe('shouldMatchPackageTargets', () => {
    it('should return true if any target matches', () => {
      expect(shouldMatchPackageTargets('@releasekit/core', ['@releasekit/notes', '@releasekit/core'])).toBe(true);
    });

    it('should return false if no targets match', () => {
      expect(shouldMatchPackageTargets('@releasekit/core', ['@releasekit/notes', '@other/pkg'])).toBe(false);
    });

    it('should handle empty targets array', () => {
      expect(shouldMatchPackageTargets('@releasekit/core', [])).toBe(false);
    });

    it('should work with multiple targets', () => {
      expect(shouldMatchPackageTargets('@releasekit/core', ['@releasekit/*', '@other/*'])).toBe(true);
      expect(shouldMatchPackageTargets('@other/pkg', ['@releasekit/*', '@other/*'])).toBe(true);
      expect(shouldMatchPackageTargets('@other/pkg', ['@releasekit/*', '@another/*'])).toBe(false);
    });
  });

  describe('shouldProcessPackage', () => {
    it('should return true when skip list is empty', () => {
      expect(shouldProcessPackage('@releasekit/core', [])).toBe(true);
    });

    it('should return false when package is in skip list', () => {
      expect(shouldProcessPackage('@releasekit/core', ['@releasekit/core'])).toBe(false);
    });

    it('should return false when skip pattern matches via wildcard', () => {
      expect(shouldProcessPackage('@releasekit/core', ['@releasekit/*'])).toBe(false);
      expect(shouldProcessPackage('@releasekit/notes', ['@releasekit/*'])).toBe(false);
    });

    it('should return true when no skip patterns match', () => {
      expect(shouldProcessPackage('@releasekit/core', ['@other/*'])).toBe(true);
    });

    it('should handle multiple skip patterns', () => {
      expect(shouldProcessPackage('@releasekit/core', ['@other/*', '@releasekit/notes'])).toBe(true);
      expect(shouldProcessPackage('@releasekit/notes', ['@other/*', '@releasekit/notes'])).toBe(false);
    });
  });
});
