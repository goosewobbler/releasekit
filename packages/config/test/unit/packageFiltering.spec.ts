import type { Package } from '@manypkg/get-packages';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the logger
vi.mock('@releasekit/core', () => ({
  log: vi.fn(),
  matchesPackageTarget: vi.fn(),
}));

// Import after mocking
import { log, matchesPackageTarget } from '@releasekit/core';
import { filterPackagesByConfig } from '../../src/packageFiltering.js';

// Helper to create mock packages
function createMockPackage(name: string, dir: string, isPrivate = false): Package {
  const relativeDir = dir.replace('/workspace/', '');
  return {
    dir,
    relativeDir,
    packageJson: {
      name,
      version: '1.0.0',
      ...(isPrivate && { private: true }),
    },
  };
}

describe('filterPackagesByConfig', () => {
  const workspaceRoot = '/workspace';
  const mockPackages = [
    createMockPackage('@scope/pkg-a', '/workspace/packages/pkg-a'),
    createMockPackage('@scope/pkg-b', '/workspace/packages/pkg-b'),
    createMockPackage('@scope/pkg-c', '/workspace/packages/pkg-c'),
    createMockPackage('root-pkg', '/workspace'),
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('when no config targets are specified', () => {
    it('should return all non-private packages and warn about private ones', () => {
      const packages = [...mockPackages, createMockPackage('private-pkg', '/workspace/private', true)];

      const result = filterPackagesByConfig(packages, [], workspaceRoot);

      expect(result).toHaveLength(4); // All except the private one
      expect(result.map((p) => p.packageJson.name)).toEqual([
        '@scope/pkg-a',
        '@scope/pkg-b',
        '@scope/pkg-c',
        'root-pkg',
      ]);

      expect(log).toHaveBeenCalledWith('No config targets specified, returning all non-private packages', 'debug');
      expect(log).toHaveBeenCalledWith('Package "private-pkg" is private and will be excluded from release', 'warn');
    });

    it('should return empty array when all packages are private', () => {
      const packages = [
        createMockPackage('private-pkg-1', '/workspace/private1', true),
        createMockPackage('private-pkg-2', '/workspace/private2', true),
      ];

      const result = filterPackagesByConfig(packages, [], workspaceRoot);

      expect(result).toHaveLength(0);
      expect(log).toHaveBeenCalledWith('No config targets specified, returning all non-private packages', 'debug');
      expect(log).toHaveBeenCalledWith('Package "private-pkg-1" is private and will be excluded from release', 'warn');
      expect(log).toHaveBeenCalledWith('Package "private-pkg-2" is private and will be excluded from release', 'warn');
    });
  });

  describe('when config targets are specified', () => {
    it('should filter packages by directory patterns and exclude private matches', () => {
      vi.mocked(matchesPackageTarget).mockReturnValue(false); // No name matches

      const result = filterPackagesByConfig(mockPackages, ['packages/*'], workspaceRoot);

      expect(result).toHaveLength(3);
      expect(result.map((p) => p.packageJson.name)).toEqual(['@scope/pkg-a', '@scope/pkg-b', '@scope/pkg-c']);

      expect(log).not.toHaveBeenCalledWith('No config targets specified, returning all non-private packages', 'debug');
    });

    it('should include private packages when explicitly matched by a target', () => {
      vi.mocked(matchesPackageTarget).mockImplementation((name, pattern) => {
        if (pattern === '@scope/*') {
          return name.startsWith('@scope/');
        }
        return false;
      });

      const packagesWithPrivate = [
        ...mockPackages,
        createMockPackage('@scope/private-pkg', '/workspace/packages/private', true),
      ];

      const result = filterPackagesByConfig(packagesWithPrivate, ['@scope/*'], workspaceRoot);

      // private packages matched by explicit targets are included; npm-publish handles skipping them
      expect(result).toHaveLength(4);
      expect(result.map((p) => p.packageJson.name)).toContain('@scope/private-pkg');
    });

    it('should include a pure Rust package (synthetic private:true) when explicitly targeted', () => {
      vi.mocked(matchesPackageTarget).mockImplementation((name, pattern) => {
        return pattern === 'my-crate' && name === 'my-crate';
      });

      const rustPkg = createMockPackage('my-crate', '/workspace/crates/my-crate', true);
      const result = filterPackagesByConfig([...mockPackages, rustPkg], ['my-crate'], workspaceRoot);

      expect(result.map((p) => p.packageJson.name)).toContain('my-crate');
    });

    it('should include a hybrid npm+cargo package with private:true when explicitly targeted', () => {
      vi.mocked(matchesPackageTarget).mockImplementation((name, pattern) => {
        return pattern === '@scope/hybrid' && name === '@scope/hybrid';
      });

      const hybridPkg = createMockPackage('@scope/hybrid', '/workspace/packages/hybrid', true);
      const result = filterPackagesByConfig([...mockPackages, hybridPkg], ['@scope/hybrid'], workspaceRoot);

      expect(result.map((p) => p.packageJson.name)).toContain('@scope/hybrid');
    });

    it('should handle exact directory matches', () => {
      vi.mocked(matchesPackageTarget).mockReturnValue(false);

      const result = filterPackagesByConfig(mockPackages, ['./'], workspaceRoot);

      expect(result).toHaveLength(1);
      expect(result[0].packageJson.name).toBe('root-pkg');
    });

    it('should combine directory and name pattern matches', () => {
      vi.mocked(matchesPackageTarget).mockImplementation((name, pattern) => {
        return pattern === '@scope/pkg-a' && name === '@scope/pkg-a';
      });

      const result = filterPackagesByConfig(mockPackages, ['packages/*', '@scope/pkg-a'], workspaceRoot);

      expect(result).toHaveLength(3); // All in packages/ plus the explicit name match
      expect(result.map((p) => p.packageJson.name).sort()).toEqual(['@scope/pkg-a', '@scope/pkg-b', '@scope/pkg-c']);
    });

    it('should deduplicate packages matched by multiple patterns', () => {
      vi.mocked(matchesPackageTarget).mockImplementation((name, pattern) => {
        return pattern === '@scope/pkg-a' && name === '@scope/pkg-a';
      });

      const result = filterPackagesByConfig(mockPackages, ['packages/*', '@scope/pkg-a'], workspaceRoot);

      expect(result).toHaveLength(3); // Not 4, because pkg-a is matched by both patterns but deduplicated
    });
  });
});
