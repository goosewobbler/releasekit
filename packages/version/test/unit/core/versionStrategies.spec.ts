import fs from 'node:fs';
import path from 'node:path';
import type { Package, Tool } from '@manypkg/get-packages';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as commitParser from '../../../src/changelog/commitParser.js';
import * as calculator from '../../../src/core/versionCalculator.js';
import type { PackagesWithRoot } from '../../../src/core/versionEngine.js';
import * as strategies from '../../../src/core/versionStrategies.js';
import * as commandExecutor from '../../../src/git/commandExecutor.js';
import * as gitCommands from '../../../src/git/commands.js';
import * as gitTags from '../../../src/git/tagsAndBranches.js';
import * as packageManagement from '../../../src/package/packageManagement.js';
import { PackageProcessor } from '../../../src/package/packageProcessor.js';
import type { Config } from '../../../src/types.js';
import * as formatting from '../../../src/utils/formatting.js';
import * as jsonOutput from '../../../src/utils/jsonOutput.js';
import * as logging from '../../../src/utils/logging.js';

// Mock dependencies
vi.mock('../../../src/git/commands.js');
vi.mock('../../../src/git/tagsAndBranches.js');
vi.mock('../../../src/git/commandExecutor.js');
vi.mock('../../../src/utils/logging.js');
vi.mock('../../../src/core/versionCalculator.js');
vi.mock('../../../src/package/packageManagement.js');
vi.mock('../../../src/utils/jsonOutput.js');
vi.mock('../../../src/changelog/commitParser.js');
vi.mock('../../../src/utils/formatting.js', () => ({
  formatVersionPrefix: vi.fn().mockReturnValue('v'),
  formatTag: vi
    .fn()
    .mockImplementation((version, _prefix, packageName) =>
      packageName ? `${packageName}@v${version}` : `v${version}`,
    ),
  formatCommitMessage: vi.fn().mockImplementation((template, version, packageName) => {
    return template.replace(/\$\{version\}/g, version).replace(/\$\{packageName\}/g, packageName || '');
  }),
}));
vi.mock('../../../src/package/packageProcessor.js');
vi.mock('node:fs');
vi.mock('node:path');

// For simplicity in tests
const git = {
  ...gitCommands,
  ...gitTags,
};

