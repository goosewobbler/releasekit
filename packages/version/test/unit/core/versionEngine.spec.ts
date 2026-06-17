import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { cwd as mockCwd } from 'node:process';
import { getPackagesSync } from '@manypkg/get-packages';
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
    rootDir: '/test/workspace',
    tool: 'pnpm' as any,
    packages: [
      {
        dir: '/test/workspace/packages/a',
        relativeDir: 'packages/a',
        packageJson: { name: 'package-a', version: '1.0.0' },
      },
      {
        dir: '/test/workspace/packages/b',
        relativeDir: 'packages/b',
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

    it('should apply bump, dryRun and targets from runOptions (targets stored separately, not in config)', () => {
      new VersionEngine(defaultConfig as Config, { bump: 'minor', dryRun: true, targets: ['pkg-a', 'pkg-b'] });

      // Targets are stored separately in runtimeTargets, not in config.packages
      // so createStrategyMap receives the original config.packages (empty array)
      expect(strategyModule.createStrategyMap).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'minor', dryRun: true, packages: [] }),
      );
    });

    it('should apply prerelease string identifier from runOptions', () => {
      new VersionEngine(defaultConfig as Config, { prerelease: 'beta' });

      expect(strategyModule.createStrategyMap).toHaveBeenCalledWith(
        expect.objectContaining({ prereleaseIdentifier: 'beta', isPrerelease: true }),
      );
    });

    it('should use configured identifier when prerelease: true', () => {
      const configWithAlpha = { ...defaultConfig, prereleaseIdentifier: 'alpha' } as Config;
      new VersionEngine(configWithAlpha, { prerelease: true });

      expect(strategyModule.createStrategyMap).toHaveBeenCalledWith(
        expect.objectContaining({ prereleaseIdentifier: 'alpha', isPrerelease: true }),
      );
    });

    it('should default to "next" when prerelease: true and no configured identifier', () => {
      new VersionEngine(defaultConfig as Config, { prerelease: true });

      expect(strategyModule.createStrategyMap).toHaveBeenCalledWith(
        expect.objectContaining({ prereleaseIdentifier: 'next', isPrerelease: true }),
      );
    });

    it('should apply stable from runOptions as stableOnly on effective config', () => {
      new VersionEngine(defaultConfig as Config, { stable: true });

      expect(strategyModule.createStrategyMap).toHaveBeenCalledWith(expect.objectContaining({ stableOnly: true }));
    });

    it('should propagate baseRef from runOptions to effective config', () => {
      new VersionEngine(defaultConfig as Config, { baseRef: 'abc1234def' });

      expect(strategyModule.createStrategyMap).toHaveBeenCalledWith(expect.objectContaining({ baseRef: 'abc1234def' }));
    });

    it('should not set baseRef when runOptions does not include it', () => {
      new VersionEngine(defaultConfig as Config, { bump: 'minor' });

      expect(strategyModule.createStrategyMap).toHaveBeenCalledWith(
        expect.not.objectContaining({ baseRef: expect.anything() }),
      );
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
      // Mock packages WITHOUT root - the merge function will use npmPackages.root as fallback
      const mockPackagesWithoutRoot = {
        packages: [
          {
            dir: '/test/workspace/packages/a',
            relativeDir: 'packages/a',
            packageJson: { name: 'package-a', version: '1.0.0' },
          },
        ],
        rootDir: '/test/workspace',
        tool: 'pnpm' as any,
      };

      vi.mocked(getPackagesSync, { partial: true }).mockReturnValue(mockPackagesWithoutRoot as any);

      const engine = new VersionEngine(defaultConfig as Config);
      const result = await engine.getWorkspacePackages();

      expect(result.root).toBe('/test/workspace');
      // The new implementation logs discovery info, not the missing root warning
      expect(log).toHaveBeenCalledWith('Discovered 1 NPM, 0 Rust, and 0 Dart packages (1 total)', 'info');
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

    it('should apply runtime targets as secondary filter when config.packages is set', async () => {
      const configWithPackages = { ...defaultConfig, packages: ['package-a', 'package-b'] } as Config;
      const engine = new VersionEngine(configWithPackages, { targets: ['package-b'] });

      // Mock getPackagesSync to return multiple packages
      const mockPkgA = {
        packageJson: { name: 'package-a', version: '1.0.0' },
        dir: '/workspace/a',
        relativeDir: 'a',
      } as Package;
      const mockPkgB = {
        packageJson: { name: 'package-b', version: '1.0.0' },
        dir: '/workspace/b',
        relativeDir: 'b',
      } as Package;

      vi.mocked(getPackagesSync, { partial: true }).mockReturnValue({
        packages: [mockPkgA, mockPkgB],
        root: '/workspace',
        tool: 'pnpm' as any,
        rootDir: '/workspace',
      });

      const result = await engine.getWorkspacePackages();

      // Should only return package-b (intersection of config.packages AND runtimeTargets)
      expect(result.packages).toHaveLength(1);
      expect(result.packages[0].packageJson.name).toBe('package-b');
      expect(log).toHaveBeenCalledWith('Runtime targets filter: 2 → 1 packages', 'info');
    });

    it('should NOT pre-filter by runtime targets when version groups are configured', async () => {
      // Group-aware target expansion happens in the group strategy; pre-filtering here would
      // prune non-targeted members of a fixed group and silently split it.
      const configWithGroups = {
        ...defaultConfig,
        sync: false,
        groups: { native: { packages: ['@wdio/native-*'], sync: 'fixed' as const } },
      } as Config;
      const engine = new VersionEngine(configWithGroups, { targets: ['@wdio/native-core'] });

      vi.mocked(getPackagesSync, { partial: true }).mockReturnValue({
        packages: [
          { packageJson: { name: '@wdio/native-core', version: '2.3.0' }, dir: '/ws/core', relativeDir: 'core' },
          { packageJson: { name: '@wdio/native-utils', version: '2.3.0' }, dir: '/ws/utils', relativeDir: 'utils' },
        ],
        root: '/ws',
        tool: 'pnpm' as any,
        rootDir: '/ws',
      });

      const result = await engine.getWorkspacePackages();

      // Both members survive discovery despite only one being targeted.
      expect(result.packages.map((p) => p.packageJson.name).sort()).toEqual([
        '@wdio/native-core',
        '@wdio/native-utils',
      ]);
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

    it('should discover pure Rust packages with Cargo.toml only', async () => {
      // Mock the discoverCargoTomlPackages method
      const discoverSpy = vi.spyOn(VersionEngine.prototype as any, 'discoverCargoTomlPackages');
      discoverSpy.mockReturnValue({
        root: '/test/workspace',
        packages: [
          {
            dir: '/test/workspace/packages/test-rust-package',
            packageJson: {
              name: 'test-rust-package',
              version: '0.1.0',
            },
          },
        ],
      });

      // Mock getPackagesSync to return no packages (no package.json files)
      vi.mocked(getPackagesSync).mockReturnValue({
        root: '/test/workspace',
        packages: [],
      });

      const config = { ...defaultConfig, sync: false } as Config;
      const engine = new VersionEngine(config);

      const result = await engine.getWorkspacePackages();

      // Should have discovered the Rust package
      expect(result.packages).toHaveLength(1);
      expect(result.packages[0].packageJson.name).toBe('test-rust-package');
      expect(result.packages[0].packageJson.version).toBe('0.1.0');
      expect(result.packages[0].dir).toBe('/test/workspace/packages/test-rust-package');

      // Restore mocks
      discoverSpy.mockRestore();
    });

    it('should merge NPM and Rust packages without duplicates', async () => {
      // Mock the discoverCargoTomlPackages method
      const discoverSpy = vi.spyOn(VersionEngine.prototype as any, 'discoverCargoTomlPackages');
      discoverSpy.mockReturnValue({
        root: '/test/workspace',
        packages: [
          {
            dir: '/test/workspace/packages/pure-rust',
            packageJson: {
              name: 'pure-rust-package',
              version: '0.1.0',
            },
          },
        ],
      });

      // Mock NPM packages (including a hybrid package)
      vi.mocked(getPackagesSync).mockReturnValue({
        root: '/test/workspace',
        packages: [
          {
            dir: '/test/workspace/packages/hybrid',
            packageJson: { name: 'hybrid-package', version: '1.0.0' },
          },
        ],
      });

      const config = { ...defaultConfig, sync: false } as Config;
      const engine = new VersionEngine(config);

      const result = await engine.getWorkspacePackages();

      // Should have both packages: hybrid (NPM) and pure Rust
      expect(result.packages).toHaveLength(2);

      const hybridPkg = result.packages.find((p) => p.packageJson.name === 'hybrid-package');
      const rustPkg = result.packages.find((p) => p.packageJson.name === 'pure-rust-package');

      expect(hybridPkg).toBeDefined();
      expect(rustPkg).toBeDefined();
      expect(rustPkg?.packageJson.version).toBe('0.1.0');

      // Restore mocks
      discoverSpy.mockRestore();
    });

    it('should skip Rust packages in build directories', async () => {
      // Mock the discoverCargoTomlPackages method to return no packages
      // (our implementation already skips target directories)
      const discoverSpy = vi.spyOn(VersionEngine.prototype as any, 'discoverCargoTomlPackages');
      discoverSpy.mockReturnValue({
        root: '/test/workspace',
        packages: [], // No packages returned (target dir skipped)
      });

      // Mock getPackagesSync to return no packages
      vi.mocked(getPackagesSync).mockReturnValue({
        root: '/test/workspace',
        packages: [],
      });

      const config = { ...defaultConfig, sync: false } as Config;
      const engine = new VersionEngine(config);

      const result = await engine.getWorkspacePackages();

      // Should have no packages
      expect(result.packages).toHaveLength(0);

      // Restore mocks
      discoverSpy.mockRestore();
    });

    it('should merge pure Dart/Flutter packages alongside npm and Rust', async () => {
      const cargoSpy = vi.spyOn(VersionEngine.prototype as any, 'discoverCargoTomlPackages');
      cargoSpy.mockReturnValue({
        root: '/test/workspace',
        packages: [{ dir: '/test/workspace/crates/rusty', packageJson: { name: 'rusty', version: '0.1.0' } }],
      });
      const pubSpy = vi.spyOn(VersionEngine.prototype as any, 'discoverPubspecPackages');
      pubSpy.mockReturnValue({
        root: '/test/workspace',
        packages: [{ dir: '/test/workspace/packages/darty', packageJson: { name: 'darty', version: '1.2.3' } }],
      });
      vi.mocked(getPackagesSync).mockReturnValue({
        root: '/test/workspace',
        packages: [{ dir: '/test/workspace/packages/npmy', packageJson: { name: 'npmy', version: '1.0.0' } }],
      });

      const engine = new VersionEngine({ ...defaultConfig, sync: false } as Config);
      const result = await engine.getWorkspacePackages();

      expect(result.packages.map((p) => p.packageJson.name).sort()).toEqual(['darty', 'npmy', 'rusty']);

      cargoSpy.mockRestore();
      pubSpy.mockRestore();
    });

    it('should discover a pubspec-only package from the filesystem (no package.json)', async () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rk-pub-discovery-'));
      try {
        const pkgDir = path.join(tmp, 'packages', 'flutter_pkg');
        fs.mkdirSync(pkgDir, { recursive: true });
        fs.writeFileSync(path.join(pkgDir, 'pubspec.yaml'), 'name: flutter_pkg\nversion: 2.5.0\n');
        vi.mocked(mockCwd, { partial: true }).mockReturnValue(tmp);
        // No npm packages — only the pubspec-only package should be discovered.
        vi.mocked(getPackagesSync).mockReturnValue({ root: tmp, packages: [] });

        const engine = new VersionEngine({ ...defaultConfig, sync: false } as Config);
        const result = await engine.getWorkspacePackages();

        const dart = result.packages.find((p) => p.packageJson.name === 'flutter_pkg');
        expect(dart).toBeDefined();
        expect(dart?.packageJson.version).toBe('2.5.0');
        expect(dart?.dir).toBe(pkgDir);
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    });

    it('should skip a versionless pubspec (workspace root / app manifest)', async () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rk-pub-noversion-'));
      try {
        const pkgDir = path.join(tmp, 'packages', 'no_version');
        fs.mkdirSync(pkgDir, { recursive: true });
        // name but no version — like a Dart workspace root or Flutter app.
        fs.writeFileSync(path.join(pkgDir, 'pubspec.yaml'), 'name: no_version\n');
        vi.mocked(mockCwd, { partial: true }).mockReturnValue(tmp);
        vi.mocked(getPackagesSync).mockReturnValue({ root: tmp, packages: [] });

        const engine = new VersionEngine({ ...defaultConfig, sync: false } as Config);
        const result = await engine.getWorkspacePackages();

        expect(result.packages.find((p) => p.packageJson.name === 'no_version')).toBeUndefined();
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    });

    it('should skip a pub package with publish_to: none', async () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rk-pub-private-'));
      try {
        const pkgDir = path.join(tmp, 'packages', 'private_pkg');
        fs.mkdirSync(pkgDir, { recursive: true });
        fs.writeFileSync(path.join(pkgDir, 'pubspec.yaml'), 'name: private_pkg\nversion: 1.0.0\npublish_to: none\n');
        vi.mocked(mockCwd, { partial: true }).mockReturnValue(tmp);
        vi.mocked(getPackagesSync).mockReturnValue({ root: tmp, packages: [] });

        const engine = new VersionEngine({ ...defaultConfig, sync: false } as Config);
        const result = await engine.getWorkspacePackages();

        expect(result.packages.find((p) => p.packageJson.name === 'private_pkg')).toBeUndefined();
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    });

    it('should skip a Cargo crate with publish = false', async () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rk-cargo-nopublish-'));
      try {
        const crateDir = path.join(tmp, 'crates', 'private_crate');
        fs.mkdirSync(crateDir, { recursive: true });
        fs.writeFileSync(
          path.join(crateDir, 'Cargo.toml'),
          '[package]\nname = "private_crate"\nversion = "1.0.0"\npublish = false\n',
        );
        vi.mocked(mockCwd, { partial: true }).mockReturnValue(tmp);
        vi.mocked(getPackagesSync).mockReturnValue({ root: tmp, packages: [] });

        const engine = new VersionEngine({ ...defaultConfig, sync: false } as Config);
        const result = await engine.getWorkspacePackages();

        expect(result.packages.find((p) => p.packageJson.name === 'private_crate')).toBeUndefined();
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    });

    it('should skip a Cargo crate with publish = []', async () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rk-cargo-nopublish-arr-'));
      try {
        const crateDir = path.join(tmp, 'crates', 'private_crate');
        fs.mkdirSync(crateDir, { recursive: true });
        fs.writeFileSync(
          path.join(crateDir, 'Cargo.toml'),
          '[package]\nname = "private_crate"\nversion = "1.0.0"\npublish = []\n',
        );
        vi.mocked(mockCwd, { partial: true }).mockReturnValue(tmp);
        vi.mocked(getPackagesSync).mockReturnValue({ root: tmp, packages: [] });

        const engine = new VersionEngine({ ...defaultConfig, sync: false } as Config);
        const result = await engine.getWorkspacePackages();

        expect(result.packages.find((p) => p.packageJson.name === 'private_crate')).toBeUndefined();
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    });

    it('should exclude Cargo crates outside workspace members when a workspace root Cargo.toml exists', async () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rk-cargo-workspace-'));
      try {
        fs.writeFileSync(path.join(tmp, 'Cargo.toml'), '[workspace]\nmembers = ["crates/member"]\n');
        const memberDir = path.join(tmp, 'crates', 'member');
        fs.mkdirSync(memberDir, { recursive: true });
        fs.writeFileSync(path.join(memberDir, 'Cargo.toml'), '[package]\nname = "member_crate"\nversion = "0.1.0"\n');
        const fixtureDir = path.join(tmp, 'fixtures', 'test_crate');
        fs.mkdirSync(fixtureDir, { recursive: true });
        fs.writeFileSync(path.join(fixtureDir, 'Cargo.toml'), '[package]\nname = "fixture_crate"\nversion = "0.1.0"\n');
        vi.mocked(mockCwd, { partial: true }).mockReturnValue(tmp);
        vi.mocked(getPackagesSync).mockReturnValue({ root: tmp, packages: [] });

        const engine = new VersionEngine({ ...defaultConfig, sync: false } as Config);
        const result = await engine.getWorkspacePackages();

        expect(result.packages.find((p) => p.packageJson.name === 'member_crate')).toBeDefined();
        expect(result.packages.find((p) => p.packageJson.name === 'fixture_crate')).toBeUndefined();
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    });

    it('should include a workspace root crate that also carries [package] even when workspace members are declared', async () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rk-cargo-root-pkg-'));
      try {
        // Root Cargo.toml declares both [workspace] and [package] — a "virtual workspace root crate"
        fs.writeFileSync(
          path.join(tmp, 'Cargo.toml'),
          '[workspace]\nmembers = ["crates/member"]\n\n[package]\nname = "root_crate"\nversion = "2.0.0"\n',
        );
        const memberDir = path.join(tmp, 'crates', 'member');
        fs.mkdirSync(memberDir, { recursive: true });
        fs.writeFileSync(path.join(memberDir, 'Cargo.toml'), '[package]\nname = "member_crate"\nversion = "0.1.0"\n');
        vi.mocked(mockCwd, { partial: true }).mockReturnValue(tmp);
        vi.mocked(getPackagesSync).mockReturnValue({ root: tmp, packages: [] });

        const engine = new VersionEngine({ ...defaultConfig, sync: false } as Config);
        const result = await engine.getWorkspacePackages();

        expect(result.packages.find((p) => p.packageJson.name === 'root_crate')).toBeDefined();
        expect(result.packages.find((p) => p.packageJson.name === 'member_crate')).toBeDefined();
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    });

    it('should exclude pub packages outside pnpm workspace globs when pnpm-workspace.yaml exists', async () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rk-pub-workspace-'));
      try {
        fs.writeFileSync(path.join(tmp, 'pnpm-workspace.yaml'), 'packages:\n  - "packages/*"\n');
        const memberDir = path.join(tmp, 'packages', 'flutter_member');
        fs.mkdirSync(memberDir, { recursive: true });
        fs.writeFileSync(path.join(memberDir, 'pubspec.yaml'), 'name: flutter_member\nversion: 1.0.0\n');
        const fixtureDir = path.join(tmp, 'fixtures', 'flutter_fixture');
        fs.mkdirSync(fixtureDir, { recursive: true });
        fs.writeFileSync(path.join(fixtureDir, 'pubspec.yaml'), 'name: flutter_fixture\nversion: 0.0.1\n');
        vi.mocked(mockCwd, { partial: true }).mockReturnValue(tmp);
        vi.mocked(getPackagesSync).mockReturnValue({ root: tmp, packages: [] });

        const engine = new VersionEngine({ ...defaultConfig, sync: false } as Config);
        const result = await engine.getWorkspacePackages();

        expect(result.packages.find((p) => p.packageJson.name === 'flutter_member')).toBeDefined();
        expect(result.packages.find((p) => p.packageJson.name === 'flutter_fixture')).toBeUndefined();
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    });

    it('should include a pure Rust package when explicitly named in config.packages', async () => {
      const discoverSpy = vi.spyOn(VersionEngine.prototype as any, 'discoverCargoTomlPackages');
      discoverSpy.mockReturnValue({
        root: '/test/workspace',
        packages: [
          {
            dir: '/test/workspace/crates/my-crate',
            packageJson: { name: 'my-crate', version: '0.1.0' },
          },
        ],
      });

      vi.mocked(getPackagesSync).mockReturnValue({
        root: '/test/workspace',
        packages: [],
      });

      const config = { ...defaultConfig, packages: ['my-crate'] } as Config;
      const engine = new VersionEngine(config);

      const result = await engine.getWorkspacePackages();

      expect(result.packages).toHaveLength(1);
      expect(result.packages[0].packageJson.name).toBe('my-crate');

      discoverSpy.mockRestore();
    });

    it('should include a private npm package when explicitly named in config.packages', async () => {
      vi.mocked(getPackagesSync).mockReturnValue({
        root: '/test/workspace',
        packages: [
          {
            dir: '/test/workspace/packages/private-pkg',
            relativeDir: 'packages/private-pkg',
            packageJson: { name: '@test/private-pkg', version: '0.1.0', private: true },
          },
        ],
      });

      const config = { ...defaultConfig, packages: ['@test/private-pkg'] } as Config;
      const engine = new VersionEngine(config);

      const result = await engine.getWorkspacePackages();

      expect(result.packages).toHaveLength(1);
      expect(result.packages[0].packageJson.name).toBe('@test/private-pkg');
    });
  });
});
