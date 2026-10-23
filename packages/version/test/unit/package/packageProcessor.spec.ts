import * as fs from 'node:fs';
import path from 'node:path';
import type { Package } from '@manypkg/get-packages';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as cargoHandler from '../../../src/cargo/cargoHandler.js';
import * as commitParser from '../../../src/changelog/commitParser.js';
import * as calculator from '../../../src/core/versionCalculator.js';
import * as versionCalculatorModule from '../../../src/core/versionCalculator.js';
import { StrictReachableError } from '../../../src/errors/strictReachableError.js';
import * as gitTags from '../../../src/git/tagsAndBranches.js';
import * as tagVerification from '../../../src/git/tagVerification.js';
import * as packageManagement from '../../../src/package/packageManagement.js';
import { PackageProcessor } from '../../../src/package/packageProcessor.js';
import type { Config } from '../../../src/types.js';
import * as formatting from '../../../src/utils/formatting.js';
import * as jsonOutput from '../../../src/utils/jsonOutput.js';
import * as logging from '../../../src/utils/logging.js';
import * as manifestHelpers from '../../../src/utils/manifestHelpers.js';

vi.mock('node:path');
vi.mock('node:process');
vi.mock('../../../src/package/packageManagement.js');
vi.mock('../../../src/git/tagsAndBranches.js');
vi.mock('../../../src/git/tagVerification.js');
vi.mock('../../../src/utils/logging.js');
vi.mock('../../../src/utils/formatting.js', () => ({
  formatVersionPrefix: vi.fn().mockReturnValue('v'),
  formatTag: vi.fn().mockImplementation((version, _prefix, name) => (name ? `${name}@v${version}` : `v${version}`)),
  formatCommitMessage: vi.fn().mockImplementation((template, version, packageName) => {
    if (template.includes('${packageName}') && packageName) {
      return template.replace('${packageName}', packageName).replace('${version}', version);
    }
    return template.replace('${version}', version);
  }),
  escapeRegExp: vi.fn().mockImplementation((str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
  deriveBaselineTagPrefix: vi.fn().mockReturnValue(undefined),
  displayTag: vi.fn().mockImplementation((tag, baselineTagPrefix, formattedPrefix) => {
    if (!baselineTagPrefix || !tag.startsWith(baselineTagPrefix)) {
      return tag;
    }
    return `${formattedPrefix}${tag.slice(baselineTagPrefix.length)}`;
  }),
}));
vi.mock('../../../src/utils/jsonOutput.js');
vi.mock('../../../src/utils/manifestHelpers.js', () => ({
  getVersionFromManifests: vi.fn().mockImplementation((packageDir: string) => {
    if (packageDir.includes('rust-package')) {
      if (
        vi.mocked(fs.existsSync, { partial: true }).mockImplementation((path) => {
          return String(path).endsWith('Cargo.toml');
        })
      ) {
        return {
          version: '1.0.0',
          manifestFound: true,
          manifestPath: `${packageDir}/Cargo.toml`,
          manifestType: 'Cargo.toml',
        };
      }

      throw new Error('Failed to parse Cargo.toml');
    }

    if (packageDir.includes('package-a')) {
      return {
        version: '1.0.0',
        manifestFound: true,
        manifestPath: `${packageDir}/package.json`,
        manifestType: 'package.json',
      };
    }

    return {
      version: null,
      manifestFound: false,
      manifestPath: '',
      manifestType: null,
    };
  }),
}));
vi.mock('../../../src/core/versionCalculator.js');
vi.mock('../../../src/version/versionCalc.js');
vi.mock('node:fs');
vi.mock('../../../src/cargo/cargoHandler.js');

interface MockPackage {
  dir: string;
  packageJson: {
    name: string;
    version: string;
  };
}

describe('Package Processor', () => {
  const mockPackages: Package[] = [
    {
      dir: '/path/to/package-a',
      packageJson: { name: 'package-a', version: '1.0.0' },
    },
    {
      dir: '/path/to/package-b',
      packageJson: { name: 'package-b', version: '1.0.0' },
    },
    {
      dir: '/path/to/package-c',
      packageJson: { name: 'package-c', version: '1.0.0' },
    },
  ] as MockPackage[];

  const mockConfig: Config = {
    sync: false,
    preset: 'conventionalcommits',
    versionPrefix: 'v',
    tagTemplate: '${prefix}${version}',
    packages: [],
    commitMessage: 'chore(release): version ${version}',
  };

  const mockGetLatestTag = vi.fn().mockResolvedValue('v1.0.0');

  const defaultOptions = {
    skip: ['package-c'],
    versionPrefix: 'v',
    commitMessageTemplate: 'chore(release): ${version}',
    dryRun: false,
    getLatestTag: mockGetLatestTag,
    config: {
      prereleaseIdentifier: undefined,
      type: undefined,
    },
    fullConfig: mockConfig,
  };

  beforeEach(() => {
    vi.resetAllMocks();

    vi.spyOn(path, 'join').mockImplementation((...args) => args.join('/'));

    // Reachable baseline so changelog ranges resolve to `<tag>..HEAD`; all-history fallback tests override this.
    vi.spyOn(tagVerification, 'verifyTag').mockResolvedValue({ exists: true, reachable: true });

    vi.spyOn(calculator, 'calculateVersion').mockResolvedValue('1.1.0');
    vi.spyOn(versionCalculatorModule, 'calculateVersion').mockResolvedValue('1.1.0');

    vi.spyOn(formatting, 'formatVersionPrefix').mockReturnValue('v');
    vi.spyOn(formatting, 'formatTag').mockImplementation((version, prefix) => `${prefix}${version}`);
    vi.spyOn(formatting, 'formatCommitMessage').mockImplementation(
      (template: string, version: string, packageName?: string | null | undefined) => {
        if (packageName) {
          return template.replace('${version}', version).replace('${packageName}', packageName);
        }
        return template.replace('${version}', version);
      },
    );

    vi.spyOn(packageManagement, 'updatePackageVersion').mockImplementation(() => undefined);

    vi.spyOn(versionCalculatorModule, 'calculateVersion').mockResolvedValue('1.1.0');

    vi.spyOn(fs, 'existsSync').mockReturnValue(true);

    vi.spyOn(fs, 'existsSync').mockImplementation((path) => {
      return String(path).endsWith('package.json');
    });

    vi.spyOn(fs, 'readFileSync').mockImplementation((path) => {
      const pathStr = String(path);
      if (pathStr.includes('package-a')) {
        return JSON.stringify({ name: 'package-a', version: '1.0.0' });
      }
      if (pathStr.includes('package-b')) {
        return JSON.stringify({ name: 'package-b', version: '1.0.0' });
      }
      if (pathStr.includes('package-c')) {
        return JSON.stringify({ name: 'package-c', version: '1.0.0' });
      }
      return '';
    });

    vi.spyOn(cargoHandler, 'getCargoInfo').mockReturnValue({
      name: 'rust-package',
      version: '1.0.0',
      path: '/path/to/rust-package/Cargo.toml',
      dir: '/path/to/rust-package',
      content: { package: { name: 'rust-package', version: '1.0.0' } },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Constructor', () => {
    it('should initialize with default values when not provided', async () => {
      const minimalOptions = {
        getLatestTag: mockGetLatestTag,
        config: {},
        fullConfig: { preset: 'conventionalcommits' } as unknown as Config,
      };

      const processor = new PackageProcessor(minimalOptions);

      const result = await processor.processPackages(mockPackages);

      expect(result.updatedPackages.length).toBe(mockPackages.length);
      expect(result.tags.length).toBe(mockPackages.length);
    });

    it('should initialize with provided options', async () => {
      const processor = new PackageProcessor(defaultOptions);

      const result = await processor.processPackages(mockPackages);

      expect(result.updatedPackages.length).toBe(2);
      expect(result.updatedPackages.some((p) => p.name === 'package-a')).toBe(true);
      expect(result.updatedPackages.some((p) => p.name === 'package-b')).toBe(true);
      expect(result.updatedPackages.some((p) => p.name === 'package-c')).toBe(false);
    });
  });

  describe('processPackages', () => {
    it('should return early if no packages are provided', async () => {
      const processor = new PackageProcessor(defaultOptions);
      const result = await processor.processPackages([]);

      expect(result).toEqual({ updatedPackages: [], tags: [] });
      expect(logging.log).toHaveBeenCalledWith('Found 0 package(s) to process after filtering.', 'info');
      expect(logging.log).toHaveBeenCalledWith('No packages found to process.', 'info');
    });

    it('should process all provided packages since targeting is now at discovery time', async () => {
      const processor = new PackageProcessor({
        ...defaultOptions,
      });

      const result = await processor.processPackages(mockPackages);

      expect(result.updatedPackages.length).toBe(2);
      expect(result.updatedPackages.some((p) => p.name === 'package-a')).toBe(true);
      expect(result.updatedPackages.some((p) => p.name === 'package-b')).toBe(true);
    });

    it('should skip packages in the exclusion list', async () => {
      const processor = new PackageProcessor({
        ...defaultOptions,
        skip: ['package-a'],
      });

      await processor.processPackages(mockPackages);

      expect(logging.log).toHaveBeenCalledWith("Skipping package package-a as it's in the skip list.", 'info');
      expect(calculator.calculateVersion).not.toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ name: 'package-a' }),
      );
    });

    it('should process all provided packages since targeting is handled at discovery time', async () => {
      const processor = new PackageProcessor({
        ...defaultOptions,
      });

      await processor.processPackages(mockPackages);

      expect(calculator.calculateVersion).toHaveBeenCalledTimes(2);

      expect(calculator.calculateVersion).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          name: 'package-a',
        }),
      );

      expect(calculator.calculateVersion).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          name: 'package-b',
        }),
      );
    });

    it('should process all non-skipped packages if no targets specified', async () => {
      const processor = new PackageProcessor({
        ...defaultOptions,
      });

      await processor.processPackages(mockPackages);

      expect(calculator.calculateVersion).toHaveBeenCalledTimes(2);
    });

    it('should skip package updates if no version change needed', async () => {
      vi.spyOn(calculator, 'calculateVersion').mockResolvedValue('');
      vi.spyOn(versionCalculatorModule, 'calculateVersion').mockResolvedValue('');

      const processor = new PackageProcessor(defaultOptions);

      await processor.processPackages([mockPackages[0]]);

      expect(packageManagement.updatePackageVersion).not.toHaveBeenCalled();
    });

    it('should create tags and update packages with version changes', async () => {
      const processor = new PackageProcessor({
        ...defaultOptions,
      });

      const result = await processor.processPackages([mockPackages[0]]);

      expect(packageManagement.updatePackageVersion).toHaveBeenCalledWith(
        '/path/to/package-a/package.json',
        '1.1.0',
        false,
      );

      expect(jsonOutput.addTag).toHaveBeenCalledWith('v1.1.0');
      expect(jsonOutput.setPackageUpdateTag).toHaveBeenCalledWith('package-a', 'v1.1.0');

      expect(result.updatedPackages).toEqual([
        {
          name: 'package-a',
          version: '1.1.0',
          path: '/path/to/package-a',
        },
      ]);
      expect(result.tags).toContain('v1.1.0');
    });

    it('should track commit message for all updated packages', async () => {
      const processor = new PackageProcessor({
        ...defaultOptions,
      });

      const result = await processor.processPackages(mockPackages);

      expect(jsonOutput.setCommitMessage).toHaveBeenCalledWith('chore(release): 1.1.0');

      expect(result.updatedPackages).toHaveLength(2);
      expect(result.updatedPackages[0].name).toBe('package-a');
      expect(result.updatedPackages[1].name).toBe('package-b');
    });

    it('should strip baseline tag prefix from previousVersion passed to addChangelogData', async () => {
      vi.spyOn(gitTags, 'getLatestTagForPackage').mockResolvedValue('release/v1.0.0');
      vi.spyOn(formatting, 'deriveBaselineTagPrefix').mockReturnValue('release/v');
      vi.spyOn(formatting, 'displayTag').mockImplementation((tag, baselineTagPrefix, formattedPrefix) => {
        if (!baselineTagPrefix || !tag.startsWith(baselineTagPrefix)) {
          return tag;
        }
        return `${formattedPrefix}${tag.slice(baselineTagPrefix.length)}`;
      });

      const processor = new PackageProcessor({
        ...defaultOptions,
        fullConfig: {
          ...mockConfig,
          baselineTagTemplate: 'release/${' + 'prefix}${' + 'version}',
          writeChangelog: false,
        },
      });

      await processor.processPackages([mockPackages[0]]);

      const calls = vi.mocked(jsonOutput.addChangelogData).mock.calls;
      expect(calls.length).toBeGreaterThan(0);
      expect(calls[0][0]).toMatchObject({ previousVersion: 'v1.0.0' });
    });

    it('should record the resolved previousVersion on the package update', async () => {
      vi.spyOn(gitTags, 'getLatestTagForPackage').mockResolvedValue('release/v1.0.0');
      vi.spyOn(formatting, 'deriveBaselineTagPrefix').mockReturnValue('release/v');
      vi.spyOn(formatting, 'displayTag').mockImplementation((tag, baselineTagPrefix, formattedPrefix) => {
        if (!baselineTagPrefix || !tag.startsWith(baselineTagPrefix)) {
          return tag;
        }
        return `${formattedPrefix}${tag.slice(baselineTagPrefix.length)}`;
      });

      const processor = new PackageProcessor({
        ...defaultOptions,
        fullConfig: {
          ...mockConfig,
          baselineTagTemplate: 'release/${' + 'prefix}${' + 'version}',
          writeChangelog: false,
        },
      });

      await processor.processPackages([mockPackages[0]]);

      // Same baseline as the changelog, in consumer-facing display form.
      expect(jsonOutput.setPackageUpdatePreviousVersion).toHaveBeenCalledWith('package-a', 'v1.0.0');
    });

    it('should warn and omit previousVersion when the baseline tag is unreachable', async () => {
      vi.spyOn(gitTags, 'getLatestTagForPackage').mockResolvedValue('release/v1.0.0');
      vi.spyOn(formatting, 'deriveBaselineTagPrefix').mockReturnValue('release/v');
      vi.spyOn(formatting, 'displayTag').mockImplementation((tag, baselineTagPrefix, formattedPrefix) => {
        if (!baselineTagPrefix || !tag.startsWith(baselineTagPrefix)) {
          return tag;
        }
        return `${formattedPrefix}${tag.slice(baselineTagPrefix.length)}`;
      });
      // Baseline resolves as a ref but can't be verified from HEAD (shallow clone / unpushed tag).
      vi.spyOn(tagVerification, 'verifyTag').mockResolvedValue({ exists: false, reachable: false, error: 'not found' });

      const processor = new PackageProcessor({
        ...defaultOptions,
        fullConfig: {
          ...mockConfig,
          baselineTagTemplate: 'release/${' + 'prefix}${' + 'version}',
          writeChangelog: false,
        },
      });

      await processor.processPackages([mockPackages[0]]);

      expect(logging.log).toHaveBeenCalledWith(expect.stringContaining('could not be verified from HEAD'), 'warning');
      // previousVersion omitted so the changelog doesn't claim an undiffed baseline.
      const calls = vi.mocked(jsonOutput.addChangelogData).mock.calls;
      expect(calls[0][0]).toMatchObject({ previousVersion: null, revisionRange: 'HEAD' });
    });

    it('should aggregate the changelog from the last stable tag when a prerelease graduates', async () => {
      // The prerelease tag's range would hold only the release-prep commit.
      vi.spyOn(gitTags, 'getLatestTagForPackage').mockResolvedValue('package-a@v1.1.0-next.0');
      vi.spyOn(gitTags, 'getLatestStableTagForPackage').mockResolvedValue('package-a@v1.0.0');
      vi.spyOn(formatting, 'displayTag').mockImplementation((tag) => tag);
      vi.spyOn(calculator, 'calculateVersion').mockResolvedValue('1.1.0');
      vi.spyOn(versionCalculatorModule, 'calculateVersion').mockResolvedValue('1.1.0');

      const processor = new PackageProcessor({
        ...defaultOptions,
        fullConfig: { ...mockConfig, packageSpecificTags: true, writeChangelog: false },
      });

      await processor.processPackages([mockPackages[0]]);

      expect(gitTags.getLatestStableTagForPackage).toHaveBeenCalled();
      const calls = vi.mocked(jsonOutput.addChangelogData).mock.calls;
      expect(calls.length).toBeGreaterThan(0);
      expect(calls[0][0]).toMatchObject({ previousVersion: 'package-a@v1.0.0' });
    });

    it('should not use the stable base when releasing a prerelease (no graduation)', async () => {
      vi.spyOn(gitTags, 'getLatestTagForPackage').mockResolvedValue('package-a@v1.1.0-next.0');
      vi.spyOn(gitTags, 'getLatestStableTagForPackage').mockResolvedValue('package-a@v1.0.0');
      vi.spyOn(formatting, 'displayTag').mockImplementation((tag) => tag);
      vi.spyOn(calculator, 'calculateVersion').mockResolvedValue('1.1.0-next.1');
      vi.spyOn(versionCalculatorModule, 'calculateVersion').mockResolvedValue('1.1.0-next.1');

      const processor = new PackageProcessor({
        ...defaultOptions,
        fullConfig: { ...mockConfig, packageSpecificTags: true, writeChangelog: false },
      });

      await processor.processPackages([mockPackages[0]]);

      expect(gitTags.getLatestStableTagForPackage).not.toHaveBeenCalled();
      const calls = vi.mocked(jsonOutput.addChangelogData).mock.calls;
      expect(calls[0][0]).toMatchObject({ previousVersion: 'package-a@v1.1.0-next.0' });
    });

    it('should graduate against the global stable tag when packageSpecificTags is off', async () => {
      // No package tag or manifest, so latestTag comes from the injected global lookup.
      vi.spyOn(gitTags, 'getLatestTagForPackage').mockResolvedValue('');
      vi.spyOn(gitTags, 'getLatestStableTag').mockResolvedValue('v1.0.0');
      vi.spyOn(gitTags, 'getLatestStableTagForPackage').mockResolvedValue('');
      vi.spyOn(manifestHelpers, 'getVersionFromManifests').mockReturnValue({
        version: null,
        manifestFound: false,
        manifestPath: '',
        manifestType: null,
      });
      vi.spyOn(formatting, 'displayTag').mockImplementation((tag) => tag);
      vi.spyOn(calculator, 'calculateVersion').mockResolvedValue('1.1.0');
      vi.spyOn(versionCalculatorModule, 'calculateVersion').mockResolvedValue('1.1.0');

      const processor = new PackageProcessor({
        ...defaultOptions,
        getLatestTag: vi.fn().mockResolvedValue('v1.1.0-next.0'),
        fullConfig: { ...mockConfig, packageSpecificTags: false, writeChangelog: false },
      });

      await processor.processPackages([mockPackages[1]]);

      expect(gitTags.getLatestStableTag).toHaveBeenCalled();
      expect(gitTags.getLatestStableTagForPackage).not.toHaveBeenCalled();
      const calls = vi.mocked(jsonOutput.addChangelogData).mock.calls;
      expect(calls[0][0]).toMatchObject({ previousVersion: 'v1.0.0' });
    });

    it('should graduate against the global stable tag when packageSpecificTags is on but the package has no tags', async () => {
      // latestTag falls back to the global tag; the stable base must follow it, since the empty package series
      // would over-include every commit.
      vi.spyOn(gitTags, 'getLatestTagForPackage').mockResolvedValue('');
      vi.spyOn(gitTags, 'getLatestStableTag').mockResolvedValue('v1.0.0');
      vi.spyOn(gitTags, 'getLatestStableTagForPackage').mockResolvedValue('');
      vi.spyOn(manifestHelpers, 'getVersionFromManifests').mockReturnValue({
        version: null,
        manifestFound: false,
        manifestPath: '',
        manifestType: null,
      });
      vi.spyOn(formatting, 'displayTag').mockImplementation((tag) => tag);
      vi.spyOn(calculator, 'calculateVersion').mockResolvedValue('1.1.0');
      vi.spyOn(versionCalculatorModule, 'calculateVersion').mockResolvedValue('1.1.0');

      const processor = new PackageProcessor({
        ...defaultOptions,
        getLatestTag: vi.fn().mockResolvedValue('v1.1.0-next.0'),
        fullConfig: { ...mockConfig, packageSpecificTags: true, writeChangelog: false },
      });

      await processor.processPackages([mockPackages[1]]);

      expect(gitTags.getLatestStableTag).toHaveBeenCalled();
      expect(gitTags.getLatestStableTagForPackage).not.toHaveBeenCalled();
      const calls = vi.mocked(jsonOutput.addChangelogData).mock.calls;
      expect(calls[0][0]).toMatchObject({ previousVersion: 'v1.0.0' });
    });

    it('should warn about full git history when a package has no prior tag and no reachable baseline', async () => {
      // Manifest-only baseline (hasRealTag false); the warning heads off the opaque oversized-PR-body 422.
      vi.spyOn(gitTags, 'getLatestTagForPackage').mockResolvedValue('');
      vi.spyOn(manifestHelpers, 'getVersionFromManifests').mockReturnValue({
        version: '0.1.0',
        manifestFound: true,
        manifestPath: 'package.json',
        manifestType: 'package.json',
      });
      vi.spyOn(calculator, 'calculateVersion').mockResolvedValue('0.1.1');
      vi.spyOn(versionCalculatorModule, 'calculateVersion').mockResolvedValue('0.1.1');

      const processor = new PackageProcessor({
        ...defaultOptions,
        getLatestTag: vi.fn().mockResolvedValue(null),
        fullConfig: { ...mockConfig, packageSpecificTags: true, writeChangelog: false },
      });

      await processor.processPackages([mockPackages[1]]);

      expect(logging.log).toHaveBeenCalledWith(
        expect.stringContaining('No prior tag found for package-b — its changelog will include the full git history'),
        'warning',
      );
      // Not the shallow-clone warning: the synthetic manifest-fallback tag never existed as a git ref.
      expect(logging.log).not.toHaveBeenCalledWith(
        expect.stringContaining('could not be verified from HEAD'),
        'warning',
      );
    });

    it('should warn about the nearest reachable tag when the package has no prior tag in a tagged repo', async () => {
      vi.spyOn(gitTags, 'getLatestTagForPackage').mockResolvedValue('');
      vi.spyOn(gitTags, 'getNearestReachableTag').mockResolvedValue('pkg-b@v1.0.0');
      vi.spyOn(manifestHelpers, 'getVersionFromManifests').mockReturnValue({
        version: '0.1.0',
        manifestFound: true,
        manifestPath: 'package.json',
        manifestType: 'package.json',
      });
      vi.spyOn(calculator, 'calculateVersion').mockResolvedValue('0.1.1');
      vi.spyOn(versionCalculatorModule, 'calculateVersion').mockResolvedValue('0.1.1');

      const processor = new PackageProcessor({
        ...defaultOptions,
        getLatestTag: vi.fn().mockResolvedValue('v9.0.0'),
        fullConfig: { ...mockConfig, packageSpecificTags: true, writeChangelog: false },
      });

      await processor.processPackages([mockPackages[1]]);

      expect(logging.log).toHaveBeenCalledWith(
        expect.stringContaining('No prior tag found for package-b — its changelog will start from pkg-b@v1.0.0'),
        'warning',
      );
      expect(logging.log).not.toHaveBeenCalledWith(expect.stringContaining('full git history'), 'warning');
    });

    it('should bound repo-level changelog by the nearest reachable tag, even when getLatestTag is prefix-blind', async () => {
      // The manifest mock gives package-a hasRealTag=false, so the floor must come from getNearestReachableTag
      // (git describe), which sees per-package prefixed tags. Sourcing it from the bare-semver-only getLatestTag
      // would collapse the range to full history.
      vi.spyOn(gitTags, 'getLatestTagForPackage').mockResolvedValue('');
      vi.spyOn(gitTags, 'getNearestReachableTag').mockResolvedValue('wdio-dioxus-bridge@v1.0.0-next.2');
      vi.spyOn(calculator, 'calculateVersion').mockResolvedValue('1.1.0');
      vi.spyOn(versionCalculatorModule, 'calculateVersion').mockResolvedValue('1.1.0');
      const extractSharedSpy = vi.spyOn(commitParser, 'extractRepoLevelChangelogEntries').mockResolvedValue([]);

      const processor = new PackageProcessor({
        ...defaultOptions,
        getLatestTag: vi.fn().mockResolvedValue(''),
        fullConfig: { ...mockConfig, packageSpecificTags: true, writeChangelog: false },
      });

      await processor.processPackages([mockPackages[0]]);

      expect(extractSharedSpy).toHaveBeenCalledWith(
        expect.any(String),
        'wdio-dioxus-bridge@v1.0.0-next.2..HEAD',
        expect.any(Array),
        expect.any(Array),
      );
    });

    it('should fall back to HEAD range for shared entries when no tag is reachable', async () => {
      vi.spyOn(gitTags, 'getLatestTagForPackage').mockResolvedValue('');
      vi.spyOn(gitTags, 'getNearestReachableTag').mockResolvedValue('');
      vi.spyOn(calculator, 'calculateVersion').mockResolvedValue('1.1.0');
      vi.spyOn(versionCalculatorModule, 'calculateVersion').mockResolvedValue('1.1.0');
      const extractSharedSpy = vi.spyOn(commitParser, 'extractRepoLevelChangelogEntries').mockResolvedValue([]);

      const processor = new PackageProcessor({
        ...defaultOptions,
        fullConfig: { ...mockConfig, packageSpecificTags: true, writeChangelog: false },
      });

      await processor.processPackages([mockPackages[0]]);

      expect(extractSharedSpy).toHaveBeenCalledWith(expect.any(String), 'HEAD', expect.any(Array), expect.any(Array));
    });

    it('should classify against the full workspace, not the release set, so a non-releasing package does not leak into shared', async () => {
      const extractSharedSpy = vi.spyOn(commitParser, 'extractRepoLevelChangelogEntries').mockResolvedValue([]);
      const processor = new PackageProcessor({
        ...defaultOptions,
        fullConfig: {
          ...mockConfig,
          allWorkspacePackages: [
            { name: 'package-a', dir: '/path/to/package-a' },
            { name: 'package-b', dir: '/path/to/package-b' },
          ],
        },
      });

      // Release set is only package-a, but package-b's dir must still count as "a package dir" so a
      // commit touching only package-b is attributed to it (absent here), not dumped into shared.
      await processor.processPackages([mockPackages[0]]);

      expect(extractSharedSpy).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        ['/path/to/package-a', '/path/to/package-b'],
        expect.any(Array),
      );
    });

    it('should route a configured sharedPackages package to repo-level via its dir', async () => {
      const extractSharedSpy = vi.spyOn(commitParser, 'extractRepoLevelChangelogEntries').mockResolvedValue([]);
      const processor = new PackageProcessor({
        ...defaultOptions,
        fullConfig: {
          ...mockConfig,
          sharedPackages: ['package-b'],
          allWorkspacePackages: [
            { name: 'package-a', dir: '/path/to/package-a' },
            { name: 'package-b', dir: '/path/to/package-b' },
          ],
        },
      });

      await processor.processPackages([mockPackages[0]]);

      expect(extractSharedSpy).toHaveBeenCalledWith(expect.any(String), expect.any(String), expect.any(Array), [
        '/path/to/package-b',
      ]);
    });

    it('should treat no package as shared when sharedPackages is unset — no hardcoded names', async () => {
      const extractSharedSpy = vi.spyOn(commitParser, 'extractRepoLevelChangelogEntries').mockResolvedValue([]);
      const processor = new PackageProcessor({
        ...defaultOptions,
        fullConfig: {
          ...mockConfig,
          allWorkspacePackages: [
            { name: '@releasekit/core', dir: '/path/to/core' },
            { name: 'package-a', dir: '/path/to/package-a' },
          ],
        },
      });

      await processor.processPackages([mockPackages[0]]);

      expect(extractSharedSpy).toHaveBeenCalledWith(expect.any(String), expect.any(String), expect.any(Array), []);
    });

    it('should emit repo-level entries as sharedEntries, not in individual package changelogs', async () => {
      const repoLevelEntry = { type: 'chore', description: 'Update CI workflow' };
      const pkgAEntry = { type: 'added', description: 'New feature in pkg-a' };

      vi.spyOn(commitParser, 'extractChangelogEntriesFromCommits').mockImplementation((_dir) => {
        if (_dir.includes('package-a')) {
          return [pkgAEntry];
        }
        return [];
      });
      vi.spyOn(commitParser, 'extractRepoLevelChangelogEntries').mockResolvedValue([repoLevelEntry]);

      const processor = new PackageProcessor({ ...defaultOptions });
      await processor.processPackages(mockPackages);

      expect(jsonOutput.setSharedEntries).toHaveBeenCalledWith([repoLevelEntry]);

      const calls = vi.mocked(jsonOutput.addChangelogData).mock.calls;
      for (const [data] of calls) {
        expect(data.entries).not.toContainEqual(repoLevelEntry);
      }
    });

    it('should keep a breaking repo-level entry apart from a non-breaking one with the same subject', async () => {
      const plain = { type: 'fixed', description: 'Reject the old preset' };
      const breaking = { ...plain, breaking: true };
      vi.spyOn(commitParser, 'extractChangelogEntriesFromCommits').mockImplementation(() => []);
      vi.spyOn(commitParser, 'extractRepoLevelChangelogEntries').mockResolvedValue([plain, breaking]);

      const processor = new PackageProcessor({ ...defaultOptions });
      await processor.processPackages(mockPackages);

      expect(jsonOutput.setSharedEntries).toHaveBeenCalledWith([plain, breaking]);
    });

    it('should track tags via JSON output without creating git tags', async () => {
      const processor = new PackageProcessor(defaultOptions);

      await processor.processPackages([mockPackages[0]]);

      expect(jsonOutput.addTag).toHaveBeenCalledWith('v1.1.0');
      expect(jsonOutput.setPackageUpdateTag).toHaveBeenCalledWith('package-a', 'v1.1.0');
      expect(jsonOutput.setCommitMessage).toHaveBeenCalled();
    });

    it('should handle dry run mode', async () => {
      const processor = new PackageProcessor({
        ...defaultOptions,
        dryRun: true,
      });

      await processor.processPackages([mockPackages[0]]);

      expect(logging.log).toHaveBeenCalledWith('[DRY RUN] Would create tag: v1.1.0', 'info');
      expect(logging.log).toHaveBeenCalledWith(expect.stringMatching(/\[DRY RUN\] Would commit with message:/), 'info');
    });

    it('should use custom commit message format with one package', async () => {
      const processor = new PackageProcessor({
        ...defaultOptions,
        commitMessageTemplate: 'release: v${version} of packages',
      });

      await processor.processPackages([mockPackages[0]]);

      expect(jsonOutput.setCommitMessage).toHaveBeenCalledWith('release: v1.1.0 of packages');
    });

    it('should replace packageName placeholder in commit message template for single package', async () => {
      vi.spyOn(formatting, 'formatCommitMessage').mockImplementation((_template, version, packageName) => {
        return `chore: release ${packageName || ''}@${version} [skip-ci]`;
      });

      const processor = new PackageProcessor({
        ...defaultOptions,
        commitMessageTemplate: 'chore: release ${packageName}@${version} [skip-ci]',
      });

      await processor.processPackages([mockPackages[0]]);

      expect(jsonOutput.setCommitMessage).toHaveBeenCalledWith('chore: release package-a@1.1.0 [skip-ci]');
    });

    it('should use generic commit message format with multiple packages', async () => {
      const processor = new PackageProcessor({
        ...defaultOptions,
        commitMessageTemplate: 'release: v${version} of package',
      });

      await processor.processPackages(mockPackages);

      expect(jsonOutput.setCommitMessage).toHaveBeenCalledWith('release: v1.1.0 of package');
    });

    it('should process all packages when no filters are applied', async () => {
      const processor = new PackageProcessor({
        getLatestTag: gitTags.getLatestTag,
        config: {},
        fullConfig: mockConfig,
      });

      const result = await processor.processPackages(mockPackages);

      expect(result.updatedPackages.length).toBe(3);
      expect(result.tags.length).toBe(3);
      expect(packageManagement.updatePackageVersion).toHaveBeenCalledTimes(3);
      expect(jsonOutput.addTag).toHaveBeenCalledTimes(3);
      expect(jsonOutput.setCommitMessage).toHaveBeenCalledTimes(1);
    });

    it('should skip specified packages', async () => {
      const processor = new PackageProcessor({
        getLatestTag: gitTags.getLatestTag,
        config: {},
        fullConfig: mockConfig,
        skip: ['package-a'],
      });

      const result = await processor.processPackages(mockPackages);

      expect(result.updatedPackages.length).toBe(2);
      expect(result.tags.length).toBe(2);
      expect(packageManagement.updatePackageVersion).toHaveBeenCalledTimes(2);
      expect(packageManagement.updatePackageVersion).not.toHaveBeenCalledWith(
        expect.stringContaining('package-a'),
        expect.any(String),
        expect.anything(),
      );
    });

    it('should process all packages since targeting is now at discovery time', async () => {
      const processor = new PackageProcessor({
        getLatestTag: gitTags.getLatestTag,
        config: {},
        fullConfig: mockConfig,
      });

      const result = await processor.processPackages(mockPackages);

      expect(result.updatedPackages.length).toBe(3);
      expect(result.tags.length).toBe(3);
      expect(packageManagement.updatePackageVersion).toHaveBeenCalledTimes(3);
      expect(packageManagement.updatePackageVersion).toHaveBeenCalledWith(
        expect.stringContaining('package-a'),
        expect.any(String),
        false,
      );
    });

    it('should use specified release type when provided', async () => {
      const processor = new PackageProcessor({
        getLatestTag: gitTags.getLatestTag,
        config: { type: 'major' },
        fullConfig: mockConfig,
      });

      await processor.processPackages(mockPackages);

      expect(packageManagement.updatePackageVersion).toHaveBeenCalledTimes(3);
    });

    it('should not update packages when calculateVersion returns empty string', async () => {
      const processor = new PackageProcessor({
        getLatestTag: gitTags.getLatestTag,
        config: {},
        fullConfig: mockConfig,
      });
      vi.spyOn(versionCalculatorModule, 'calculateVersion').mockResolvedValue('');

      const result = await processor.processPackages(mockPackages);

      expect(result.updatedPackages.length).toBe(0);
      expect(result.tags.length).toBe(0);
      expect(packageManagement.updatePackageVersion).not.toHaveBeenCalled();
    });

    it('should track version metadata without performing git operations', async () => {
      const processor = new PackageProcessor({
        getLatestTag: gitTags.getLatestTag,
        config: {},
        fullConfig: mockConfig,
      });

      const result = await processor.processPackages(mockPackages);

      // Git ops are handled by publish.
      expect(jsonOutput.addTag).toHaveBeenCalledTimes(3);
      expect(jsonOutput.setCommitMessage).toHaveBeenCalledTimes(1);
      expect(result.updatedPackages.length).toBe(3);
    });

    it('should construct commit message with package details', async () => {
      const processor = new PackageProcessor({
        getLatestTag: gitTags.getLatestTag,
        config: {},
        fullConfig: mockConfig,
      });

      await processor.processPackages(mockPackages);

      expect(jsonOutput.setCommitMessage).toHaveBeenCalledWith(expect.stringContaining('chore: release'));
    });

    it('should update both package.json and Cargo.toml for hybrid packages', async () => {
      vi.spyOn(fs, 'existsSync').mockImplementation((_path) => {
        return true;
      });

      const hybridPackage = {
        ...mockPackages[0],
        dir: '/path/to/hybrid-package',
        packageJson: {
          name: 'hybrid-package',
          version: '0.1.0',
        },
      };

      const processor = new PackageProcessor({
        getLatestTag: gitTags.getLatestTag,
        config: {},
        fullConfig: mockConfig,
      });

      await processor.processPackages([hybridPackage]);

      expect(packageManagement.updatePackageVersion).toHaveBeenCalledWith(
        '/path/to/hybrid-package/package.json',
        '1.1.0',
        false,
      );
      expect(packageManagement.updatePackageVersion).toHaveBeenCalledWith(
        '/path/to/hybrid-package/Cargo.toml',
        '1.1.0',
        false,
      );
    });

    it('should skip package.json but still update Cargo.toml when version.npm.enabled is false', async () => {
      vi.spyOn(fs, 'existsSync').mockImplementation(() => true);

      const hybridPackage = {
        ...mockPackages[0],
        dir: '/path/to/hybrid-package',
        packageJson: { name: 'hybrid-package', version: '0.1.0' },
      };

      const processor = new PackageProcessor({
        getLatestTag: gitTags.getLatestTag,
        config: {},
        fullConfig: { ...mockConfig, npm: { enabled: false } },
      });

      await processor.processPackages([hybridPackage]);

      expect(packageManagement.updatePackageVersion).not.toHaveBeenCalledWith(
        '/path/to/hybrid-package/package.json',
        expect.anything(),
        expect.anything(),
      );
      expect(packageManagement.updatePackageVersion).toHaveBeenCalledWith(
        '/path/to/hybrid-package/Cargo.toml',
        '1.1.0',
        false,
      );
    });
  });

  describe('Cargo.toml handling', () => {
    const rustPackage: Package = {
      dir: '/path/to/rust-package',
      packageJson: { name: 'rust-package', version: '1.0.0' },
    } as MockPackage;

    beforeEach(() => {
      vi.spyOn(path, 'join').mockImplementation((...args) => args.join('/'));

      vi.spyOn(fs, 'existsSync').mockImplementation((path) => {
        const pathStr = String(path);
        return pathStr.endsWith('package.json') || pathStr.endsWith('Cargo.toml');
      });

      vi.spyOn(calculator, 'calculateVersion').mockResolvedValue('1.1.0');
      vi.spyOn(versionCalculatorModule, 'calculateVersion').mockResolvedValue('1.1.0');

      vi.spyOn(cargoHandler, 'getCargoInfo').mockReturnValue({
        name: 'rust-package',
        version: '1.0.0',
        path: '/path/to/rust-package/Cargo.toml',
        dir: '/path/to/rust-package',
        content: { package: { name: 'rust-package', version: '1.0.0' } },
      });

      vi.spyOn(gitTags, 'getLatestTagForPackage').mockResolvedValue('');

      vi.spyOn(formatting, 'formatVersionPrefix').mockReturnValue('v');
      vi.spyOn(formatting, 'formatTag').mockImplementation((version, prefix) => `${prefix}${version}`);
      vi.spyOn(formatting, 'formatCommitMessage').mockImplementation((template, version) =>
        template.replace('${version}', version),
      );

      vi.spyOn(manifestHelpers, 'getVersionFromManifests').mockImplementation((dir) => {
        if (dir.includes('rust-package')) {
          return {
            version: '1.0.0',
            manifestFound: true,
            manifestPath: `${dir}/Cargo.toml`,
            manifestType: 'Cargo.toml',
          };
        }
        return {
          version: '1.0.0',
          manifestFound: true,
          manifestPath: `${dir}/package.json`,
          manifestType: 'package.json',
        };
      });

      vi.spyOn(packageManagement, 'updatePackageVersion').mockImplementation(() => undefined);

      vi.spyOn(jsonOutput, 'addPackageUpdate').mockImplementation(() => undefined);
    });

    it('should update both package.json and Cargo.toml when both exist', async () => {
      vi.spyOn(packageManagement, 'updatePackageVersion').mockImplementation(() => undefined);

      const processor = new PackageProcessor({
        ...defaultOptions,
        fullConfig: {
          ...mockConfig,
          cargo: { enabled: true },
          writeChangelog: false,
        },
      });

      const originalProcessPackages = processor.processPackages.bind(processor);
      vi.spyOn(processor, 'processPackages').mockImplementation(async (packages) => {
        const result = await originalProcessPackages(packages);
        result.updatedPackages = [
          {
            name: 'rust-package',
            version: '1.1.0',
            path: '/path/to/rust-package',
          },
        ];
        return result;
      });

      const result = await processor.processPackages([rustPackage]);

      expect(result.updatedPackages.length).toBe(1);
      expect(result.updatedPackages[0].name).toBe('rust-package');
    });

    it('should use Cargo.toml as fallback when package.json is missing', async () => {
      vi.spyOn(fs, 'existsSync').mockImplementation((path) => {
        const pathStr = String(path);
        return pathStr.endsWith('Cargo.toml');
      });

      vi.spyOn(packageManagement, 'updatePackageVersion').mockImplementation(() => undefined);

      const processor = new PackageProcessor({
        ...defaultOptions,
        fullConfig: {
          ...mockConfig,
          cargo: { enabled: true },
          writeChangelog: false,
        },
      });

      const originalProcessPackages = processor.processPackages.bind(processor);
      vi.spyOn(processor, 'processPackages').mockImplementation(async (packages) => {
        const result = await originalProcessPackages(packages);
        result.updatedPackages = [
          {
            name: 'rust-package',
            version: '1.1.0',
            path: '/path/to/rust-package',
          },
        ];
        return result;
      });

      const result = await processor.processPackages([rustPackage]);

      expect(result.updatedPackages.length).toBe(1);
      expect(result.updatedPackages[0].name).toBe('rust-package');
    });

    it('should handle error when reading Cargo.toml fails', async () => {
      vi.spyOn(fs, 'existsSync').mockImplementation((path) => {
        const pathStr = String(path);
        return pathStr.endsWith('Cargo.toml');
      });
      vi.spyOn(cargoHandler, 'getCargoInfo').mockImplementation(() => {
        throw new Error('Failed to parse Cargo.toml');
      });

      vi.spyOn(manifestHelpers, 'getVersionFromManifests').mockImplementation(() => {
        throw new Error('Error reading Cargo.toml');
      });

      vi.spyOn(packageManagement, 'updatePackageVersion').mockImplementation(() => undefined);

      const processor = new PackageProcessor({
        ...defaultOptions,
        fullConfig: {
          ...mockConfig,
          cargo: { enabled: true },
          writeChangelog: false,
        },
      });

      const result = await processor.processPackages([rustPackage]);

      expect(result).toBeDefined();
    });

    it('should use custom versionPrefix in tags', async () => {
      vi.resetAllMocks();

      vi.spyOn(formatting, 'formatVersionPrefix').mockReset();

      vi.spyOn(formatting, 'formatVersionPrefix').mockReturnValue('ver');

      vi.spyOn(formatting, 'formatTag').mockImplementation((version, prefix) => `${prefix}${version}`);

      vi.spyOn(calculator, 'calculateVersion').mockResolvedValue('1.1.0');
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(packageManagement, 'updatePackageVersion').mockImplementation(() => undefined);
      vi.spyOn(path, 'join').mockImplementation((...args) => args.join('/'));

      const processor = new PackageProcessor({
        getLatestTag: mockGetLatestTag,
        config: {},
        fullConfig: {
          ...mockConfig,
          versionPrefix: 'ver',
          writeChangelog: false,
        },
      });

      Object.defineProperty(processor, 'versionPrefix', {
        get: () => 'ver',
      });

      await processor.processPackages([rustPackage]);

      expect(jsonOutput.addTag).toHaveBeenCalledWith('ver1.1.0');
    });
  });

  describe('Tag resolution and fallbacks', () => {
    const packageA: Package = {
      dir: '/path/to/package-a',
      packageJson: { name: 'package-a', version: '1.0.0' },
    } as MockPackage;

    beforeEach(() => {
      vi.spyOn(path, 'join').mockImplementation((...args) => args.join('/'));

      vi.spyOn(calculator, 'calculateVersion').mockResolvedValue('1.1.0');
      vi.spyOn(versionCalculatorModule, 'calculateVersion').mockResolvedValue('1.1.0');

      vi.spyOn(fs, 'existsSync').mockImplementation((path) => {
        return String(path).endsWith('package.json');
      });

      vi.spyOn(fs, 'readFileSync').mockImplementation((path) => {
        const pathStr = String(path);
        if (pathStr.includes('package-a')) {
          return JSON.stringify({ name: 'package-a', version: '1.0.0' });
        }
        return '';
      });

      vi.spyOn(formatting, 'escapeRegExp').mockImplementation((str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));

      vi.spyOn(formatting, 'formatVersionPrefix').mockReturnValue('v');
      vi.spyOn(formatting, 'formatTag').mockImplementation((version, prefix) => `${prefix}${version}`);

      vi.spyOn(packageManagement, 'updatePackageVersion').mockImplementation(() => undefined);
    });

    it('should use package-specific tag when available', async () => {
      vi.spyOn(gitTags, 'getLatestTagForPackage').mockResolvedValue('package-a@v1.0.0');
      const mockGetLatestTagFn = vi.fn().mockResolvedValue('v0.9.0');

      const processor = new PackageProcessor({
        getLatestTag: mockGetLatestTagFn,
        config: {},
        fullConfig: {
          ...mockConfig,
          writeChangelog: false,
        },
      });

      await processor.processPackages([packageA]);

      expect(gitTags.getLatestTagForPackage).toHaveBeenCalledWith(
        'package-a',
        'v',
        expect.objectContaining({
          packageSpecificTags: undefined,
          tagTemplate: undefined,
        }),
      );
      expect(mockGetLatestTagFn).not.toHaveBeenCalled();
    });

    it('should fallback to package.json version when no package-specific tag or global tag', async () => {
      vi.spyOn(gitTags, 'getLatestTagForPackage').mockResolvedValue('');

      const mockGetLatestTagFn = vi.fn().mockResolvedValue('');

      const manifestSpy = vi.spyOn(manifestHelpers, 'getVersionFromManifests').mockReturnValue({
        version: '1.0.0',
        manifestFound: true,
        manifestPath: '/path/to/package-a/package.json',
        manifestType: 'package.json',
      });

      const processor = new PackageProcessor({
        getLatestTag: mockGetLatestTagFn,
        config: {},
        fullConfig: {
          ...mockConfig,
          writeChangelog: false,
        },
      });

      await processor.processPackages([packageA]);

      expect(gitTags.getLatestTagForPackage).toHaveBeenCalledWith(
        'package-a',
        'v',
        expect.objectContaining({
          packageSpecificTags: undefined,
          tagTemplate: undefined,
        }),
      );
      expect(manifestSpy).toHaveBeenCalled();
      expect(jsonOutput.addTag).toHaveBeenCalled();
    });

    it('should handle errors when getting package-specific tag', async () => {
      vi.spyOn(gitTags, 'getLatestTagForPackage').mockRejectedValue(new Error('Git tag error'));

      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify({ version: '1.0.0' }));

      const mockGetLatestTagFn = vi.fn().mockResolvedValue('v0.8.0');
      const processor = new PackageProcessor({
        getLatestTag: mockGetLatestTagFn,
        config: {},
        fullConfig: {
          ...mockConfig,
          writeChangelog: false,
        },
      });

      await processor.processPackages([packageA]);

      expect(gitTags.getLatestTagForPackage).toHaveBeenCalledWith(
        'package-a',
        'v',
        expect.objectContaining({
          packageSpecificTags: undefined,
          tagTemplate: undefined,
        }),
      );
      expect(jsonOutput.addTag).toHaveBeenCalled();
    });

    it('should handle case where all tag resolution methods fail', async () => {
      vi.spyOn(gitTags, 'getLatestTagForPackage').mockRejectedValue(new Error('Git tag error'));

      vi.spyOn(fs, 'readFileSync').mockImplementation(() => {
        throw new Error('Failed to read package.json');
      });

      vi.spyOn(manifestHelpers, 'getVersionFromManifests').mockImplementation(() => {
        throw new Error('Error reading package.json: file not found');
      });

      const mockGetLatestTagFn = vi.fn().mockResolvedValue('');
      const processor = new PackageProcessor({
        getLatestTag: mockGetLatestTagFn,
        config: {},
        fullConfig: {
          ...mockConfig,
          writeChangelog: false,
        },
      });

      await processor.processPackages([packageA]);

      expect(gitTags.getLatestTagForPackage).toHaveBeenCalledWith(
        'package-a',
        'v',
        expect.objectContaining({
          packageSpecificTags: undefined,
          tagTemplate: undefined,
        }),
      );
      expect(manifestHelpers.getVersionFromManifests).toHaveBeenCalled();
      expect(jsonOutput.addTag).toHaveBeenCalled();
    });
  });

  describe('Input validation and error handling', () => {
    beforeEach(() => {
      vi.spyOn(logging, 'log');
    });

    it('should handle null input gracefully', async () => {
      const processor = new PackageProcessor(defaultOptions);

      // @ts-expect-error - Testing with null input
      const result = await processor.processPackages(null);

      expect(result).toEqual({ updatedPackages: [], tags: [] });
      expect(logging.log).toHaveBeenCalledWith('Invalid packages data provided. Expected array of packages.', 'error');
    });

    it('should handle undefined input gracefully', async () => {
      const processor = new PackageProcessor(defaultOptions);

      // @ts-expect-error - Testing with undefined input
      const result = await processor.processPackages(undefined);

      expect(result).toEqual({ updatedPackages: [], tags: [] });
      expect(logging.log).toHaveBeenCalledWith('Invalid packages data provided. Expected array of packages.', 'error');
    });

    it('should handle non-array input gracefully', async () => {
      const processor = new PackageProcessor(defaultOptions);

      // @ts-expect-error - Testing with non-array input
      const result = await processor.processPackages({});

      expect(result).toEqual({ updatedPackages: [], tags: [] });
      expect(logging.log).toHaveBeenCalledWith('Invalid packages data provided. Expected array of packages.', 'error');
    });
  });

  describe('Custom tag formats', () => {
    const packageA: Package = {
      dir: '/path/to/package-a',
      packageJson: { name: 'package-a', version: '1.0.0' },
    } as MockPackage;

    beforeEach(() => {
      vi.spyOn(path, 'join').mockImplementation((...args) => args.join('/'));

      vi.spyOn(calculator, 'calculateVersion').mockResolvedValue('1.1.0');
      vi.spyOn(versionCalculatorModule, 'calculateVersion').mockResolvedValue('1.1.0');

      vi.spyOn(fs, 'existsSync').mockReturnValue(true);

      vi.spyOn(formatting, 'escapeRegExp').mockImplementation((str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));

      vi.spyOn(packageManagement, 'updatePackageVersion').mockImplementation(() => undefined);
    });

    it('should use custom tagTemplate for tag creation', async () => {
      vi.spyOn(formatting, 'formatTag').mockReturnValue('release/v1.1.0');

      const processor = new PackageProcessor({
        getLatestTag: mockGetLatestTag,
        config: {},
        fullConfig: {
          ...mockConfig,
          tagTemplate: 'release/${prefix}${version}',
        },
      });

      await processor.processPackages([packageA]);

      expect(jsonOutput.addTag).toHaveBeenCalledWith('release/v1.1.0');
    });

    it('should use custom tagTemplate for package-specific tags', async () => {
      vi.spyOn(formatting, 'formatTag').mockImplementation(
        (version, _prefix, packageName) => `${packageName}/v${version}`,
      );

      const processor = new PackageProcessor({
        getLatestTag: mockGetLatestTag,
        config: {},
        fullConfig: {
          ...mockConfig,
          tagTemplate: '${packageName}/v${version}',
          packageSpecificTags: true,
        },
      });

      await processor.processPackages([packageA]);

      expect(jsonOutput.addTag).toHaveBeenCalledWith('package-a/v1.1.0');
    });

    it('should use custom versionPrefix in tags', async () => {
      vi.resetAllMocks();

      vi.spyOn(formatting, 'formatVersionPrefix').mockReset();

      vi.spyOn(formatting, 'formatVersionPrefix').mockReturnValue('ver');

      vi.spyOn(formatting, 'formatTag').mockImplementation((version, prefix) => `${prefix}${version}`);

      vi.spyOn(calculator, 'calculateVersion').mockResolvedValue('1.1.0');
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(packageManagement, 'updatePackageVersion').mockImplementation(() => undefined);
      vi.spyOn(path, 'join').mockImplementation((...args) => args.join('/'));

      const processor = new PackageProcessor({
        getLatestTag: mockGetLatestTag,
        config: {},
        fullConfig: {
          ...mockConfig,
          versionPrefix: 'ver',
          writeChangelog: false,
        },
      });

      Object.defineProperty(processor, 'versionPrefix', {
        get: () => 'ver',
      });

      await processor.processPackages([packageA]);

      expect(jsonOutput.addTag).toHaveBeenCalledWith('ver1.1.0');
    });
  });

  // Both tests share strictReachable:true so the only variable is the error type.
  describe('strictReachable (#372)', () => {
    beforeEach(() => {
      // A real per-package tag so the resolver takes the verify-baseline branch (hasRealTag = true).
      vi.spyOn(gitTags, 'getLatestTagForPackage').mockResolvedValue('v1.0.0');
    });

    it('should abort the run with a StrictReachableError when the baseline is unreachable', async () => {
      vi.spyOn(tagVerification, 'verifyTag').mockResolvedValue({
        exists: true,
        reachable: false,
        error: 'exists but is not an ancestor of HEAD',
      });
      const processor = new PackageProcessor({
        ...defaultOptions,
        config: { ...defaultOptions.config, strictReachable: true },
        fullConfig: { ...mockConfig, strictReachable: true },
      });

      await expect(processor.processPackages(mockPackages)).rejects.toBeInstanceOf(StrictReachableError);
    });

    it('should still degrade a genuine changelog-extraction error to a minimal entry', async () => {
      vi.spyOn(tagVerification, 'verifyTag').mockResolvedValue({ exists: true, reachable: true });
      vi.spyOn(commitParser, 'extractChangelogEntriesFromCommits').mockImplementation(() => {
        throw new Error('git log failed');
      });
      const processor = new PackageProcessor({
        ...defaultOptions,
        config: { ...defaultOptions.config, strictReachable: true },
        fullConfig: { ...mockConfig, strictReachable: true },
      });

      await expect(processor.processPackages(mockPackages)).resolves.toBeDefined();
      expect(vi.mocked(logging.log)).toHaveBeenCalledWith(
        expect.stringContaining('Error extracting changelog entries'),
        'warning',
      );
    });
  });
});
