import fs from 'node:fs';
import path from 'node:path';
import type { Package, Tool } from '@manypkg/get-packages';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as commitParser from '../../../src/changelog/commitParser.js';
import * as calculator from '../../../src/core/versionCalculator.js';
import type { PackagesWithRoot } from '../../../src/core/versionEngine.js';
import * as strategies from '../../../src/core/versionStrategies.js';
import * as gitCommands from '../../../src/git/commands.js';
import * as gitTags from '../../../src/git/tagsAndBranches.js';
import * as tagVerification from '../../../src/git/tagVerification.js';
import * as packageManagement from '../../../src/package/packageManagement.js';
import { PackageProcessor } from '../../../src/package/packageProcessor.js';
import type { Config } from '../../../src/types.js';
import * as formatting from '../../../src/utils/formatting.js';
import * as jsonOutput from '../../../src/utils/jsonOutput.js';
import * as logging from '../../../src/utils/logging.js';

vi.mock('../../../src/cargo/cargoLock.js');
vi.mock('../../../src/git/commands.js');
vi.mock('../../../src/git/tagsAndBranches.js');
vi.mock('../../../src/git/tagVerification.js');
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
  deriveBaselineTagPrefix: vi.fn().mockImplementation((template, formattedPrefix, packageName) => {
    if (!template) {
      return undefined;
    }
    return template
      .split('${' + 'version}')[0]
      .replace(/\$\{prefix\}/g, formattedPrefix)
      .replace(/\$\{packageName\}/g, packageName ?? '');
  }),
  displayTag: vi.fn().mockImplementation((tag, baselineTagPrefix, formattedPrefix) => {
    if (!baselineTagPrefix || !tag.startsWith(baselineTagPrefix)) {
      return tag;
    }
    return `${formattedPrefix}${tag.slice(baselineTagPrefix.length)}`;
  }),
}));
vi.mock('../../../src/package/packageProcessor.js');
vi.mock('node:fs');
vi.mock('node:path');

const git = {
  ...gitCommands,
  ...gitTags,
};

