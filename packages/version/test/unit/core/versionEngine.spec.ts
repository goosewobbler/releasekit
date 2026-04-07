import { cwd as mockCwd } from 'node:process';
import { getPackagesSync, type Packages } from '@manypkg/get-packages';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VersionEngine } from '../../../src/core/versionEngine.js';
import * as strategyModule from '../../../src/core/versionStrategies.js';
import { VersionError } from '../../../src/errors/versionError.js';
import type { Config } from '../../../src/types.js';
import { log } from '../../../src/utils/logging.js';

// Mock dependencies
vi.mock('@manypkg/get-packages');
vi.mock('../../../src/core/versionStrategies.js');
vi.mock('../../../src/utils/logging.js');

// Mock the process module
vi.mock('node:process', () => ({
  cwd: vi.fn().mockReturnValue('/test/workspace'),
}));

describe('Version Engine', () => {
  // Mock strategies
  const syncStrategyMock = vi.fn().mockResolvedValue(undefined);
  const singleStrategyMock = vi.fn().mockResolvedValue(undefined);
  const asyncStrategyMock = vi.fn().mockResolvedValue(undefined);

  // Mock packages
  const mockPackages = {
    root: '/test/workspace',
    packages: [
      {
        dir: '/test/workspace/packages/a',
        packageJson: { name: 'package-a', version: '1.0.0' },
      },
      {
        dir: '/test/workspace/packages/b',
        packageJson: { name: 'package-b', version: '1.0.0' },
      },
    ],
  };

  // Default config for tests
  const defaultConfig: Partial<Config> = {
    preset: 'conventional-commits',
    sync: true,
    versionPrefix: 'v',
    tagTemplate: '${' + 'packageName}@${' + 'prefix}${' + 'version}',
    baseBranch: 'main',
    packages: [],
  };

  beforeEach(() => {
    // Reset all mocks
    vi.resetAllMocks();

    // Re-setup cwd mock after reset
    vi.mocked(mockCwd, { partial: true }).mockReturnValue('/test/workspace');

    // Setup strategy mocks
    vi.mocked(strategyModule.createSyncStrategy, { partial: true }).mockReturnValue(syncStrategyMock);
    vi.mocked(strategyModule.createSingleStrategy, { partial: true }).mockReturnValue(singleStrategyMock);
    vi.mocked(strategyModule.createAsyncStrategy, { partial: true }).mockReturnValue(asyncStrategyMock);
    vi.mocked(strategyModule.createStrategy, { partial: true }).mockReturnValue(syncStrategyMock);
    vi.mocked(strategyModule.createStrategyMap, { partial: true }).mockReturnValue({
      sync: syncStrategyMock,
      single: singleStrategyMock,
      async: asyncStrategyMock,
    });

    // Setup getPackagesSync mock
    vi.mocked(getPackagesSync, { partial: true }).mockReturnValue(mockPackages);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Constructor', () => {
    it('should throw if no config is provided', () => {
      expect(() => new VersionEngine(undefined as unknown as Config)).toThrow('Configuration is required');
    });

    it('should set default preset if not provided', () => {
      const config: Partial<Config> = {
        sync: true,
        versionPrefix: 'v',
        tagTemplate: '${' + 'packageName}@${' + 'prefix}${' + 'version}',
        baseBranch: 'main',
        packages: [],
      };

      // Create engine and ignore it to avoid the unused variable warning
      void new VersionEngine(config as Config);

      expect(log).toHaveBeenCalledWith('No preset specified, using default: conventional-commits', 'warning');
    });

    it('should initialize strategies based on config', () => {
      // Create engine and use it to ensure it's not an unused variable
      const engine = new VersionEngine(defaultConfig as Config);

      // Access a property to make the linter happy that we're using engine
      expect(engine).toBeInstanceOf(VersionEngine);
      expect(strategyModule.createStrategyMap).toHaveBeenCalledWith(defaultConfig as Config);
      expect(strategyModule.createStrategy).toHaveBeenCalledWith(defaultConfig as Config);
    });

    it('should not mutate the caller config when runOptions are provided', () => {
      const config: Config = { ...defaultConfig } as Config;
      new VersionEngine(config, { bump: 'major', dryRun: true, targets: ['pkg-a'] });

      // Original config must be unchanged
      expect(config.type).toBeUndefined();
      expect(config.dryRun).toBeUndefined();
      expect(config.packages).toEqual([]);
    });

    it('should apply bump, dryRun and targets from runOptions to effective config', () => {
      new VersionEngine(defaultConfig as Config, { bump: 'minor', dryRun: true, targets: ['pkg-a', 'pkg-b'] });

      expect(strategyModule.createStrategyMap).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'minor', dryRun: true, packages: ['pkg-a', 'pkg-b'] }),
      );
    });

    it('should apply prerelease string identifier from runOptions', () => {
      new VersionEngine(defaultConfig as Config, { prerelease: 'beta' });

      expect(strategyModule.createStrategyMap).toHaveBeenCalledWith(
        expect.objectContaining({ prereleaseIdentifier: 'beta', isPrerelease: true }),
      );
    });

    it('should normalize prerelease: true to identifier "next"', () => {
      new VersionEngine(defaultConfig as Config, { prerelease: true });

      expect(strategyModule.createStrategyMap).toHaveBeenCalledWith(
        expect.objectContaining({ prereleaseIdentifier: 'next', isPrerelease: true }),
      );
    });

    it('should apply stable from runOptions as stableOnly on effective config', () => {
      new VersionEngine(defaultConfig as Config, { stable: true });

      expect(strategyModule.createStrategyMap).toHaveBeenCalledWith(expect.objectContaining({ stableOnly: true }));
    });
  });

  describe('getWorkspacePackages', () => {
    it('should return all packages when no packages filter is specified', async () => {
      const engine = new VersionEngine(defaultConfig as Config);
      const result = await engine.getWorkspacePackages();

      expect(result).toEqual(mockPackages);
      expect(getPackagesSync).toHaveBeenCalledWith('/test/workspace');
    });

    it('should filter packages based on packages config', async () => {
      const config = {
        ...defaultConfig,
        packages: ['package-a'],
      };
      const engine = new VersionEngine(config as Config);
      const result = await engine.getWorkspacePackages();

      expect(result.packages).toHaveLength(1);
      expect(result.packages[0].packageJson.name).toBe('package-a');
    });

    it('should resolve path patterns like "./" to root package name', async () => {
      const mockPackagesWithRoot = {
        root: '/test/workspace',
        packages: [
          {
            dir: '/test/workspace',
            packageJson: { name: 'root-package', version: '1.0.0' },
          },
          {
            dir: '/test/workspace/packages/a',
            packageJson: { name: 'package-a', version: '1.0.0' },
          },
        ],
      };

      vi.mocked(getPackagesSync, { partial: true }).mockReturnValue(mockPackagesWithRoot);

      const config = {
        ...defaultConfig,
        packages: ['./'],
      };
      const engine = new VersionEngine(config as Config);
      const result = await engine.getWorkspacePackages();

      expect(result.packages).toHaveLength(1);
      expect(result.packages[0].packageJson.name).toBe('root-package');
      expect(log).toHaveBeenCalledWith('Filtered 2 workspace packages to 1 based on packages config', 'info');
    });

    it('should resolve path patterns like "." to root package name', async () => {
      const mockPackagesWithRoot = {
        root: '/test/workspace',
        packages: [
          {
            dir: '/test/workspace',
            packageJson: { name: 'root-package', version: '1.0.0' },
          },
          {
            dir: '/test/workspace/packages/a',
            packageJson: { name: 'package-a', version: '1.0.0' },
          },
        ],
      };

      vi.mocked(getPackagesSync, { partial: true }).mockReturnValue(mockPackagesWithRoot);

      const config = {
        ...defaultConfig,
        packages: ['.'],
      };
      const engine = new VersionEngine(config as Config);
      const result = await engine.getWorkspacePackages();

      expect(result.packages).toHaveLength(1);
      expect(result.packages[0].packageJson.name).toBe('root-package');
      expect(log).toHaveBeenCalledWith('Filtered 2 workspace packages to 1 based on packages config', 'info');
    });

    it('should cache workspace packages for subsequent calls', async () => {
      const engine = new VersionEngine(defaultConfig as Config);
      await engine.getWorkspacePackages();
      await engine.getWorkspacePackages();

      // getPackagesSync should only be called once due to caching
      expect(getPackagesSync).toHaveBeenCalledTimes(1);
    });

    it('should handle missing root property by setting it to cwd', async () => {
      const mockPackagesWithoutRoot = {
        packages: [
          {
            dir: '/test/workspace/packages/a',
            packageJson: { name: 'package-a', version: '1.0.0' },
          },
        ],
      } as Packages;

      vi.mocked(getPackagesSync, { partial: true }).mockReturnValue(mockPackagesWithoutRoot);

      const engine = new VersionEngine(defaultConfig as Config);
      const result = await engine.getWorkspacePackages();

      expect(result.root).toBe('/test/workspace');
      expect(log).toHaveBeenCalledWith(
        'Root path is undefined in packages result, setting to current working directory',
        'warning',
      );
    });

    it('should throw error when getPackagesSync fails', async () => {
      const error = new Error('Failed to get packages');
      vi.mocked(getPackagesSync, { partial: true }).mockImplementation(() => {
        throw error;
      });

      const engine = new VersionEngine(defaultConfig as Config);

      await expect(engine.getWorkspacePackages()).rejects.toThrow(VersionError);
      expect(log).toHaveBeenCalledWith('Failed to get packages information: Failed to get packages', 'error');
    });

    it('should log filtering results when packages config is specified', async () => {
      const mockPackagesForFiltering = {
        root: '/test/workspace',
        packages: [
          {
            dir: '/test/workspace/packages/a',
            packageJson: { name: 'package-a', version: '1.0.0' },
          },
          {
            dir: '/test/workspace/packages/b',
            packageJson: { name: 'package-b', version: '1.0.0' },
          },
        ],
      };

      vi.mocked(getPackagesSync, { partial: true }).mockReturnValue(mockPackagesForFiltering);

      const config = {
        ...defaultConfig,
        packages: ['package-a'],
      };
      const engine = new VersionEngine(config as Config);
      await engine.getWorkspacePackages();

      expect(log).toHaveBeenCalledWith('Filtered 2 workspace packages to 1 based on packages config', 'info');
    });

    it('should warn when no packages match the specified patterns', async () => {
      const config = {
        ...defaultConfig,
        packages: ['non-existent-package'],
      };
      const engine = new VersionEngine(config as Config);
      await engine.getWorkspacePackages();

      expect(log).toHaveBeenCalledWith(
        'Warning: No packages matched the specified patterns in config.packages',
        'warning',
      );
    });
  });

  describe('Run method', () => {
    it('should get workspace packages and execute the current strategy', async () => {
      const engine = new VersionEngine(defaultConfig as Config);
      await engine.run(mockPackages);
      expect(syncStrategyMock).toHaveBeenCalledWith(mockPackages, []);
    });

    it('should pass targets to the strategy function', async () => {
      const engine = new VersionEngine(defaultConfig as Config);
      const targets = ['package-a'];
      await engine.run(mockPackages, targets);
      expect(syncStrategyMock).toHaveBeenCalledWith(mockPackages, targets);
    });

    it('should propagate errors thrown by the strategy', async () => {
      const error = new Error('Strategy failed');
      syncStrategyMock.mockRejectedValue(error);
      const engine = new VersionEngine(defaultConfig as Config);
      await expect(engine.run(mockPackages)).rejects.toThrow('Strategy failed');
    });

    it('should cache workspace packages for subsequent calls', async () => {
      const engine = new VersionEngine(defaultConfig as Config);
      await engine.getWorkspacePackages();
      await engine.getWorkspacePackages();

      // getPackagesSync should only be called once due to caching
      expect(getPackagesSync).toHaveBeenCalledTimes(1);
    });

    it('should handle error if getPackagesSync throws', async () => {
      const error = new Error('Failed to get packages');
      vi.mocked(getPackagesSync, { partial: true }).mockImplementation(() => {
        throw error;
      });

      const engine = new VersionEngine(defaultConfig as Config);

      await expect(engine.getWorkspacePackages()).rejects.toThrow(VersionError);
      expect(log).toHaveBeenCalledWith(expect.stringContaining('Failed to get packages information'), 'error');
    });

    it('should process all packages', async () => {
      const engine = new VersionEngine(defaultConfig as Config);
      await engine.run(mockPackages);
      expect(syncStrategyMock).toHaveBeenCalledWith(mockPackages, []);
    });
  });

  describe('Set Strategy method', () => {
    it('should change the current strategy', async () => {
      const engine = new VersionEngine(defaultConfig as Config);

      // Initially sync strategy should be used
      await engine.run(mockPackages);
      expect(syncStrategyMock).toHaveBeenCalled();

      // Change to async strategy
      engine.setStrategy('async');
      syncStrategyMock.mockClear();

      // Now async strategy should be used
      await engine.run(mockPackages);
      expect(syncStrategyMock).not.toHaveBeenCalled();
      expect(asyncStrategyMock).toHaveBeenCalled();
    });
  });
});