describe('Version Strategies', () => {
  // Mock data
  const mockPackages = {
    root: '/test/workspace',
    rootDir: '/test/workspace',
    tool: 'npm' as unknown as Tool,
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
  } as unknown as PackagesWithRoot;

  // Mock package paths
  const rootPackagePath = '/test/workspace/package.json';
  const packageAPath = '/test/workspace/packages/a/package.json';
  const packageBPath = '/test/workspace/packages/b/package.json';

  // Default config for tests
  const defaultConfig: Partial<Config> = {
    preset: 'conventional-commits',
    versionPrefix: 'v',
    tagTemplate: '${' + 'prefix}${' + 'version}',
    baseBranch: 'main',
  };

  beforeEach(() => {
    // Reset all mocks
    vi.resetAllMocks();

    // Setup common mocks
    vi.mocked(path.join, { partial: true }).mockImplementation((...args) => args.join('/'));
    vi.mocked(fs.existsSync, { partial: true }).mockReturnValue(true);
    vi.mocked(git.getLatestTag, { partial: true }).mockResolvedValue('v1.0.0');
    vi.mocked(calculator.calculateVersion, { partial: true }).mockResolvedValue('1.1.0');
    vi.mocked(formatting.formatVersionPrefix, { partial: true }).mockReturnValue('v');
    vi.mocked(formatting.formatTag, { partial: true }).mockReturnValue('v1.1.0');
    // Default mock: single-package result used by most tests. Sync tests override this.
    vi.mocked(formatting.formatCommitMessage, { partial: true }).mockReturnValue('chore: release package-a v1.1.0');
    vi.mocked(commitParser.extractChangelogEntriesFromCommits, { partial: true }).mockReturnValue([
      { type: 'added', description: 'New feature' },
    ]);
    vi.mocked(commandExecutor.execSync, { partial: true }).mockReturnValue(Buffer.from(''));

    // Setup PackageProcessor mock
    vi.mocked(PackageProcessor.prototype.processPackages, { partial: true }).mockResolvedValue({
      updatedPackages: [{ name: 'package-a', version: '1.1.0', path: '/test/workspace/packages/a' }],
      tags: ['v1.1.0'],
      commitMessage: 'chore: release package-a v1.1.0',
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Helper function for testing package processing logic
  // Since targeting is now handled at discovery time, this only checks skip logic
  const shouldProcessPackage = (pkg: Package, config: Partial<Config>): boolean => {
    const pkgName = pkg.packageJson.name;

    // Only check skip list - targeting is now handled at discovery time
    return !config.skip?.includes(pkgName);
  };

  describe('shouldProcessPackage', () => {
    it('should skip packages that are in the exclude list', () => {
      const config: Partial<Config> = {
        ...defaultConfig,
        skip: ['package-a'],
      };

      const result = shouldProcessPackage(mockPackages.packages[0], config);

      expect(result).toBe(false);
    });

    it('should process all packages if no targets specified', () => {
      const config: Partial<Config> = {
        ...defaultConfig,
      };

      const result = shouldProcessPackage(mockPackages.packages[0], config);

      expect(result).toBe(true);
    });

    it('should process all packages since targeting is now at discovery time', () => {
      const config: Partial<Config> = {
        ...defaultConfig,
      };

      const resultA = shouldProcessPackage(mockPackages.packages[0], config);
      const resultB = shouldProcessPackage(mockPackages.packages[1], config);

      expect(resultA).toBe(true);
      expect(resultB).toBe(true);
    });
  });

  describe('createSyncStrategy', () => {
    it('should update all packages to the same version', async () => {
      // Use the real mock implementation (not the beforeEach single-package override)
      // so we can verify the combined package name is passed to formatCommitMessage.
      vi.mocked(formatting.formatCommitMessage).mockImplementation((template, version, packageName) =>
        template.replace(/\$\{version\}/g, version).replace(/\$\{packageName\}/g, packageName || ''),
      );

      const config: Partial<Config> = {
        ...defaultConfig,
        sync: true,
        commitMessage: 'chore: release ${' + 'packageName} v${' + 'version}',
      };

      const syncStrategy = strategies.createSyncStrategy(config as Config);

      // Execute
      await syncStrategy(mockPackages);

      // Verify
      expect(git.getLatestTag).toHaveBeenCalled();
      expect(calculator.calculateVersion).toHaveBeenCalledWith(
        config as Config,
        expect.objectContaining({
          latestTag: 'v1.0.0',
          versionPrefix: 'v',
        }),
      );

      // Check root package update
      expect(packageManagement.updatePackageVersion).toHaveBeenCalledWith(rootPackagePath, '1.1.0', undefined);

      // Check workspace packages update
      expect(packageManagement.updatePackageVersion).toHaveBeenCalledWith(packageAPath, '1.1.0', undefined);
      expect(packageManagement.updatePackageVersion).toHaveBeenCalledWith(packageBPath, '1.1.0', undefined);

      // Both workspace package names should be passed to formatCommitMessage
      expect(formatting.formatCommitMessage).toHaveBeenCalledWith(
        config.commitMessage,
        '1.1.0',
        'package-a, package-b',
        undefined,
      );

      // Check tag and commit message tracked for JSON output (git ops now handled by publish)
      expect(jsonOutput.addTag).toHaveBeenCalledWith('v1.1.0');
      expect(jsonOutput.setCommitMessage).toHaveBeenCalledWith('chore: release package-a, package-b v1.1.0');
    });

    it('should use mainPackage for version calculation when specified', async () => {
      // Setup with mainPackage
      const config: Partial<Config> = {
        ...defaultConfig,
        sync: true,
        mainPackage: 'package-b',
      };

      const syncStrategy = strategies.createSyncStrategy(config as Config);

      // Execute
      await syncStrategy(mockPackages);

      // Verify that version calculation used package-b for version source but repo root for commit check
      expect(calculator.calculateVersion).toHaveBeenCalledWith(
        config as Config,
        expect.objectContaining({
          path: '/test/workspace/packages/b',
          name: 'package-b',
          commitCheckPath: '/test/workspace',
        }),
      );

      // Still updates all packages
      expect(packageManagement.updatePackageVersion).toHaveBeenCalledWith(rootPackagePath, '1.1.0', undefined);
      expect(packageManagement.updatePackageVersion).toHaveBeenCalledWith(packageAPath, '1.1.0', undefined);
      expect(packageManagement.updatePackageVersion).toHaveBeenCalledWith(packageBPath, '1.1.0', undefined);
    });

    it('should fall back to root package if mainPackage is not found', async () => {
      // Setup with non-existent mainPackage
      const config: Partial<Config> = {
        ...defaultConfig,
        sync: true,
        mainPackage: 'package-z',
      };

      const syncStrategy = strategies.createSyncStrategy(config as Config);

      // Execute
      await syncStrategy(mockPackages);

      // Verify that version calculation used root package
      expect(calculator.calculateVersion).toHaveBeenCalledWith(
        config as Config,
        expect.objectContaining({
          path: '/test/workspace',
          name: undefined,
        }),
      );

      // Verify warning was logged
      expect(logging.log).toHaveBeenCalledWith(
        "Main package 'package-z' not found. Using root package for version determination.",
        'warning',
      );
    });

    it('should pass commitCheckPath as repo root regardless of version source package', async () => {
      // Regression: without commitCheckPath, getCommitsLength was called with the version
      // source package dir (e.g. packages/version), so changes in other packages were
      // invisible and no bump was produced even when other packages had new commits.
      const config: Partial<Config> = {
        ...defaultConfig,
        sync: true,
      };

      const syncStrategy = strategies.createSyncStrategy(config as Config);
      await syncStrategy(mockPackages);

      // path should be the first workspace package (version source)
      // commitCheckPath should be the repo root so all commits are visible
      expect(calculator.calculateVersion).toHaveBeenCalledWith(
        config as Config,
        expect.objectContaining({
          path: '/test/workspace/packages/a',
          commitCheckPath: '/test/workspace',
        }),
      );
    });

    it('should pass combined package names to formatCommitMessage for multi-package sync', async () => {
      const config: Partial<Config> = {
        ...defaultConfig,
        sync: true,
        commitMessage: 'chore: release ${' + 'packageName}@${' + 'version} [skip-ci]',
      };

      const syncStrategy = strategies.createSyncStrategy(config as Config);
      await syncStrategy(mockPackages);

      // Both workspace packages should be passed as a combined name
      expect(formatting.formatCommitMessage).toHaveBeenCalledWith(
        'chore: release ${' + 'packageName}@${' + 'version} [skip-ci]',
        '1.1.0',
        'package-a, package-b',
        undefined,
      );
    });

    it('should not include root in commit message for single-package sync repo', async () => {
      // Simulate a single-package repo where only the root package.json is updated
      const singlePackageRepo = {
        root: '/test/workspace',
        rootDir: '/test/workspace',
        tool: 'npm' as unknown as Tool,
        packages: [] as unknown[],
      } as unknown as PackagesWithRoot;

      const config: Partial<Config> = {
        ...defaultConfig,
        sync: true,
        commitMessage: 'chore: release ${' + 'packageName} v${' + 'version} [skip ci]',
      };

      const syncStrategy = strategies.createSyncStrategy(config as Config);
      await syncStrategy(singlePackageRepo);

      // When commitPackageName is undefined (no workspace packages) and template contains ${packageName},
      // we bypass formatCommitMessage to avoid the spurious warning. Double space from empty
      // ${packageName} should be collapsed automatically.
      expect(jsonOutput.setCommitMessage).toHaveBeenCalledWith('chore: release v1.1.0 [skip ci]');
    });

    it('should exit early if no version change needed', async () => {
      // Mock calculateVersion to return empty string (no change)
      vi.mocked(calculator.calculateVersion, { partial: true }).mockResolvedValue('');

      const config: Partial<Config> = {
        ...defaultConfig,
        sync: true,
      };

      const syncStrategy = strategies.createSyncStrategy(config as Config);

      // Execute
      await syncStrategy(mockPackages);

      // Verify no updates were made
      expect(packageManagement.updatePackageVersion).not.toHaveBeenCalled();
      expect(jsonOutput.addTag).not.toHaveBeenCalled();
      expect(jsonOutput.setCommitMessage).not.toHaveBeenCalled();
      expect(logging.log).toHaveBeenCalledWith('No version change needed', 'info');
    });

    it('should respect skip configuration', async () => {
      const config: Partial<Config> = {
        ...defaultConfig,
        sync: true,
        skip: ['package-b'],
      };

      const syncStrategy = strategies.createSyncStrategy(config as Config);

      // Execute
      await syncStrategy(mockPackages);

      // Verify package-b was skipped
      expect(packageManagement.updatePackageVersion).toHaveBeenCalledWith(rootPackagePath, '1.1.0', undefined);
      expect(packageManagement.updatePackageVersion).toHaveBeenCalledWith(packageAPath, '1.1.0', undefined);
      expect(packageManagement.updatePackageVersion).not.toHaveBeenCalledWith(packageBPath, '1.1.0', undefined);
    });

    describe('Changelog generation', () => {
      it('should extract changelog entries and call addChangelogData', async () => {
        const config: Partial<Config> = {
          ...defaultConfig,
          sync: true,
        };

        const syncStrategy = strategies.createSyncStrategy(config as Config);

        await syncStrategy(mockPackages);

        expect(commitParser.extractChangelogEntriesFromCommits).toHaveBeenCalledWith('/test/workspace', 'v1.0.0..HEAD');

        expect(jsonOutput.addChangelogData).toHaveBeenCalledWith({
          packageName: 'monorepo',
          version: '1.1.0',
          previousVersion: 'v1.0.0',
          revisionRange: 'v1.0.0..HEAD',
          repoUrl: null,
          entries: [{ type: 'added', description: 'New feature' }],
        });
      });

      it('should use monorepo as package name when no mainPackage specified', async () => {
        const config: Partial<Config> = {
          ...defaultConfig,
          sync: true,
        };

        const syncStrategy = strategies.createSyncStrategy(config as Config);

        await syncStrategy(mockPackages);

        expect(jsonOutput.addChangelogData).toHaveBeenCalledWith(
          expect.objectContaining({
            packageName: 'monorepo',
          }),
        );
      });

      it('should use mainPackage name when specified', async () => {
        const config: Partial<Config> = {
          ...defaultConfig,
          sync: true,
          mainPackage: 'package-a',
        };

        const syncStrategy = strategies.createSyncStrategy(config as Config);

        await syncStrategy(mockPackages);

        expect(jsonOutput.addChangelogData).toHaveBeenCalledWith(
          expect.objectContaining({
            packageName: 'package-a',
          }),
        );
      });

      it('should use HEAD as revision range when no tag exists', async () => {
        vi.mocked(git.getLatestTag, { partial: true }).mockResolvedValue('');

        const config: Partial<Config> = {
          ...defaultConfig,
          sync: true,
        };

        const syncStrategy = strategies.createSyncStrategy(config as Config);

        await syncStrategy(mockPackages);

        expect(commitParser.extractChangelogEntriesFromCommits).toHaveBeenCalledWith('/test/workspace', 'HEAD');

        expect(jsonOutput.addChangelogData).toHaveBeenCalledWith(
          expect.objectContaining({
            revisionRange: 'HEAD',
            previousVersion: null,
          }),
        );
      });

      it('should create one tag per workspace package when packageSpecificTags is true', async () => {
        vi.mocked(formatting.formatTag, { partial: true }).mockImplementation((_version, _prefix, packageName) =>
          packageName ? `${packageName}-v1.1.0` : 'v1.1.0',
        );

        const config: Partial<Config> = {
          ...defaultConfig,
          sync: true,
          packageSpecificTags: true,
          tagTemplate: '${' + 'packageName}-${' + 'prefix}${' + 'version}',
        };

        const syncStrategy = strategies.createSyncStrategy(config as Config);
        await syncStrategy(mockPackages);

        expect(jsonOutput.addTag).toHaveBeenCalledWith('package-a-v1.1.0');
        expect(jsonOutput.addTag).toHaveBeenCalledWith('package-b-v1.1.0');
        expect(jsonOutput.addTag).toHaveBeenCalledTimes(2);
      });

      it('should emit one changelog entry per workspace package when packageSpecificTags is true', async () => {
        const config: Partial<Config> = {
          ...defaultConfig,
          sync: true,
          packageSpecificTags: true,
        };

        const syncStrategy = strategies.createSyncStrategy(config as Config);
        await syncStrategy(mockPackages);

        expect(jsonOutput.addChangelogData).toHaveBeenCalledWith(expect.objectContaining({ packageName: 'package-a' }));
        expect(jsonOutput.addChangelogData).toHaveBeenCalledWith(expect.objectContaining({ packageName: 'package-b' }));
        expect(jsonOutput.addChangelogData).toHaveBeenCalledTimes(2);
      });

      it('should emit a single monorepo changelog entry when packageSpecificTags is false', async () => {
        const config: Partial<Config> = {
          ...defaultConfig,
          sync: true,
          packageSpecificTags: false,
        };

        const syncStrategy = strategies.createSyncStrategy(config as Config);
        await syncStrategy(mockPackages);

        expect(jsonOutput.addChangelogData).toHaveBeenCalledWith(expect.objectContaining({ packageName: 'monorepo' }));
        expect(jsonOutput.addChangelogData).toHaveBeenCalledTimes(1);
      });

      it('should fall through to mainPkgName when packageSpecificTags is true but no workspace packages exist', async () => {
        const rootOnlyRepo = {
          root: '/test/workspace',
          rootDir: '/test/workspace',
          tool: 'npm' as unknown as Tool,
          packages: [] as unknown[],
        } as unknown as PackagesWithRoot;

        const config: Partial<Config> = {
          ...defaultConfig,
          sync: true,
          packageSpecificTags: true,
        };

        const syncStrategy = strategies.createSyncStrategy(config as Config);
        await syncStrategy(rootOnlyRepo);

        // workspaceNames is empty, so the per-package branch is skipped and
        // the single-entry path falls through to mainPkgName || 'monorepo'.
        // mainPkgName is undefined here (no mainPackage config, no workspace packages),
        // so the entry is keyed as 'monorepo'.
        expect(jsonOutput.addChangelogData).toHaveBeenCalledTimes(1);
        expect(jsonOutput.addChangelogData).toHaveBeenCalledWith(expect.objectContaining({ packageName: 'monorepo' }));
      });

      it('should create fallback changelog entry when no commits found', async () => {
        vi.mocked(commitParser.extractChangelogEntriesFromCommits, { partial: true }).mockReturnValue([]);

        const config: Partial<Config> = {
          ...defaultConfig,
          sync: true,
        };

        const syncStrategy = strategies.createSyncStrategy(config as Config);

        await syncStrategy(mockPackages);

        expect(jsonOutput.addChangelogData).toHaveBeenCalledWith(
          expect.objectContaining({
            entries: [{ type: 'changed', description: 'Update version to 1.1.0' }],
          }),
        );
      });
    });
  });

  describe('createSingleStrategy', () => {
    it('should update only the specified package', async () => {
      // Setup
      const config: Partial<Config> = {
        ...defaultConfig,
        mainPackage: 'package-a',
        commitMessage: 'chore: release ${' + 'packageName} v${' + 'version}',
      };

      const singleStrategy = strategies.createSingleStrategy(config as Config);

      // Execute
      await singleStrategy(mockPackages);

      // Verify
      expect(git.getLatestTag).toHaveBeenCalled();
      expect(calculator.calculateVersion).toHaveBeenCalledWith(
        config as Config,
        expect.objectContaining({
          latestTag: 'v1.0.0',
          versionPrefix: 'v',
          path: '/test/workspace/packages/a',
          name: 'package-a',
        }),
      );

      // Check only package-a update
      expect(packageManagement.updatePackageVersion).toHaveBeenCalledWith(packageAPath, '1.1.0', undefined);
      expect(packageManagement.updatePackageVersion).not.toHaveBeenCalledWith(
        packageBPath,
        expect.anything(),
        expect.anything(),
      );

      // Check tag and commit message tracked for JSON output (git ops now handled by publish)
      expect(jsonOutput.addTag).toHaveBeenCalledWith('v1.1.0');
      expect(jsonOutput.setCommitMessage).toHaveBeenCalledWith('chore: release package-a v1.1.0');
    });

    it('should use packageName in commit message template', async () => {
      // Setup
      const config: Partial<Config> = {
        ...defaultConfig,
        mainPackage: 'package-a',
        commitMessage: 'chore: release ${' + 'packageName}@${' + 'version} [skip-ci]',
      };

      const singleStrategy = strategies.createSingleStrategy(config as Config);

      // Execute
      await singleStrategy(mockPackages);

      // Verify that formatCommitMessage was called with the right parameters
      expect(formatting.formatCommitMessage).toHaveBeenCalledWith(
        'chore: release ${' + 'packageName}@${' + 'version} [skip-ci]',
        '1.1.0',
        'package-a',
      );
    });

    it('should throw if packages array is not exactly one item', async () => {
      // Setup with no packages
      const config1: Partial<Config> = {
        ...defaultConfig,
        packages: [],
      };

      // Setup with multiple packages
      const config2: Partial<Config> = {
        ...defaultConfig,
        packages: ['package-a', 'package-b'],
      };

      const singleStrategy1 = strategies.createSingleStrategy(config1 as Config);
      const singleStrategy2 = strategies.createSingleStrategy(config2 as Config);

      // Execute and verify errors - update the expected error message to match the new implementation
      await expect(singleStrategy1(mockPackages)).rejects.toThrow(
        'Invalid configuration: Single mode requires either mainPackage or exactly one resolved package',
      );
      await expect(singleStrategy2(mockPackages)).rejects.toThrow(
        'Invalid configuration: Single mode requires either mainPackage or exactly one resolved package',
      );
    });

    it('should use mainPackage instead of packages array when both are provided', async () => {
      // Setup with both mainPackage and packages array
      const config: Partial<Config> = {
        ...defaultConfig,
        mainPackage: 'package-b',
        packages: ['package-a'],
      };

      const singleStrategy = strategies.createSingleStrategy(config as Config);

      // Execute
      await singleStrategy(mockPackages);

      // Verify package-b was used instead of package-a
      expect(calculator.calculateVersion).toHaveBeenCalledWith(
        config as Config,
        expect.objectContaining({
          path: '/test/workspace/packages/b',
          name: 'package-b',
        }),
      );

      expect(packageManagement.updatePackageVersion).toHaveBeenCalledWith(packageBPath, '1.1.0', undefined);
      expect(packageManagement.updatePackageVersion).not.toHaveBeenCalledWith(
        packageAPath,
        expect.anything(),
        expect.anything(),
      );
    });

    it('should throw if mainPackage is not found', async () => {
      // Setup with non-existent mainPackage
      const config: Partial<Config> = {
        ...defaultConfig,
        mainPackage: 'package-z',
      };

      const singleStrategy = strategies.createSingleStrategy(config as Config);

      // Execute and verify error
      await expect(singleStrategy(mockPackages)).rejects.toThrow('Package not found: package-z');
    });

    it('should exit early if no version change needed', async () => {
      // Mock calculateVersion to return empty string (no change)
      vi.mocked(calculator.calculateVersion, { partial: true }).mockResolvedValue('');

      const config: Partial<Config> = {
        ...defaultConfig,
        mainPackage: 'package-a',
      };

      const singleStrategy = strategies.createSingleStrategy(config as Config);

      // Execute
      await singleStrategy(mockPackages);

      // Verify no updates were made
      expect(packageManagement.updatePackageVersion).not.toHaveBeenCalled();
      expect(jsonOutput.addTag).not.toHaveBeenCalled();
      expect(jsonOutput.setCommitMessage).not.toHaveBeenCalled();
      expect(logging.log).toHaveBeenCalledWith('No version change needed for package-a', 'info');
    });

    describe('Cargo.toml Support', () => {
      const hybridPackages = {
        root: '/test/workspace',
        rootDir: '/test/workspace',
        tool: 'npm' as unknown as Tool,
        packages: [
          {
            dir: '/test/workspace/hybrid-pkg',
            relativeDir: 'hybrid-pkg',
            packageJson: { name: 'hybrid-package', version: '0.1.0' },
          },
        ],
      } as unknown as PackagesWithRoot;

      it('should update Cargo.toml in package root when cargo.enabled is true (default)', async () => {
        // Setup
        const config: Partial<Config> = {
          ...defaultConfig,
          mainPackage: 'hybrid-package',
          cargo: {
            enabled: true,
          },
        };

        const singleStrategy = strategies.createSingleStrategy(config as Config);

        // Execute
        await singleStrategy(hybridPackages);

        // Verify package.json was updated
        expect(packageManagement.updatePackageVersion).toHaveBeenCalledWith(
          '/test/workspace/hybrid-pkg/package.json',
          '1.1.0',
          undefined,
        );

        // Verify Cargo.toml was also updated
        expect(packageManagement.updatePackageVersion).toHaveBeenCalledWith(
          '/test/workspace/hybrid-pkg/Cargo.toml',
          '1.1.0',
          false,
        );
      });

      it('should default to cargo.enabled: true when cargo config not specified', async () => {
        // Setup - no cargo config at all
        const config: Partial<Config> = {
          ...defaultConfig,
          mainPackage: 'hybrid-package',
          // No cargo property
        };

        const singleStrategy = strategies.createSingleStrategy(config as Config);

        // Execute
        await singleStrategy(hybridPackages);

        // Verify both files were updated (default behavior)
        expect(packageManagement.updatePackageVersion).toHaveBeenCalledWith(
          '/test/workspace/hybrid-pkg/package.json',
          '1.1.0',
          undefined,
        );
        expect(packageManagement.updatePackageVersion).toHaveBeenCalledWith(
          '/test/workspace/hybrid-pkg/Cargo.toml',
          '1.1.0',
          false,
        );
      });

      it('should not update Cargo.toml when cargo.enabled is false', async () => {
        // Setup
        const config: Partial<Config> = {
          ...defaultConfig,
          mainPackage: 'hybrid-package',
          cargo: {
            enabled: false,
          },
        };

        const singleStrategy = strategies.createSingleStrategy(config as Config);

        // Execute
        await singleStrategy(hybridPackages);

        // Verify only package.json was updated
        expect(packageManagement.updatePackageVersion).toHaveBeenCalledWith(
          '/test/workspace/hybrid-pkg/package.json',
          '1.1.0',
          undefined,
        );

        // Verify Cargo.toml was NOT updated
        expect(packageManagement.updatePackageVersion).not.toHaveBeenCalledWith(
          '/test/workspace/hybrid-pkg/Cargo.toml',
          expect.anything(),
          expect.anything(),
        );
      });

      // Note: cargo.paths with multiple files is tested in integration tests
      // Unit testing path resolution is complex due to mocking requirements
      // The integration tests verify this works end-to-end with real file system

      it('should handle missing Cargo.toml gracefully when cargo is enabled', async () => {
        // Setup - mock fs.existsSync to return false for Cargo.toml
        vi.mocked(fs.existsSync, { partial: true }).mockImplementation((filePath) => {
          // Only package.json exists, Cargo.toml doesn't
          return !String(filePath).endsWith('Cargo.toml');
        });

        const config: Partial<Config> = {
          ...defaultConfig,
          mainPackage: 'hybrid-package',
          cargo: {
            enabled: true,
          },
        };

        const singleStrategy = strategies.createSingleStrategy(config as Config);

        // Execute - should not throw
        await singleStrategy(hybridPackages);

        // Verify package.json was updated
        expect(packageManagement.updatePackageVersion).toHaveBeenCalledWith(
          '/test/workspace/hybrid-pkg/package.json',
          '1.1.0',
          undefined,
        );

        // Verify Cargo.toml update was not attempted (file doesn't exist)
        expect(packageManagement.updatePackageVersion).not.toHaveBeenCalledWith(
          '/test/workspace/hybrid-pkg/Cargo.toml',
          expect.anything(),
          expect.anything(),
        );
      });

      it('should apply the same version to both package.json and Cargo.toml', async () => {
        // Setup - test with a prerelease version
        vi.mocked(calculator.calculateVersion, { partial: true }).mockResolvedValue('1.2.0-next.0');

        const config: Partial<Config> = {
          ...defaultConfig,
          mainPackage: 'hybrid-package',
          cargo: {
            enabled: true,
          },
        };

        const singleStrategy = strategies.createSingleStrategy(config as Config);

        // Execute
        await singleStrategy(hybridPackages);

        // Verify both files get the same version
        expect(packageManagement.updatePackageVersion).toHaveBeenCalledWith(
          '/test/workspace/hybrid-pkg/package.json',
          '1.2.0-next.0',
          undefined,
        );
        expect(packageManagement.updatePackageVersion).toHaveBeenCalledWith(
          '/test/workspace/hybrid-pkg/Cargo.toml',
          '1.2.0-next.0',
          false,
        );
      });

      it('should ignore cargo.paths when cargo.enabled is false', async () => {
        // Setup
        const config: Partial<Config> = {
          ...defaultConfig,
          mainPackage: 'hybrid-package',
          cargo: {
            enabled: false,
            paths: ['src', 'crates/core'], // Should be ignored
          },
        };

        const singleStrategy = strategies.createSingleStrategy(config as Config);

        // Execute
        await singleStrategy(hybridPackages);

        // Verify only package.json was updated
        expect(packageManagement.updatePackageVersion).toHaveBeenCalledWith(
          '/test/workspace/hybrid-pkg/package.json',
          '1.1.0',
          undefined,
        );

        // Verify NO Cargo.toml files were updated (even though paths were specified)
        expect(packageManagement.updatePackageVersion).not.toHaveBeenCalledWith(
          expect.stringContaining('Cargo.toml'),
          expect.anything(),
          expect.anything(),
        );
      });
    });
  });

  describe('createAsyncStrategy', () => {
    it('should use PackageProcessor to process packages', async () => {
      // Setup
      const config: Partial<Config> = {
        ...defaultConfig,
        packages: ['package-a', 'package-b'],
      };

      const asyncStrategy = strategies.createAsyncStrategy(config as Config);

      // Execute
      await asyncStrategy(mockPackages);

      // Verify that packages are processed (no setTargets call since targeting is at discovery time)
      expect(PackageProcessor.prototype.processPackages).toHaveBeenCalledWith(mockPackages.packages);

      // Check logging
      expect(logging.log).toHaveBeenCalledWith('Processing 2 packages', 'info');
      expect(logging.log).toHaveBeenCalledWith('Updated 1 package(s): package-a', 'success');
    });

    it('should filter packages when runtime targets are provided', async () => {
      // Setup
      const config: Partial<Config> = {
        ...defaultConfig,
        packages: ['package-a', 'package-b'],
      };

      const asyncStrategy = strategies.createAsyncStrategy(config as Config);

      // Execute with targets (should filter to only package-b)
      await asyncStrategy(mockPackages, ['package-b']);

      // Verify that only targeted package is processed
      const expectedFilteredPackages = [
        {
          packageJson: { name: 'package-b', version: '1.0.0' },
          dir: '/test/workspace/packages/b',
          relativeDir: 'packages/b',
        },
      ];

      expect(PackageProcessor.prototype.processPackages).toHaveBeenCalledWith(expectedFilteredPackages);

      // Check filtering log messages
      expect(logging.log).toHaveBeenCalledWith('Runtime targets filter: 2 → 1 packages (package-b)', 'info');
      expect(logging.log).toHaveBeenCalledWith('Processing 1 packages', 'info');
    });

    it('should filter packages using wildcard patterns', async () => {
      // Setup with packages that have different scopes
      const mockPackagesWithScopes = {
        root: '/test/workspace',
        rootDir: '/test/workspace',
        tool: 'npm' as unknown as Tool,
        packages: [
          {
            dir: '/test/workspace/packages/a',
            relativeDir: 'packages/a',
            packageJson: { name: '@scope/package-a', version: '1.0.0' },
          },
          {
            dir: '/test/workspace/packages/b',
            relativeDir: 'packages/b',
            packageJson: { name: '@scope/package-b', version: '1.0.0' },
          },
          {
            dir: '/test/workspace/packages/c',
            relativeDir: 'packages/c',
            packageJson: { name: '@other/package-c', version: '1.0.0' },
          },
        ],
      } as unknown as PackagesWithRoot;

      const config: Partial<Config> = {
        ...defaultConfig,
        packages: ['@scope/*', '@other/package-c'],
      };

      const asyncStrategy = strategies.createAsyncStrategy(config as Config);

      // Execute with wildcard targets
      await asyncStrategy(mockPackagesWithScopes, ['@scope/*']);

      // Verify that both @scope packages are processed
      const expectedFilteredPackages = [
        {
          packageJson: { name: '@scope/package-a', version: '1.0.0' },
          dir: '/test/workspace/packages/a',
          relativeDir: 'packages/a',
        },
        {
          packageJson: { name: '@scope/package-b', version: '1.0.0' },
          dir: '/test/workspace/packages/b',
          relativeDir: 'packages/b',
        },
      ];

      expect(PackageProcessor.prototype.processPackages).toHaveBeenCalledWith(expectedFilteredPackages);

      // Check filtering log messages
      expect(logging.log).toHaveBeenCalledWith('Runtime targets filter: 3 → 2 packages (@scope/*)', 'info');
      expect(logging.log).toHaveBeenCalledWith('Processing 2 packages', 'info');
    });

    it('should process all packages when no runtime targets are provided', async () => {
      // Setup
      const config: Partial<Config> = {
        ...defaultConfig,
        packages: ['package-a', 'package-b'],
      };

      const asyncStrategy = strategies.createAsyncStrategy(config as Config);

      // Execute without runtime targets
      await asyncStrategy(mockPackages);

      // Verify that all packages are processed (no filtering)
      expect(PackageProcessor.prototype.processPackages).toHaveBeenCalledWith(mockPackages.packages);

      // Should not show runtime filter message
      expect(logging.log).toHaveBeenCalledWith('Processing 2 packages', 'info');
    });

    it('should process all pre-filtered packages', async () => {
      // Setup
      const config: Partial<Config> = {
        ...defaultConfig,
        packages: [],
      };

      const asyncStrategy = strategies.createAsyncStrategy(config as Config);

      // Execute
      await asyncStrategy(mockPackages);

      // Verify packages are processed
      expect(PackageProcessor.prototype.processPackages).toHaveBeenCalledWith(mockPackages.packages);
      expect(logging.log).toHaveBeenCalledWith('Processing 2 packages', 'info');
    });

    it('should handle case when no packages were updated', async () => {
      // Mock PackageProcessor to return no updates
      vi.mocked(PackageProcessor.prototype.processPackages, { partial: true }).mockResolvedValue({
        updatedPackages: [],
        tags: [],
      });

      const config: Partial<Config> = {
        ...defaultConfig,
      };

      const asyncStrategy = strategies.createAsyncStrategy(config as Config);

      // Execute
      await asyncStrategy(mockPackages);

      // Verify
      expect(logging.log).toHaveBeenCalledWith('No packages required a version update.', 'info');
    });
  });

  describe('createStrategy', () => {
    it('should return sync strategy when sync is true', () => {
      const config: Partial<Config> = {
        ...defaultConfig,
        sync: true,
      };

      // Since we've already tested the individual strategies, just verify the strategy map exists
      const strategyMap = strategies.createStrategyMap(config as Config);
      expect(strategyMap).toHaveProperty('sync');
    });

    it('should return async strategy when packages has one item (CLI will handle strategy selection)', () => {
      const config: Partial<Config> = {
        ...defaultConfig,
        packages: ['package-a'],
      };

      // The createStrategy function now defaults to async strategy
      // The CLI will determine the actual strategy based on resolved packages
      const strategy = strategies.createStrategy(config as Config);

      // Since it's now async strategy, it should process packages without throwing
      // (the actual strategy selection happens in the CLI)
      expect(strategy).toBeDefined();
    });

    it('should return async strategy when mainPackage is specified (CLI will handle strategy selection)', async () => {
      // The createStrategy function now defaults to async strategy
      // The CLI will determine the actual strategy based on resolved packages
      const config: Partial<Config> = {
        ...defaultConfig,
        mainPackage: 'package-a',
      };

      const strategy = strategies.createStrategy(config as Config);

      // Since it's now async strategy, it should process packages without throwing
      // (the actual strategy selection happens in the CLI)
      await expect(strategy(mockPackages)).resolves.toBeUndefined();
    });

    it('should return async strategy as default', () => {
      const config: Partial<Config> = {
        ...defaultConfig,
      };

      // Since we've already tested the individual strategies, just verify the strategy map exists
      const strategyMap = strategies.createStrategyMap(config as Config);
      expect(strategyMap).toHaveProperty('async');
    });
  });

  describe('createStrategyMap', () => {
    it('should create a map of all strategies', () => {
      const config: Partial<Config> = {
        ...defaultConfig,
      };

      const strategyMap = strategies.createStrategyMap(config as Config);

      // Instead of checking function calls, check the structure of the returned map
      expect(strategyMap).toHaveProperty('sync');
      expect(strategyMap).toHaveProperty('single');
      expect(strategyMap).toHaveProperty('async');
    });
  });
});
