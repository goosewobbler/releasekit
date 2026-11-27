import fs from 'node:fs';
import path from 'node:path';
import type { Package, Tool } from '@manypkg/get-packages';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as cargoHandler from '../../../src/cargo/cargoHandler.js';
import * as commitParser from '../../../src/changelog/commitParser.js';
import * as calculator from '../../../src/core/versionCalculator.js';
import type { PackagesWithRoot } from '../../../src/core/versionEngine.js';
import { strategyLabel, versionPackages } from '../../../src/core/versionPackages.js';
import * as gitTags from '../../../src/git/tagsAndBranches.js';
import * as tagVerification from '../../../src/git/tagVerification.js';
import * as packageManagement from '../../../src/package/packageManagement.js';
import * as pubHandler from '../../../src/pub/pubHandler.js';
import { VersionRecord } from '../../../src/record/recordFile.js';
import type { Config } from '../../../src/types.js';
import * as formatting from '../../../src/utils/formatting.js';
import * as jsonOutput from '../../../src/utils/jsonOutput.js';
import * as logging from '../../../src/utils/logging.js';

const record = VersionRecord.empty();

vi.mock('../../../src/cargo/cargoLock.js');
vi.mock('../../../src/git/tagsAndBranches.js');
vi.mock('../../../src/git/tagVerification.js');
vi.mock('../../../src/utils/logging.js');
vi.mock('../../../src/core/versionCalculator.js');
vi.mock('../../../src/package/packageManagement.js');
vi.mock('../../../src/utils/jsonOutput.js');
vi.mock('../../../src/changelog/commitParser.js');
vi.mock('../../../src/utils/formatting.js', () => ({
  formatVersionPrefix: vi.fn().mockReturnValue('v'),
  formatTag: vi.fn(),
  deriveBaselineTagPrefix: vi.fn(),
  displayTag: vi.fn(),
}));
vi.mock('../../../src/cargo/cargoHandler.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/cargo/cargoHandler.js')>()),
  isVersionedCrate: vi.fn(),
}));
vi.mock('../../../src/pub/pubHandler.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/pub/pubHandler.js')>()),
  isReleasablePubspec: vi.fn(),
}));
vi.mock('node:fs');
vi.mock('node:path');

const actualPath = await vi.importActual<typeof import('node:path')>('node:path');

const templateTag = (version: string, prefix: string, packageName?: string | null, template?: string) =>
  (template ?? '')
    .replace(/\$\{version\}/g, version)
    .replace(/\$\{prefix\}/g, prefix)
    .replace(/\$\{packageName\}/g, packageName || '');