describe('Version Strategies', () => {
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

  const rootPackagePath = '/test/workspace/package.json';
  const packageAPath = '/test/workspace/packages/a/package.json';
  const packageBPath = '/test/workspace/packages/b/package.json';

  const defaultConfig: Partial<Config> = {
    preset: 'conventionalcommits',
    versionPrefix: 'v',
    tagTemplate: '${' + 'prefix}${' + 'version}',
  };

  beforeEach(() => {
    vi.resetAllMocks();

    vi.mocked(path.join, { partial: true }).mockImplementation((...args) => args.join('/'));
    vi.mocked(fs.existsSync, { partial: true }).mockReturnValue(true);
    vi.mocked(git.getLatestTag, { partial: true }).mockResolvedValue('v1.0.0');
    vi.mocked(calculator.calculateVersion, { partial: true }).mockResolvedValue('1.1.0');
    vi.mocked(formatting.formatVersionPrefix, { partial: true }).mockReturnValue('v');
    vi.mocked(formatting.formatTag, { partial: true }).mockReturnValue('v1.1.0');
    vi.mocked(formatting.formatCommitMessage, { partial: true }).mockReturnValue('chore: release package-a v1.1.0');
    vi.mocked(formatting.deriveBaselineTagPrefix, { partial: true }).mockImplementation(
      (template, formattedPrefix, packageName) => {
        if (!template) {
          return undefined;
        }
        return template
          .split('${' + 'version}')[0]
          .replace(/\$\{prefix\}/g, formattedPrefix)
          .replace(/\$\{packageName\}/g, packageName ?? '');
      },
    );
    vi.mocked(formatting.displayTag, { partial: true }).mockImplementation(
      (tag, baselineTagPrefix, formattedPrefix) => {
        if (!baselineTagPrefix || !tag.startsWith(baselineTagPrefix)) {
          return tag;
        }
        return `${formattedPrefix}${tag.slice(baselineTagPrefix.length)}`;
      },
    );
    vi.mocked(commitParser.extractChangelogEntriesFromCommits, { partial: true }).mockResolvedValue([
      { type: 'added', description: 'New feature' },
    ]);
    // Reachable baseline, so the range is bounded `<tag>..HEAD`.
    vi.mocked(tagVerification.verifyTag, { partial: true }).mockResolvedValue({ exists: true, reachable: true });

    vi.mocked(PackageProcessor.prototype.processPackages, { partial: true }).mockResolvedValue({
      updatedPackages: [{ name: 'package-a', version: '1.1.0', path: '/test/workspace/packages/a' }],
      tags: ['v1.1.0'],
      commitMessage: 'chore: release package-a v1.1.0',
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const shouldProcessPackage = (pkg: Package, config: Partial<Config>): boolean => {
    const pkgName = pkg.packageJson.name;

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
      // Replace the beforeEach fixed-string mock so setCommitMessage reflects the combined package name.
      vi.mocked(formatting.formatCommitMessage).mockImplementation((template, version, packageName) =>
        template.replace(/\$\{version\}/g, version).replace(/\$\{packageName\}/g, packageName || ''),
      );

      const config: Partial<Config> = {
        ...defaultConfig,
        sync: true,
        commitMessage: 'chore: release ${' + 'packageName} v${' + 'version}',
      };

      const syncStrategy = strategies.createSyncStrategy(config as Config);

      await syncStrategy(mockPackages);

      expect(git.getLatestTag).toHaveBeenCalled();
      expect(calculator.calculateVersion).toHaveBeenCalledWith(
        config as Config,
        expect.objectContaining({
          latestTag: 'v1.0.0',
          versionPrefix: 'v',
        }),
      );

      expect(packageManagement.updatePackageVersion).toHaveBeenCalledWith(rootPackagePath, '1.1.0', undefined, true);

      expect(packageManagement.updatePackageVersion).toHaveBeenCalledWith(packageAPath, '1.1.0', undefined);
      expect(packageManagement.updatePackageVersion).toHaveBeenCalledWith(packageBPath, '1.1.0', undefined);

      expect(formatting.formatCommitMessage).toHaveBeenCalledWith(
        config.commitMessage,
        '1.1.0',
        'package-a, package-b',
        undefined,
      );

      expect(jsonOutput.addTag).toHaveBeenCalledWith('v1.1.0');
      expect(jsonOutput.setCommitMessage).toHaveBeenCalledWith('chore: release package-a, package-b v1.1.0');
      // Sync mode shares one tag, so no per-package tag is set.
      expect(jsonOutput.setPackageUpdateTag).not.toHaveBeenCalled();
    });

    it('should still version Cargo.toml and not abandon it when npm handling is disabled on a hybrid repo', async () => {
      // The existsSync mock makes every package a hybrid (package.json & Cargo.toml).
      const config: Partial<Config> = { ...defaultConfig, sync: true, npm: { enabled: false } };
      const syncStrategy = strategies.createSyncStrategy(config as Config);

      await syncStrategy(mockPackages);

      // Root package.json calls take 4 args, members 3.
      expect(packageManagement.updatePackageVersion).not.toHaveBeenCalledWith(
        packageAPath,
        expect.anything(),
        expect.anything(),
      );
      expect(packageManagement.updatePackageVersion).not.toHaveBeenCalledWith(
        rootPackagePath,
        expect.anything(),
        expect.anything(),
        expect.anything(),
      );
      // updateCargoFiles passes dryRun=false.
      expect(packageManagement.updatePackageVersion).toHaveBeenCalledWith(
        '/test/workspace/packages/a/Cargo.toml',
        '1.1.0',
        false,
      );
      expect(packageManagement.updatePackageVersion).toHaveBeenCalledWith('/test/workspace/Cargo.toml', '1.1.0', false);
      // Tagging proves the run didn't early-return and abandon the written files.
      expect(jsonOutput.addTag).toHaveBeenCalledWith('v1.1.0');
    });

    it('should not version a single-package repo Cargo.toml twice when npm is disabled', async () => {
      // With npm disabled, processedPaths must still record the root so the per-package loop skips it.
      const singlePkg = {
        root: '/test/workspace',
        packages: [{ dir: '/test/workspace', packageJson: { name: 'root-pkg', version: '1.0.0' } }],
      };
      const config: Partial<Config> = { ...defaultConfig, sync: true, npm: { enabled: false } };
      await strategies.createSyncStrategy(config as Config)(singlePkg as typeof mockPackages);

      const cargoCalls = vi
        .mocked(packageManagement.updatePackageVersion)
        .mock.calls.filter((c) => c[0] === '/test/workspace/Cargo.toml');
      expect(cargoCalls).toHaveLength(1);
      // 'root' is tracked for the cargo-only update, so the run doesn't early-return as nothing updated.
      expect(jsonOutput.addTag).toHaveBeenCalledWith('v1.1.0');
    });

    it('should use mainPackage for version calculation when specified', async () => {
      const config: Partial<Config> = {
        ...defaultConfig,
        sync: true,
        mainPackage: 'package-b',
      };

      const syncStrategy = strategies.createSyncStrategy(config as Config);

      await syncStrategy(mockPackages);

      expect(calculator.calculateVersion).toHaveBeenCalledWith(
        config as Config,
        expect.objectContaining({
          path: '/test/workspace/packages/b',
          name: 'package-b',
          commitCheckPath: '/test/workspace',
        }),
      );

      expect(packageManagement.updatePackageVersion).toHaveBeenCalledWith(rootPackagePath, '1.1.0', undefined, true);
      expect(packageManagement.updatePackageVersion).toHaveBeenCalledWith(packageAPath, '1.1.0', undefined);
      expect(packageManagement.updatePackageVersion).toHaveBeenCalledWith(packageBPath, '1.1.0', undefined);
    });

    it('should fall back to root package if mainPackage is not found', async () => {
      const config: Partial<Config> = {
        ...defaultConfig,
        sync: true,
        mainPackage: 'package-z',
      };

      const syncStrategy = strategies.createSyncStrategy(config as Config);

      await syncStrategy(mockPackages);

      expect(calculator.calculateVersion).toHaveBeenCalledWith(
        config as Config,
        expect.objectContaining({
          path: '/test/workspace',
          name: undefined,
        }),
      );

      expect(logging.log).toHaveBeenCalledWith(
        "Main package 'package-z' not found. Using root package for version determination.",
        'warning',
      );
    });

    it('should pass commitCheckPath as repo root regardless of version source package', async () => {
      const config: Partial<Config> = {
        ...defaultConfig,
        sync: true,
      };

      const syncStrategy = strategies.createSyncStrategy(config as Config);
      await syncStrategy(mockPackages);

      // packages/a is the version source; commits are checked from the root so other packages' changes still bump.
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

      expect(formatting.formatCommitMessage).toHaveBeenCalledWith(
        'chore: release ${' + 'packageName}@${' + 'version} [skip-ci]',
        '1.1.0',
        'package-a, package-b',
        undefined,
      );
    });

    it('should not include root in commit message for single-package sync repo', async () => {
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

      // With no workspace packages formatCommitMessage is bypassed to avoid its spurious warning, and the
      // double space left by the empty ${packageName} collapses.
      expect(jsonOutput.setCommitMessage).toHaveBeenCalledWith('chore: release v1.1.0 [skip ci]');
    });

    it('should exit early if no version change needed', async () => {
      vi.mocked(calculator.calculateVersion, { partial: true }).mockResolvedValue('');

      const config: Partial<Config> = {
        ...defaultConfig,
        sync: true,
      };

      const syncStrategy = strategies.createSyncStrategy(config as Config);

      await syncStrategy(mockPackages);

      expect(packageManagement.updatePackageVersion).not.toHaveBeenCalled();
      expect(jsonOutput.addTag).not.toHaveBeenCalled();
      expect(jsonOutput.setCommitMessage).not.toHaveBeenCalled();
      expect(logging.log).toHaveBeenCalledWith('No version change needed', 'info');
    });

    it('should emit a baseline tag and use its prefix for getLatestTag when baselineTagTemplate is set', async () => {
      // The default formatTag mock ignores the template, so both tags would render identically.
      vi.mocked(formatting.formatTag).mockImplementation((version, prefix, packageName, template) => {
        if (template) {
          return template
            .replace(/\$\{version\}/g, version)
            .replace(/\$\{prefix\}/g, prefix)
            .replace(/\$\{packageName\}/g, packageName || '');
        }
        return packageName ? `${packageName}@${prefix}${version}` : `${prefix}${version}`;
      });

      const config: Partial<Config> = {
        ...defaultConfig,
        sync: true,
        baselineTagTemplate: 'release/${' + 'prefix}${' + 'version}',
      };

      const syncStrategy = strategies.createSyncStrategy(config as Config);

      await syncStrategy(mockPackages);

      // Baseline tags stay on the source branch's history, so the semver scan filters to them.
      expect(git.getLatestTag).toHaveBeenCalledWith('release/v');

      // Separate VersionOutput fields so publish can push both but skip the GitHub Release for the baseline.
      expect(jsonOutput.addTag).toHaveBeenCalledWith('v1.1.0');
      expect(jsonOutput.addBaselineTag).toHaveBeenCalledWith('release/v1.1.0');
      expect(jsonOutput.addTag).not.toHaveBeenCalledWith('release/v1.1.0');
    });

    it('should not emit a baseline tag or alter getLatestTag when baselineTagTemplate is unset', async () => {
      const config: Partial<Config> = {
        ...defaultConfig,
        sync: true,
      };

      const syncStrategy = strategies.createSyncStrategy(config as Config);

      await syncStrategy(mockPackages);

      expect(git.getLatestTag).toHaveBeenCalledWith(undefined);
      expect(jsonOutput.addTag).toHaveBeenCalledWith('v1.1.0');
      expect(jsonOutput.addBaselineTag).not.toHaveBeenCalled();
    });

    it('should display previousVersion in consumer-facing form when baselineTagTemplate is set', async () => {
      vi.mocked(git.getLatestTag).mockResolvedValue('release/v0.21.0');

      const config: Partial<Config> = {
        ...defaultConfig,
        sync: true,
        baselineTagTemplate: 'release/${' + 'prefix}${' + 'version}',
      };

      const syncStrategy = strategies.createSyncStrategy(config as Config);

      await syncStrategy(mockPackages);

      expect(jsonOutput.addChangelogData).toHaveBeenCalledWith(
        expect.objectContaining({
          previousVersion: 'v0.21.0',
        }),
      );
    });

    it('should skip the package-specific tag override when baselineTagTemplate is set', async () => {
      // Otherwise getLatestTagForPackage would clobber the baseline, reintroducing the unreachable-tag problem
      // baselineTagTemplate exists to fix.
      vi.mocked(git.getLatestTagForPackage).mockResolvedValue('v0.99.0');
      const config: Partial<Config> = {
        ...defaultConfig,
        sync: true,
        packageSpecificTags: true,
        baselineTagTemplate: 'release/${' + 'prefix}${' + 'version}',
      };

      const syncStrategy = strategies.createSyncStrategy(config as Config);

      await syncStrategy(mockPackages);

      expect(git.getLatestTagForPackage).not.toHaveBeenCalled();
      expect(calculator.calculateVersion).toHaveBeenCalledWith(
        config as Config,
        expect.objectContaining({ latestTag: 'v1.0.0' }),
      );
    });

    it('should respect skip configuration', async () => {
      const config: Partial<Config> = {
        ...defaultConfig,
        sync: true,
        skip: ['package-b'],
      };

      const syncStrategy = strategies.createSyncStrategy(config as Config);

      await syncStrategy(mockPackages);

      expect(packageManagement.updatePackageVersion).toHaveBeenCalledWith(rootPackagePath, '1.1.0', undefined, true);
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

      it('should warn loudly and omit previousVersion when the baseline tag is unverifiable', async () => {
        vi.mocked(tagVerification.verifyTag, { partial: true }).mockResolvedValue({
          exists: true,
          reachable: false,
          error: 'exists but is not an ancestor of HEAD',
        });

        const config: Partial<Config> = { ...defaultConfig, sync: true };
        const syncStrategy = strategies.createSyncStrategy(config as Config);

        await syncStrategy(mockPackages);

        expect(commitParser.extractChangelogEntriesFromCommits).toHaveBeenCalledWith('/test/workspace', 'HEAD');
        expect(logging.log).toHaveBeenCalledWith(expect.stringContaining('could not be verified from HEAD'), 'warning');
        // previousVersion omitted so the changelog doesn't claim a baseline it never diffed against.
        expect(jsonOutput.addChangelogData).toHaveBeenCalledWith(
          expect.objectContaining({ previousVersion: null, revisionRange: 'HEAD' }),
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

      it('should use baseRef for revision range when config.baseRef is set', async () => {
        const config: Partial<Config> = {
          ...defaultConfig,
          sync: true,
          baseRef: 'deadbeef1234',
        };

        const syncStrategy = strategies.createSyncStrategy(config as Config);
        await syncStrategy(mockPackages);

        expect(commitParser.extractChangelogEntriesFromCommits).toHaveBeenCalledWith(
          '/test/workspace',
          'deadbeef1234..HEAD',
        );
      });

      it('should fall back to HEAD when baseRef cannot be resolved by git', async () => {
        vi.mocked(tagVerification.verifyTag, { partial: true }).mockResolvedValue({
          exists: false,
          reachable: false,
          error: "Ref 'nonexistent-sha' not found in repository",
        });

        const config: Partial<Config> = {
          ...defaultConfig,
          sync: true,
          baseRef: 'nonexistent-sha',
        };

        const syncStrategy = strategies.createSyncStrategy(config as Config);
        await syncStrategy(mockPackages);

        expect(commitParser.extractChangelogEntriesFromCommits).toHaveBeenCalledWith('/test/workspace', 'HEAD');
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
        expect(jsonOutput.setPackageUpdateTag).toHaveBeenCalledWith('package-a', 'package-a-v1.1.0');
        expect(jsonOutput.setPackageUpdateTag).toHaveBeenCalledWith('package-b', 'package-b-v1.1.0');
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

        // With no mainPackage or workspace packages, mainPkgName is undefined and the entry falls back to 'monorepo'.
        expect(jsonOutput.addChangelogData).toHaveBeenCalledTimes(1);
        expect(jsonOutput.addChangelogData).toHaveBeenCalledWith(expect.objectContaining({ packageName: 'monorepo' }));
      });

      it('should create fallback changelog entry when no commits found', async () => {
        vi.mocked(commitParser.extractChangelogEntriesFromCommits, { partial: true }).mockResolvedValue([]);

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
      const config: Partial<Config> = {
        ...defaultConfig,
        mainPackage: 'package-a',
        commitMessage: 'chore: release ${' + 'packageName} v${' + 'version}',
      };

      const singleStrategy = strategies.createSingleStrategy(config as Config);

      await singleStrategy(mockPackages);

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

      expect(packageManagement.updatePackageVersion).toHaveBeenCalledWith(packageAPath, '1.1.0', undefined);
      expect(packageManagement.updatePackageVersion).not.toHaveBeenCalledWith(
        packageBPath,
        expect.anything(),
        expect.anything(),
      );

      expect(jsonOutput.addTag).toHaveBeenCalledWith('v1.1.0');
      expect(jsonOutput.setPackageUpdateTag).toHaveBeenCalledWith('package-a', 'v1.1.0');
      expect(jsonOutput.setCommitMessage).toHaveBeenCalledWith('chore: release package-a v1.1.0');
    });

    it('should warn and omit previousVersion when the baseline tag is unverifiable', async () => {
      vi.mocked(tagVerification.verifyTag, { partial: true }).mockResolvedValue({
        exists: true,
        reachable: false,
        error: 'exists but is not an ancestor of HEAD',
      });

      const config: Partial<Config> = { ...defaultConfig, mainPackage: 'package-a' };
      const singleStrategy = strategies.createSingleStrategy(config as Config);

      await singleStrategy(mockPackages);

      expect(logging.log).toHaveBeenCalledWith(expect.stringContaining('could not be verified from HEAD'), 'warning');
      expect(jsonOutput.addChangelogData).toHaveBeenCalledWith(
        expect.objectContaining({ previousVersion: null, revisionRange: 'HEAD' }),
      );
    });

    it('should use packageName in commit message template', async () => {
      const config: Partial<Config> = {
        ...defaultConfig,
        mainPackage: 'package-a',
        commitMessage: 'chore: release ${' + 'packageName}@${' + 'version} [skip-ci]',
      };

      const singleStrategy = strategies.createSingleStrategy(config as Config);

      await singleStrategy(mockPackages);

      expect(formatting.formatCommitMessage).toHaveBeenCalledWith(
        'chore: release ${' + 'packageName}@${' + 'version} [skip-ci]',
        '1.1.0',
        'package-a',
      );
    });

    it('should throw if packages array is not exactly one item', async () => {
      const config1: Partial<Config> = {
        ...defaultConfig,
        packages: [],
      };

      const config2: Partial<Config> = {
        ...defaultConfig,
        packages: ['package-a', 'package-b'],
      };

      const singleStrategy1 = strategies.createSingleStrategy(config1 as Config);
      const singleStrategy2 = strategies.createSingleStrategy(config2 as Config);

      await expect(singleStrategy1(mockPackages)).rejects.toThrow(
        'Invalid configuration: Single mode requires either mainPackage or exactly one resolved package',
      );
      await expect(singleStrategy2(mockPackages)).rejects.toThrow(
        'Invalid configuration: Single mode requires either mainPackage or exactly one resolved package',
      );
    });

    it('should use mainPackage instead of packages array when both are provided', async () => {
      const config: Partial<Config> = {
        ...defaultConfig,
        mainPackage: 'package-b',
        packages: ['package-a'],
      };

      const singleStrategy = strategies.createSingleStrategy(config as Config);

      await singleStrategy(mockPackages);

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
      const config: Partial<Config> = {
        ...defaultConfig,
        mainPackage: 'package-z',
      };

      const singleStrategy = strategies.createSingleStrategy(config as Config);

      await expect(singleStrategy(mockPackages)).rejects.toThrow('Package not found: package-z');
    });

    it('should exit early if no version change needed', async () => {
      vi.mocked(calculator.calculateVersion, { partial: true }).mockResolvedValue('');

      const config: Partial<Config> = {
        ...defaultConfig,
        mainPackage: 'package-a',
      };

      const singleStrategy = strategies.createSingleStrategy(config as Config);

      await singleStrategy(mockPackages);

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
        const config: Partial<Config> = {
          ...defaultConfig,
          mainPackage: 'hybrid-package',
          cargo: {
            enabled: true,
          },
        };

        const singleStrategy = strategies.createSingleStrategy(config as Config);

        await singleStrategy(hybridPackages);

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

      it('should default to cargo.enabled: true when cargo config not specified', async () => {
        const config: Partial<Config> = {
          ...defaultConfig,
          mainPackage: 'hybrid-package',
        };

        const singleStrategy = strategies.createSingleStrategy(config as Config);

        await singleStrategy(hybridPackages);

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
        const config: Partial<Config> = {
          ...defaultConfig,
          mainPackage: 'hybrid-package',
          cargo: {
            enabled: false,
          },
        };

        const singleStrategy = strategies.createSingleStrategy(config as Config);

        await singleStrategy(hybridPackages);

        expect(packageManagement.updatePackageVersion).toHaveBeenCalledWith(
          '/test/workspace/hybrid-pkg/package.json',
          '1.1.0',
          undefined,
        );

        expect(packageManagement.updatePackageVersion).not.toHaveBeenCalledWith(
          '/test/workspace/hybrid-pkg/Cargo.toml',
          expect.anything(),
          expect.anything(),
        );
      });

      it('should handle missing Cargo.toml gracefully when cargo is enabled', async () => {
        vi.mocked(fs.existsSync, { partial: true }).mockImplementation((filePath) => {
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

        await singleStrategy(hybridPackages);

        expect(packageManagement.updatePackageVersion).toHaveBeenCalledWith(
          '/test/workspace/hybrid-pkg/package.json',
          '1.1.0',
          undefined,
        );

        expect(packageManagement.updatePackageVersion).not.toHaveBeenCalledWith(
          '/test/workspace/hybrid-pkg/Cargo.toml',
          expect.anything(),
          expect.anything(),
        );
      });

      it('should apply the same version to both package.json and Cargo.toml', async () => {
        vi.mocked(calculator.calculateVersion, { partial: true }).mockResolvedValue('1.2.0-next.0');

        const config: Partial<Config> = {
          ...defaultConfig,
          mainPackage: 'hybrid-package',
          cargo: {
            enabled: true,
          },
        };

        const singleStrategy = strategies.createSingleStrategy(config as Config);

        await singleStrategy(hybridPackages);

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
        const config: Partial<Config> = {
          ...defaultConfig,
          mainPackage: 'hybrid-package',
          cargo: {
            enabled: false,
            paths: ['src', 'crates/core'],
          },
        };

        const singleStrategy = strategies.createSingleStrategy(config as Config);

        await singleStrategy(hybridPackages);

        expect(packageManagement.updatePackageVersion).toHaveBeenCalledWith(
          '/test/workspace/hybrid-pkg/package.json',
          '1.1.0',
          undefined,
        );

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
      const config: Partial<Config> = {
        ...defaultConfig,
        packages: ['package-a', 'package-b'],
      };

      const asyncStrategy = strategies.createAsyncStrategy(config as Config);

      await asyncStrategy(mockPackages);

      expect(PackageProcessor.prototype.processPackages).toHaveBeenCalledWith(mockPackages.packages, '/test/workspace');

      expect(logging.log).toHaveBeenCalledWith('Processing 2 packages', 'info');
      expect(logging.log).toHaveBeenCalledWith('Updated 1 package(s): package-a', 'success');
    });

    it('should filter packages when runtime targets are provided', async () => {
      const config: Partial<Config> = {
        ...defaultConfig,
        packages: ['package-a', 'package-b'],
      };

      const asyncStrategy = strategies.createAsyncStrategy(config as Config);

      await asyncStrategy(mockPackages, ['package-b']);

      const expectedFilteredPackages = [
        {
          packageJson: { name: 'package-b', version: '1.0.0' },
          dir: '/test/workspace/packages/b',
          relativeDir: 'packages/b',
        },
      ];

      expect(PackageProcessor.prototype.processPackages).toHaveBeenCalledWith(
        expectedFilteredPackages,
        '/test/workspace',
      );

      expect(logging.log).toHaveBeenCalledWith('Runtime targets filter: 2 → 1 packages (package-b)', 'info');
      expect(logging.log).toHaveBeenCalledWith('Processing 1 packages', 'info');
    });

    it('should filter packages using wildcard patterns', async () => {
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

      await asyncStrategy(mockPackagesWithScopes, ['@scope/*']);

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

      expect(PackageProcessor.prototype.processPackages).toHaveBeenCalledWith(
        expectedFilteredPackages,
        '/test/workspace',
      );

      expect(logging.log).toHaveBeenCalledWith('Runtime targets filter: 3 → 2 packages (@scope/*)', 'info');
      expect(logging.log).toHaveBeenCalledWith('Processing 2 packages', 'info');
    });

    it('should process all packages when no runtime targets are provided', async () => {
      const config: Partial<Config> = {
        ...defaultConfig,
        packages: ['package-a', 'package-b'],
      };

      const asyncStrategy = strategies.createAsyncStrategy(config as Config);

      await asyncStrategy(mockPackages);

      expect(PackageProcessor.prototype.processPackages).toHaveBeenCalledWith(mockPackages.packages, '/test/workspace');

      expect(logging.log).toHaveBeenCalledWith('Processing 2 packages', 'info');
    });

    it('should process all pre-filtered packages', async () => {
      const config: Partial<Config> = {
        ...defaultConfig,
        packages: [],
      };

      const asyncStrategy = strategies.createAsyncStrategy(config as Config);

      await asyncStrategy(mockPackages);

      expect(PackageProcessor.prototype.processPackages).toHaveBeenCalledWith(mockPackages.packages, '/test/workspace');
      expect(logging.log).toHaveBeenCalledWith('Processing 2 packages', 'info');
    });

    it('should handle case when no packages were updated', async () => {
      vi.mocked(PackageProcessor.prototype.processPackages, { partial: true }).mockResolvedValue({
        updatedPackages: [],
        tags: [],
      });

      const config: Partial<Config> = {
        ...defaultConfig,
      };

      const asyncStrategy = strategies.createAsyncStrategy(config as Config);

      await asyncStrategy(mockPackages);

      expect(logging.log).toHaveBeenCalledWith('No packages required a version update.', 'info');
    });
  });

  describe('createStrategy', () => {
    it('should return sync strategy when sync is true', () => {
      const config: Partial<Config> = {
        ...defaultConfig,
        sync: true,
      };

      const strategyMap = strategies.createStrategyMap(config as Config);
      expect(strategyMap).toHaveProperty('sync');
    });

    it('should return async strategy when packages has one item (CLI will handle strategy selection)', () => {
      const config: Partial<Config> = {
        ...defaultConfig,
        packages: ['package-a'],
      };

      const strategy = strategies.createStrategy(config as Config);

      expect(strategy).toBeDefined();
    });

    it('should return async strategy when mainPackage is specified (CLI will handle strategy selection)', async () => {
      const config: Partial<Config> = {
        ...defaultConfig,
        mainPackage: 'package-a',
      };

      const strategy = strategies.createStrategy(config as Config);

      await expect(strategy(mockPackages)).resolves.toBeUndefined();
    });

    it('should return async strategy as default', () => {
      const config: Partial<Config> = {
        ...defaultConfig,
      };

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

      expect(strategyMap).toHaveProperty('sync');
      expect(strategyMap).toHaveProperty('single');
      expect(strategyMap).toHaveProperty('async');
      expect(strategyMap).toHaveProperty('group');
    });
  });

  describe('createStrategy group routing', () => {
    it('should route explicit version.groups through the group strategy', () => {
      const config: Partial<Config> = {
        ...defaultConfig,
        sync: false,
        groups: { native: { packages: ['@wdio/native-*'], sync: 'linked' } },
      };
      const strategy = strategies.createStrategy(config as Config);
      expect(strategy).toBeDefined();
    });

    it('should keep sync:true on the established sync strategy for back-compat', async () => {
      const config: Partial<Config> = {
        ...defaultConfig,
        sync: true,
      };
      const strategy = strategies.createStrategy(config as Config);
      // isRoot=true on the root package.json is a sync-strategy fingerprint the group strategy never produces.
      await strategy(mockPackages);
      expect(packageManagement.updatePackageVersion).toHaveBeenCalledWith(rootPackagePath, '1.1.0', undefined, true);
    });
  });
});