describe('versionPackages', () => {
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

  const withPackages = (packages: unknown[]): PackagesWithRoot =>
    ({ ...mockPackages, packages }) as unknown as PackagesWithRoot;
  const rootOnlyRepo = withPackages([{ dir: '/test/workspace', packageJson: { name: 'root-pkg', version: '1.0.0' } }]);

  const rootPackagePath = '/test/workspace/package.json';
  const packageAPath = '/test/workspace/packages/a/package.json';
  const packageBPath = '/test/workspace/packages/b/package.json';

  const defaultConfig: Partial<Config> = {
    preset: 'conventionalcommits',
    versionPrefix: 'v',
    tagTemplate: '${' + 'prefix}${' + 'version}',
  };

  const run = (config: Partial<Config>, packages = mockPackages, targets?: string[], discovered?: Package[]) =>
    versionPackages(config as Config, packages, record, targets, discovered);

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(cargoHandler.isVersionedCrate).mockReturnValue(true);
    vi.mocked(pubHandler.isReleasablePubspec).mockReturnValue(true);

    vi.mocked(path.join, { partial: true }).mockImplementation((...args) => args.join('/'));
    vi.mocked(path.relative).mockImplementation(actualPath.relative);
    vi.mocked(path.resolve).mockImplementation(actualPath.resolve);
    vi.mocked(path.dirname).mockImplementation(actualPath.dirname);
    vi.mocked(fs.existsSync, { partial: true }).mockReturnValue(true);
    vi.mocked(gitTags.getLatestTag, { partial: true }).mockResolvedValue('v1.0.0');
    vi.mocked(calculator.calculateVersion, { partial: true }).mockResolvedValue('1.1.0');
    vi.mocked(formatting.formatVersionPrefix, { partial: true }).mockReturnValue('v');
    vi.mocked(formatting.formatTag, { partial: true }).mockReturnValue('v1.1.0');
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
    vi.mocked(commitParser.extractRepoLevelChangelogEntries, { partial: true }).mockResolvedValue([]);
    // Reachable baseline, so the range is bounded `<tag>..HEAD`.
    vi.mocked(tagVerification.verifyTag, { partial: true }).mockResolvedValue({ exists: true, reachable: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('strategy label', () => {
    it.each([
      [{ sync: true }, 'sync'],
      [{ sync: true, groups: { native: { packages: ['package-*'], sync: 'linked' as const } } }, 'sync'],
      [{ sync: false, groups: { native: { packages: ['package-*'], sync: 'linked' as const } } }, 'group'],
      [{ sync: false }, 'async'],
      [{ mainPackage: 'package-a' }, 'async'],
    ])('should label %o as %s', (config, label) => {
      expect(strategyLabel(config as Config)).toBe(label);
    });

    it('should record the label on the version output', async () => {
      await run({ ...defaultConfig, sync: true });
      expect(jsonOutput.setVersioningStrategy).toHaveBeenCalledWith('sync');

      vi.mocked(jsonOutput.setVersioningStrategy).mockClear();
      await run({ ...defaultConfig }, withPackages([mockPackages.packages[0]]));
      expect(jsonOutput.setVersioningStrategy).toHaveBeenCalledWith('async');
    });

    it('should keep sync: true on the sync model when groups are also set', async () => {
      const config: Partial<Config> = {
        ...defaultConfig,
        sync: true,
        groups: { native: { packages: ['package-*'], sync: 'linked' } },
      };
      await run(config);

      // isRoot on the root package.json is a sync fingerprint group mode never produces.
      expect(packageManagement.updatePackageVersion).toHaveBeenCalledWith(rootPackagePath, '1.1.0', undefined, {
        isRoot: true,
      });
    });
  });

  describe('sync', () => {
    it('should update all packages to the same version', async () => {
      const config: Partial<Config> = {
        ...defaultConfig,
        sync: true,
        commitMessage: 'chore: release ${' + 'packageName} v${' + 'version}',
      };

      await run(config);

      expect(gitTags.getLatestTag).toHaveBeenCalled();
      expect(calculator.calculateVersion).toHaveBeenCalledWith(
        config as Config,
        expect.objectContaining({
          latestTag: 'v1.0.0',
          versionPrefix: 'v',
        }),
      );

      expect(packageManagement.updatePackageVersion).toHaveBeenCalledWith(rootPackagePath, '1.1.0', undefined, {
        isRoot: true,
      });
      expect(packageManagement.updatePackageVersion).toHaveBeenCalledWith(packageAPath, '1.1.0', undefined);
      expect(packageManagement.updatePackageVersion).toHaveBeenCalledWith(packageBPath, '1.1.0', undefined);

      expect(jsonOutput.addTag).toHaveBeenCalledWith('v1.1.0');
      expect(jsonOutput.setCommitMessage).toHaveBeenCalledWith('chore: release package-a, package-b v1.1.0');
      // Sync mode shares one tag, so no per-package tag is set.
      expect(jsonOutput.setPackageUpdateTag).not.toHaveBeenCalled();
    });

    it('should default the commit message to the released names and shared version', async () => {
      await run({ ...defaultConfig, sync: true });

      expect(jsonOutput.setCommitMessage).toHaveBeenCalledWith('chore: release package-a, package-b v1.1.0');
    });

    it('should version a pub-only package and not abandon it', async () => {
      // Only the member's pubspec exists, so the run returns early unless the loop tracks it.
      const memberPubspec = '/test/workspace/packages/a/pubspec.yaml';
      vi.mocked(fs.existsSync, { partial: true }).mockImplementation((filePath) => filePath === memberPubspec);
      await run({ ...defaultConfig, sync: true });

      expect(vi.mocked(packageManagement.updatePackageVersion).mock.calls).toEqual([
        [memberPubspec, '1.1.0', false, { recordAs: 'package-a' }],
      ]);
      expect(jsonOutput.addTag).toHaveBeenCalledWith('v1.1.0');
    });

    it('should skip a pubspec that discovery would not treat as a package', async () => {
      vi.mocked(pubHandler.isReleasablePubspec).mockReturnValue(false);
      await run({ ...defaultConfig, sync: true });

      const pubspecCalls = vi
        .mocked(packageManagement.updatePackageVersion)
        .mock.calls.filter(([file]) => file.endsWith('pubspec.yaml'));
      expect(pubspecCalls).toEqual([]);
      expect(packageManagement.updatePackageVersion).toHaveBeenCalledWith(packageAPath, '1.1.0', undefined);
    });

    it('should fail rather than swallow a root native manifest that cannot be bumped', async () => {
      vi.mocked(packageManagement.updatePackageVersion).mockImplementation((file) => {
        if (file === '/test/workspace/pubspec.yaml') {
          throw new Error('No version field found in /test/workspace/pubspec.yaml');
        }
      });

      await expect(run({ ...defaultConfig, sync: true })).rejects.toThrow('No version field found');
      expect(logging.log).not.toHaveBeenCalledWith(
        expect.stringContaining('Failed to update root package.json'),
        'error',
      );
    });

    it('should still version Cargo.toml and not abandon it when npm handling is disabled on a hybrid repo', async () => {
      // The existsSync mock makes every package a hybrid (package.json & Cargo.toml).
      await run({ ...defaultConfig, sync: true, npm: { enabled: false } });

      // Root package.json calls take 4 args, member package.json calls 3.
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
      expect(packageManagement.updatePackageVersion).toHaveBeenCalledWith(
        '/test/workspace/packages/a/Cargo.toml',
        '1.1.0',
        false,
        { recordAs: 'package-a' },
      );
      // Flagged like the root package.json, so the standing-PR source check doesn't look it up as a package.
      expect(packageManagement.updatePackageVersion).toHaveBeenCalledWith(
        '/test/workspace/Cargo.toml',
        '1.1.0',
        false,
        {
          isRoot: true,
        },
      );
      // Tagging proves the run didn't early-return and abandon the written files.
      expect(jsonOutput.addTag).toHaveBeenCalledWith('v1.1.0');
    });

    it('should not version a single-package repo Cargo.toml twice when npm is disabled', async () => {
      // With npm disabled, processedPaths must still record the root so the per-package loop skips it.
      await run({ ...defaultConfig, sync: true, npm: { enabled: false } }, rootOnlyRepo);

      const cargoCalls = vi
        .mocked(packageManagement.updatePackageVersion)
        .mock.calls.filter((c) => c[0] === '/test/workspace/Cargo.toml');
      expect(cargoCalls).toHaveLength(1);
      // 'root' is tracked for the cargo-only update, so the run doesn't early-return as nothing updated.
      expect(jsonOutput.addTag).toHaveBeenCalledWith('v1.1.0');
    });

    it('should not bump the root manifests when the root package is left out of the run', async () => {
      const rootPkg = { dir: '/test/workspace', packageJson: { name: 'root-pkg', version: '1.0.0' } } as Package;
      await run({ ...defaultConfig, sync: true }, mockPackages, [], [rootPkg, ...mockPackages.packages]);

      const rootCalls = vi
        .mocked(packageManagement.updatePackageVersion)
        .mock.calls.filter(([file]) => actualPath.dirname(file) === '/test/workspace');
      expect(rootCalls).toEqual([]);
      expect(packageManagement.updatePackageVersion).toHaveBeenCalledWith(packageAPath, '1.1.0', undefined);
      expect(packageManagement.updatePackageVersion).toHaveBeenCalledWith(packageBPath, '1.1.0', undefined);
    });

    it('should use mainPackage for version calculation when specified', async () => {
      const config: Partial<Config> = { ...defaultConfig, sync: true, mainPackage: 'package-b' };

      await run(config);

      expect(calculator.calculateVersion).toHaveBeenCalledWith(
        config as Config,
        expect.objectContaining({
          path: '/test/workspace/packages/b',
          name: 'package-b',
          commitScope: ['/test/workspace'],
        }),
      );

      expect(packageManagement.updatePackageVersion).toHaveBeenCalledWith(rootPackagePath, '1.1.0', undefined, {
        isRoot: true,
      });
      expect(packageManagement.updatePackageVersion).toHaveBeenCalledWith(packageAPath, '1.1.0', undefined);
      expect(packageManagement.updatePackageVersion).toHaveBeenCalledWith(packageBPath, '1.1.0', undefined);
    });

    it('should fall back to root package if mainPackage is not found', async () => {
      const config: Partial<Config> = { ...defaultConfig, sync: true, mainPackage: 'package-z' };

      await run(config);

      expect(calculator.calculateVersion).toHaveBeenCalledWith(
        config as Config,
        expect.objectContaining({
          path: '/test/workspace',
          name: undefined,
        }),
      );
      expect(logging.log).toHaveBeenCalledWith(
        "Main package 'package-z' not found. Using the root package for the changelog.",
        'warning',
      );
    });

    it('should scope commits to the whole workspace regardless of version source package', async () => {
      const config: Partial<Config> = { ...defaultConfig, sync: true };
      await run(config);

      // packages/a is the version source; commits are checked from the root so other packages' changes still bump.
      expect(calculator.calculateVersion).toHaveBeenCalledWith(
        config as Config,
        expect.objectContaining({
          path: '/test/workspace/packages/a',
          commitScope: ['/test/workspace'],
        }),
      );
    });

    it('should fill a commit message template with the combined package names', async () => {
      await run({
        ...defaultConfig,
        sync: true,
        commitMessage: 'chore: release ${' + 'packageName}@${' + 'version} [skip-ci]',
      });

      expect(jsonOutput.setCommitMessage).toHaveBeenCalledWith('chore: release package-a, package-b@1.1.0 [skip-ci]');
    });

    it('should not include root in commit message for single-package sync repo', async () => {
      await run(
        {
          ...defaultConfig,
          sync: true,
          commitMessage: 'chore: release ${' + 'packageName} v${' + 'version} [skip ci]',
        },
        rootOnlyRepo,
      );

      // The double space left by the empty ${packageName} collapses.
      expect(jsonOutput.setCommitMessage).toHaveBeenCalledWith('chore: release v1.1.0 [skip ci]');
    });

    it('should exit early if no version change needed', async () => {
      vi.mocked(calculator.calculateVersion, { partial: true }).mockResolvedValue('');

      await run({ ...defaultConfig, sync: true });

      expect(packageManagement.updatePackageVersion).not.toHaveBeenCalled();
      expect(jsonOutput.addTag).not.toHaveBeenCalled();
      expect(jsonOutput.setCommitMessage).not.toHaveBeenCalled();
      expect(logging.log).toHaveBeenCalledWith('No version change needed', 'info');
    });

    it('should emit a baseline tag and use its prefix for getLatestTag when baselineTagTemplate is set', async () => {
      // The default formatTag mock ignores the template, so both tags would render identically.
      vi.mocked(formatting.formatTag).mockImplementation(templateTag);

      await run({ ...defaultConfig, sync: true, baselineTagTemplate: 'release/${' + 'prefix}${' + 'version}' });

      // Baseline tags stay on the source branch's history, so the semver scan filters to them.
      expect(gitTags.getLatestTag).toHaveBeenCalledWith('release/v');

      // Separate VersionOutput fields so publish can push both but skip the GitHub Release for the baseline.
      expect(jsonOutput.addTag).toHaveBeenCalledWith('v1.1.0');
      expect(jsonOutput.addBaselineTag).toHaveBeenCalledWith('release/v1.1.0');
      expect(jsonOutput.addTag).not.toHaveBeenCalledWith('release/v1.1.0');
    });

    it('should look up the tagTemplate series and emit no baseline tag when baselineTagTemplate is unset', async () => {
      await run({ ...defaultConfig, sync: true });

      expect(gitTags.getLatestTag).toHaveBeenCalledWith('v');
      expect(jsonOutput.addTag).toHaveBeenCalledWith('v1.1.0');
      expect(jsonOutput.addBaselineTag).not.toHaveBeenCalled();
    });

    it('should display previousVersion in consumer-facing form when baselineTagTemplate is set', async () => {
      vi.mocked(gitTags.getLatestTag).mockResolvedValue('release/v0.21.0');

      await run({ ...defaultConfig, sync: true, baselineTagTemplate: 'release/${' + 'prefix}${' + 'version}' });

      expect(jsonOutput.addChangelogData).toHaveBeenCalledWith(expect.objectContaining({ previousVersion: 'v0.21.0' }));
    });

    it('should skip the package-specific tag override when baselineTagTemplate is set', async () => {
      // Otherwise getLatestTagForPackage would clobber the baseline, reintroducing the unreachable-tag problem
      // baselineTagTemplate exists to fix.
      vi.mocked(gitTags.getLatestTagForPackage).mockResolvedValue('v0.99.0');
      const config: Partial<Config> = {
        ...defaultConfig,
        sync: true,
        packageSpecificTags: true,
        baselineTagTemplate: 'release/${' + 'prefix}${' + 'version}',
      };

      await run(config);

      expect(gitTags.getLatestTagForPackage).not.toHaveBeenCalled();
      expect(calculator.calculateVersion).toHaveBeenCalledWith(
        config as Config,
        expect.objectContaining({ latestTag: 'v1.0.0' }),
      );
    });

    it('should respect skip configuration', async () => {
      await run({ ...defaultConfig, sync: true, skip: ['package-b'] });

      expect(packageManagement.updatePackageVersion).toHaveBeenCalledWith(rootPackagePath, '1.1.0', undefined, {
        isRoot: true,
      });
      expect(packageManagement.updatePackageVersion).toHaveBeenCalledWith(packageAPath, '1.1.0', undefined);
      expect(packageManagement.updatePackageVersion).not.toHaveBeenCalledWith(packageBPath, '1.1.0', undefined);
    });

    describe('Changelog generation', () => {
      it('should extract changelog entries and call addChangelogData', async () => {
        await run({ ...defaultConfig, sync: true });

        expect(commitParser.extractChangelogEntriesFromCommits).toHaveBeenCalledWith(
          '/test/workspace',
          'v1.0.0..HEAD',
          'conventionalcommits',
          ['/test/workspace'],
        );
        expect(jsonOutput.addChangelogData).toHaveBeenCalledWith({
          packageName: 'monorepo',
          version: '1.1.0',
          previousVersion: 'v1.0.0',
          revisionRange: 'v1.0.0..HEAD',
          repoUrl: null,
          entries: [{ type: 'added', description: 'New feature' }],
          tag: 'v1.1.0',
        });
      });

      it('should warn loudly and omit previousVersion when the baseline tag is unverifiable', async () => {
        vi.mocked(tagVerification.verifyTag, { partial: true }).mockResolvedValue({
          exists: true,
          reachable: false,
          error: 'exists but is not an ancestor of HEAD',
        });

        await run({ ...defaultConfig, sync: true });

        expect(commitParser.extractChangelogEntriesFromCommits).toHaveBeenCalledWith(
          '/test/workspace',
          'HEAD',
          'conventionalcommits',
          ['/test/workspace'],
        );
        expect(logging.log).toHaveBeenCalledWith(expect.stringContaining('could not be verified from HEAD'), 'warning');
        // previousVersion omitted so the changelog doesn't claim a baseline it never diffed against.
        expect(jsonOutput.addChangelogData).toHaveBeenCalledWith(
          expect.objectContaining({ previousVersion: null, revisionRange: 'HEAD' }),
        );
      });

      it('should use mainPackage name when specified', async () => {
        await run({ ...defaultConfig, sync: true, mainPackage: 'package-a' });

        expect(jsonOutput.addChangelogData).toHaveBeenCalledWith(expect.objectContaining({ packageName: 'package-a' }));
      });

      it('should use HEAD as revision range when no tag exists', async () => {
        vi.mocked(gitTags.getLatestTag, { partial: true }).mockResolvedValue('');

        await run({ ...defaultConfig, sync: true });

        expect(commitParser.extractChangelogEntriesFromCommits).toHaveBeenCalledWith(
          '/test/workspace',
          'HEAD',
          'conventionalcommits',
          ['/test/workspace'],
        );
        expect(jsonOutput.addChangelogData).toHaveBeenCalledWith(
          expect.objectContaining({ revisionRange: 'HEAD', previousVersion: null }),
        );
      });

      it('should use baseRef for revision range when config.baseRef is set', async () => {
        await run({ ...defaultConfig, sync: true, baseRef: 'deadbeef1234' });

        expect(commitParser.extractChangelogEntriesFromCommits).toHaveBeenCalledWith(
          '/test/workspace',
          'deadbeef1234..HEAD',
          'conventionalcommits',
          ['/test/workspace'],
        );
      });

      it('should fall back to HEAD when baseRef cannot be resolved by git', async () => {
        vi.mocked(tagVerification.verifyTag, { partial: true }).mockResolvedValue({
          exists: false,
          reachable: false,
          error: "Ref 'nonexistent-sha' not found in repository",
        });

        await run({ ...defaultConfig, sync: true, baseRef: 'nonexistent-sha' });

        expect(commitParser.extractChangelogEntriesFromCommits).toHaveBeenCalledWith(
          '/test/workspace',
          'HEAD',
          'conventionalcommits',
          ['/test/workspace'],
        );
      });

      it('should create one tag per workspace package when packageSpecificTags is true', async () => {
        vi.mocked(formatting.formatTag, { partial: true }).mockImplementation((_version, _prefix, packageName) =>
          packageName ? `${packageName}-v1.1.0` : 'v1.1.0',
        );

        await run({
          ...defaultConfig,
          sync: true,
          packageSpecificTags: true,
          tagTemplate: '${' + 'packageName}-${' + 'prefix}${' + 'version}',
        });

        expect(jsonOutput.addTag).toHaveBeenCalledWith('package-a-v1.1.0');
        expect(jsonOutput.addTag).toHaveBeenCalledWith('package-b-v1.1.0');
        expect(jsonOutput.addTag).toHaveBeenCalledTimes(2);
        expect(jsonOutput.setPackageUpdateTag).toHaveBeenCalledWith('package-a', 'package-a-v1.1.0');
        expect(jsonOutput.setPackageUpdateTag).toHaveBeenCalledWith('package-b', 'package-b-v1.1.0');
      });

      it('should emit one changelog entry per workspace package when packageSpecificTags is true', async () => {
        await run({ ...defaultConfig, sync: true, packageSpecificTags: true });

        expect(jsonOutput.addChangelogData).toHaveBeenCalledWith(expect.objectContaining({ packageName: 'package-a' }));
        expect(jsonOutput.addChangelogData).toHaveBeenCalledWith(expect.objectContaining({ packageName: 'package-b' }));
        expect(jsonOutput.addChangelogData).toHaveBeenCalledTimes(2);
      });

      it('should emit a single monorepo changelog entry when packageSpecificTags is false', async () => {
        await run({ ...defaultConfig, sync: true, packageSpecificTags: false });

        expect(jsonOutput.addChangelogData).toHaveBeenCalledWith(expect.objectContaining({ packageName: 'monorepo' }));
        expect(jsonOutput.addChangelogData).toHaveBeenCalledTimes(1);
      });

      it('should fall through to mainPkgName when packageSpecificTags is true in a single-package repo', async () => {
        await run({ ...defaultConfig, sync: true, packageSpecificTags: true }, rootOnlyRepo);

        // The root is the only package, so there are no workspace entries and, with no mainPackage, the one entry is 'monorepo'.
        expect(jsonOutput.addChangelogData).toHaveBeenCalledTimes(1);
        expect(jsonOutput.addChangelogData).toHaveBeenCalledWith(expect.objectContaining({ packageName: 'monorepo' }));
      });

      it('should create fallback changelog entry when no commits found', async () => {
        vi.mocked(commitParser.extractChangelogEntriesFromCommits, { partial: true }).mockResolvedValue([]);

        await run({ ...defaultConfig, sync: true });

        expect(jsonOutput.addChangelogData).toHaveBeenCalledWith(
          expect.objectContaining({
            entries: [{ type: 'changed', description: 'Update version to 1.1.0' }],
          }),
        );
      });
    });
  });

  describe('per package', () => {
    const packageA = mockPackages.packages[0];

    it('should release a lone package on its own, at its own version', async () => {
      const config: Partial<Config> = {
        ...defaultConfig,
        commitMessage: 'chore: release ${' + 'packageName} v${' + 'version}',
      };

      await run(config, withPackages([packageA]));

      expect(jsonOutput.setVersioningStrategy).toHaveBeenCalledWith('async');
      expect(gitTags.getLatestTag).toHaveBeenCalled();
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
        rootPackagePath,
        expect.anything(),
        expect.anything(),
        expect.anything(),
      );

      expect(jsonOutput.addTag).toHaveBeenCalledWith('v1.1.0');
      expect(jsonOutput.setPackageUpdateTag).toHaveBeenCalledWith('package-a', 'v1.1.0');
      expect(jsonOutput.setCommitMessage).toHaveBeenCalledWith('chore: release package-a v1.1.0');
    });

    it('should release every changed package at its own version, not just mainPackage', async () => {
      vi.mocked(calculator.calculateVersion).mockImplementation(async (_config, { name }) =>
        name === 'package-a' ? '1.1.0' : '2.0.0',
      );
      vi.mocked(formatting.formatTag).mockImplementation(
        (version, _prefix, packageName) => `${packageName}@v${version}`,
      );

      await run({ ...defaultConfig, mainPackage: 'package-a' });

      expect(jsonOutput.setVersioningStrategy).toHaveBeenCalledWith('async');
      expect(packageManagement.updatePackageVersion).toHaveBeenCalledWith(packageAPath, '1.1.0', undefined);
      expect(packageManagement.updatePackageVersion).toHaveBeenCalledWith(packageBPath, '2.0.0', undefined);
      expect(jsonOutput.addTag).toHaveBeenCalledWith('package-a@v1.1.0');
      expect(jsonOutput.addTag).toHaveBeenCalledWith('package-b@v2.0.0');
      expect(jsonOutput.setCommitMessage).toHaveBeenCalledWith('chore: release package-a@1.1.0, package-b@2.0.0');
      expect(logging.log).toHaveBeenCalledWith('Versioning 2 package(s) as async', 'info');
      expect(logging.log).toHaveBeenCalledWith('Prepared 2 package(s): package-a@1.1.0, package-b@2.0.0', 'success');
    });

    it('should not tag a package with no manifest to bump', async () => {
      vi.mocked(fs.existsSync, { partial: true }).mockReturnValue(false);
      await run({ ...defaultConfig }, withPackages([packageA]));

      expect(jsonOutput.addTag).not.toHaveBeenCalled();
      expect(jsonOutput.addChangelogData).not.toHaveBeenCalled();
    });

    it('should update pubspec.yaml', async () => {
      await run({ ...defaultConfig }, withPackages([packageA]));

      expect(packageManagement.updatePackageVersion).toHaveBeenCalledWith(
        '/test/workspace/packages/a/pubspec.yaml',
        '1.1.0',
        false,
        { recordAs: 'package-a' },
      );
    });

    it('should exit early if no version change needed', async () => {
      vi.mocked(calculator.calculateVersion, { partial: true }).mockResolvedValue('');

      await run({ ...defaultConfig });

      expect(packageManagement.updatePackageVersion).not.toHaveBeenCalled();
      expect(jsonOutput.addTag).not.toHaveBeenCalled();
      expect(jsonOutput.setCommitMessage).not.toHaveBeenCalled();
      expect(logging.log).toHaveBeenCalledWith('No packages required a version update.', 'info');
    });

    describe('runtime targets', () => {
      it('should release only the targeted packages', async () => {
        await run({ ...defaultConfig }, mockPackages, ['package-b']);

        expect(calculator.calculateVersion).toHaveBeenCalledTimes(1);
        expect(calculator.calculateVersion).toHaveBeenCalledWith(
          expect.anything(),
          expect.objectContaining({ name: 'package-b' }),
        );
        expect(packageManagement.updatePackageVersion).toHaveBeenCalledWith(packageBPath, '1.1.0', undefined);
        expect(packageManagement.updatePackageVersion).not.toHaveBeenCalledWith(
          packageAPath,
          expect.anything(),
          expect.anything(),
        );
      });

      it('should match targets by wildcard', async () => {
        const scoped = withPackages([
          { dir: '/test/workspace/packages/a', packageJson: { name: '@scope/package-a', version: '1.0.0' } },
          { dir: '/test/workspace/packages/b', packageJson: { name: '@scope/package-b', version: '1.0.0' } },
          { dir: '/test/workspace/packages/c', packageJson: { name: '@other/package-c', version: '1.0.0' } },
        ]);

        await run({ ...defaultConfig }, scoped, ['@scope/*']);

        const released = vi.mocked(packageManagement.updatePackageVersion).mock.calls.map(([file]) => file);
        expect(released).toContain(packageAPath);
        expect(released).toContain(packageBPath);
        expect(released).not.toContain('/test/workspace/packages/c/package.json');
      });
    });

    describe('Cargo.toml support', () => {
      const hybridPackages = withPackages([
        {
          dir: '/test/workspace/hybrid-pkg',
          relativeDir: 'hybrid-pkg',
          packageJson: { name: 'hybrid-package', version: '0.1.0' },
        },
      ]);
      const hybridPackageJson = '/test/workspace/hybrid-pkg/package.json';
      const hybridCargo = '/test/workspace/hybrid-pkg/Cargo.toml';

      it.each([
        ['cargo.enabled is true', { enabled: true }],
        ['cargo config is unset', undefined],
      ])('should update Cargo.toml in the package root when %s', async (_label, cargo) => {
        await run({ ...defaultConfig, cargo }, hybridPackages);

        expect(packageManagement.updatePackageVersion).toHaveBeenCalledWith(hybridPackageJson, '1.1.0', undefined);
        expect(packageManagement.updatePackageVersion).toHaveBeenCalledWith(hybridCargo, '1.1.0', false, {
          recordAs: 'hybrid-package',
        });
      });

      it.each([
        ['cargo.enabled is false', { enabled: false }],
        ['cargo.enabled is false, even with cargo.paths', { enabled: false, paths: ['src', 'crates/core'] }],
      ])('should not update Cargo.toml when %s', async (_label, cargo) => {
        await run({ ...defaultConfig, cargo }, hybridPackages);

        expect(packageManagement.updatePackageVersion).toHaveBeenCalledWith(hybridPackageJson, '1.1.0', undefined);
        expect(packageManagement.updatePackageVersion).not.toHaveBeenCalledWith(
          expect.stringContaining('Cargo.toml'),
          expect.anything(),
          expect.anything(),
          expect.anything(),
        );
      });

      it('should handle missing Cargo.toml gracefully when cargo is enabled', async () => {
        vi.mocked(fs.existsSync, { partial: true }).mockImplementation(
          (filePath) => !String(filePath).endsWith('Cargo.toml'),
        );

        await run({ ...defaultConfig, cargo: { enabled: true } }, hybridPackages);

        expect(packageManagement.updatePackageVersion).toHaveBeenCalledWith(hybridPackageJson, '1.1.0', undefined);
        expect(packageManagement.updatePackageVersion).not.toHaveBeenCalledWith(
          hybridCargo,
          expect.anything(),
          expect.anything(),
          expect.anything(),
        );
      });

      it('should apply the same version to both package.json and Cargo.toml', async () => {
        vi.mocked(calculator.calculateVersion, { partial: true }).mockResolvedValue('1.2.0-next.0');

        await run({ ...defaultConfig, cargo: { enabled: true } }, hybridPackages);

        expect(packageManagement.updatePackageVersion).toHaveBeenCalledWith(
          hybridPackageJson,
          '1.2.0-next.0',
          undefined,
        );
        expect(packageManagement.updatePackageVersion).toHaveBeenCalledWith(hybridCargo, '1.2.0-next.0', false, {
          recordAs: 'hybrid-package',
        });
      });
    });
  });
});
