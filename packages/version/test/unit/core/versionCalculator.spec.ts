import * as fs from 'node:fs';
import * as path from 'node:path';
import createAngularPreset from 'conventional-changelog-angular';
import { Bumper, type BumperRecommendationResult } from 'conventional-recommended-bump';
import type { ReleaseType } from 'semver';
import semver from 'semver';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { calculateVersion } from '../../../src/core/versionCalculator.js';
import * as gitRepo from '../../../src/git/repository.js';
import * as gitTags from '../../../src/git/tagsAndBranches.js';
import type { Config, VersionOptions } from '../../../src/types.js';
import * as logging from '../../../src/utils/logging.js';
import * as manifestHelpers from '../../../src/utils/manifestHelpers.js';
import * as versionUtils from '../../../src/utils/versionUtils.js';

vi.mock('../../../src/git/repository.js');
vi.mock('../../../src/git/tagsAndBranches.js');
vi.mock('../../../src/utils/logging.js');
vi.mock('../../../src/utils/versionUtils.js');
vi.mock('../../../src/utils/manifestHelpers.js');
vi.mock('conventional-recommended-bump');
vi.mock('node:fs');
vi.mock('node:path');
vi.mock('semver');

describe('Version Calculator', () => {
  const defaultConfig: Partial<Config> = {
    preset: 'angular',
    versionPrefix: 'v',
    tagTemplate: '${' + 'prefix}${' + 'version}',
  };

  beforeEach(() => {
    vi.resetAllMocks();

    vi.spyOn(gitRepo, 'getCurrentBranch').mockResolvedValue('main');
    vi.spyOn(gitTags, 'getCommitsLength').mockResolvedValue(5);

    vi.spyOn(manifestHelpers, 'getVersionFromManifests').mockImplementation(() => {
      return {
        version: '1.0.0',
        manifestFound: true,
        manifestPath: 'path/to/package.json',
        manifestType: 'package.json',
      };
    });

    vi.spyOn(versionUtils, 'getBestVersionSource').mockImplementation(async (latestTag, packageVersion) => {
      if (!latestTag) {
        return {
          source: 'package',
          version: packageVersion || '0.1.0',
          reason: 'No git tag provided',
        };
      }
      return {
        source: 'git',
        version: latestTag,
        reason: 'Git tag exists',
      };
    });

    vi.spyOn(semver, 'clean').mockImplementation((version) =>
      typeof version === 'string' ? version.replace(/^[^\d]*/, '') : null,
    );

    vi.spyOn(semver, 'prerelease').mockReturnValue(null);

    vi.spyOn(versionUtils, 'normalizePrereleaseIdentifier').mockImplementation((val) => {
      if (val === true) {
        return 'next';
      }
      return val as string;
    });

    vi.spyOn(versionUtils, 'bumpVersion').mockImplementation((version, releaseType, identifier) => {
      if (version === '1.0.0' && releaseType === 'minor' && !identifier) {
        return '1.1.0';
      }
      if (version === '1.0.0-next.0' && releaseType === 'major' && !identifier) {
        return '2.0.0';
      }
      if (version === '1.0.0-beta.1' && releaseType === 'minor' && !identifier) {
        return '1.1.0';
      }
      if (version === '1.0.0-alpha.2' && releaseType === 'patch' && !identifier) {
        return '1.0.1';
      }
      if (version === '1.0.0' && releaseType === 'prerelease' && identifier === 'alpha') {
        return '1.0.0-alpha.1';
      }
      if (version === '1.3.0' && releaseType === 'major' && identifier === 'next') {
        return '2.0.0-next.0';
      }
      if (version === '1.3.0' && releaseType === 'minor' && identifier === 'next') {
        return '1.4.0-next.0';
      }
      if (version === '1.3.1' && releaseType === 'patch' && identifier === 'next') {
        return '1.3.2-next.0';
      }
      if (version === '1.0.0-beta.1' && releaseType === 'major' && !identifier) {
        return '2.0.0';
      }
      if (version === '1.0.0-test' && releaseType === 'minor' && !identifier) {
        return '1.1.0';
      }
      if (version === '1.0.0' && releaseType === 'patch' && !identifier) {
        return '1.0.1';
      }

      if (version === '1.0.0' && releaseType === 'minor' && identifier === undefined) {
        return '1.1.0';
      }
      if (version === '1.0.0' && releaseType === 'patch' && identifier === undefined) {
        return '1.0.1';
      }

      if (version === '0.0.0' && releaseType === 'minor') {
        return '0.1.0';
      }
      if (version === '2.0.0' && releaseType === 'minor' && !identifier) {
        return '2.1.0';
      }

      if (version === '1.0.0' && releaseType === 'patch' && identifier === undefined) {
        return '1.0.1';
      }
      if (version === '0.0.0' && releaseType === 'patch') {
        return '0.0.1';
      }

      if (version === '1.3.0' && releaseType === 'premajor' && identifier === 'next') {
        return '2.0.0-next.0';
      }

      if (version === '1.1.0' && releaseType === 'patch' && !identifier) {
        return '1.1.1';
      }
      if (version === '1.2.0' && releaseType === 'patch' && !identifier) {
        return '1.2.1';
      }

      const semverResult = semver.inc(version, 'patch');
      return semverResult || '1.0.1';
    });

    vi.spyOn(semver, 'inc').mockImplementation((version, releaseType, identifier) => {
      if (!version) {
        return null;
      }

      const versionStr = typeof version === 'string' ? version : (version as { version?: string })?.version || '0.0.0';

      const parts = versionStr.split('.');

      if (releaseType === 'major') {
        return `${Number(parts[0]) + 1}.0.0`;
      }
      if (releaseType === 'minor') {
        return `${parts[0]}.${Number(parts[1]) + 1}.0`;
      }
      if (releaseType === 'patch') {
        if (versionStr.includes('-')) {
          const baseVersion = versionStr.split('-')[0];
          const baseParts = baseVersion.split('.');
          return `${baseParts[0]}.${baseParts[1]}.${Number.parseInt(baseParts[2], 10) + 1}`;
        }
        return `${parts[0]}.${parts[1]}.${Number.parseInt(parts[2], 10) + 1}`;
      }

      if (releaseType === 'premajor' && versionStr === '1.3.0' && identifier === 'next') {
        return '2.0.0-next.0';
      }

      if (identifier) {
        return `${versionStr}-${identifier}.1`;
      }

      return `${versionStr}-${releaseType}`;
    });

    vi.spyOn(semver, 'parse').mockImplementation((version) => {
      if (!version) {
        return null;
      }

      if (version === '1.0.0-next.0') {
        return {
          major: 1,
          minor: 0,
          patch: 0,
          prerelease: ['next', 0],
        } as unknown as semver.SemVer;
      }
      if (version === '1.0.0-beta.1') {
        return {
          major: 1,
          minor: 0,
          patch: 0,
          prerelease: ['beta', 1],
        } as unknown as semver.SemVer;
      }
      if (version === '1.0.0-alpha.2') {
        return {
          major: 1,
          minor: 0,
          patch: 0,
          prerelease: ['alpha', 2],
        } as unknown as semver.SemVer;
      }
      if (version === '1.0.0-test') {
        return { major: 1, minor: 0, patch: 0, prerelease: ['test'] } as unknown as semver.SemVer;
      }

      const versionString = version.toString();
      const parts = versionString.split('-')[0].split('.');
      return {
        major: Number.parseInt(parts[0], 10),
        minor: Number.parseInt(parts[1], 10),
        patch: Number.parseInt(parts[2], 10),
      } as unknown as semver.SemVer;
    });

    vi.spyOn(Bumper.prototype, 'bump').mockResolvedValue({
      releaseType: 'patch' as const,
      commits: [],
      level: 0,
      reason: 'test',
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('First release (no prior tag)', () => {
    it('should apply bump to initial version when no tag exists', async () => {
      // No path → versionSource undefined → falls back to initialVersion ('0.1.0')
      vi.spyOn(versionUtils, 'bumpVersion').mockReturnValue('0.2.0');

      const options: VersionOptions = {
        // @ts-expect-error - Testing with null latestTag
        latestTag: null,
        type: 'minor',
        versionPrefix: 'v',
      };

      const version = await calculateVersion(defaultConfig as Config, options);

      expect(versionUtils.bumpVersion).toHaveBeenCalledWith('0.1.0', 'minor', undefined);
      expect(version).toBe('0.2.0');
    });

    it('should graduate a prerelease manifest version to stable when --stable is passed', async () => {
      vi.spyOn(versionUtils, 'getBestVersionSource').mockResolvedValue({
        source: 'package',
        version: '0.1.0-next.0',
        reason: 'No git tag provided',
      });
      vi.spyOn(manifestHelpers, 'getVersionFromManifests').mockReturnValue({
        version: '0.1.0-next.0',
        manifestFound: true,
        manifestPath: '/repo/packages/pkg/package.json',
        manifestType: 'package.json',
      });
      vi.spyOn(semver, 'prerelease').mockReturnValue(['next', 0]);
      vi.spyOn(semver, 'parse').mockReturnValue({
        major: 0,
        minor: 1,
        patch: 0,
        prerelease: ['next', 0],
      } as unknown as semver.SemVer);

      const config = { ...defaultConfig, stableOnly: true, type: 'minor' as const };
      const options: VersionOptions = {
        latestTag: '',
        hasRealTag: false,
        type: 'minor',
        versionPrefix: 'v',
        path: '/repo/packages/pkg',
        name: 'my-pkg',
      };

      const version = await calculateVersion(config as Config, options);

      expect(version).toBe('0.1.0');
    });

    it('should normalize prerelease identifier on first release when manifest has different identifier', async () => {
      vi.spyOn(versionUtils, 'getBestVersionSource').mockResolvedValue({
        source: 'package',
        version: '1.0.0-rc.0',
        reason: 'No git tag provided',
      });
      vi.spyOn(manifestHelpers, 'getVersionFromManifests').mockReturnValue({
        version: '1.0.0-rc.0',
        manifestFound: true,
        manifestPath: '/repo/crates/pkg/Cargo.toml',
        manifestType: 'Cargo.toml',
      });
      vi.spyOn(semver, 'prerelease').mockReturnValue(['rc', 0]);
      vi.spyOn(versionUtils, 'normalizePrereleaseIdentifier').mockReturnValue('next');
      vi.spyOn(versionUtils, 'bumpVersion').mockReturnValue('1.0.0-next.0');

      const config = {
        ...defaultConfig,
        type: 'major' as const,
        isPrerelease: true,
        prereleaseIdentifier: 'next',
      };
      const options: VersionOptions = {
        latestTag: '',
        hasRealTag: false,
        type: 'major',
        versionPrefix: 'v',
        path: '/repo/crates/pkg',
        name: 'my-crate',
      };

      const version = await calculateVersion(config as Config, options);

      expect(versionUtils.bumpVersion).toHaveBeenCalledWith('1.0.0-rc.0', 'major', 'next');
      expect(version).toBe('1.0.0-next.0');
    });

    it('should apply major bump with prerelease identifier on first release from stable manifest', async () => {
      vi.spyOn(versionUtils, 'getBestVersionSource').mockResolvedValue({
        source: 'package',
        version: '0.0.0',
        reason: 'No git tag provided',
      });
      vi.spyOn(manifestHelpers, 'getVersionFromManifests').mockReturnValue({
        version: '0.0.0',
        manifestFound: true,
        manifestPath: '/repo/packages/pkg/package.json',
        manifestType: 'package.json',
      });
      vi.spyOn(semver, 'prerelease').mockReturnValue(null);
      vi.spyOn(versionUtils, 'normalizePrereleaseIdentifier').mockReturnValue('next');
      vi.spyOn(versionUtils, 'bumpVersion').mockReturnValue('1.0.0-next.0');

      const config = {
        ...defaultConfig,
        type: 'major' as const,
        isPrerelease: true,
        prereleaseIdentifier: 'next',
      };
      const options: VersionOptions = {
        latestTag: '',
        hasRealTag: false,
        type: 'major',
        versionPrefix: 'v',
        path: '/repo/packages/pkg',
        name: 'my-pkg',
      };

      const version = await calculateVersion(config as Config, options);

      expect(versionUtils.bumpVersion).toHaveBeenCalledWith('0.0.0', 'major', 'next');
      expect(version).toBe('1.0.0-next.0');
    });

    // A stable manifest on a first release with --stable applies the bump (1.0.0 → 2.0.0) rather than graduating.
    // The guard makes the overshoot visible/escapable without changing the resolved version.
    function stableFirstReleaseMocks() {
      vi.spyOn(versionUtils, 'getBestVersionSource').mockResolvedValue({
        source: 'package',
        version: '1.0.0',
        reason: 'No git tag provided',
      });
      vi.spyOn(manifestHelpers, 'getVersionFromManifests').mockReturnValue({
        version: '1.0.0',
        manifestFound: true,
        manifestPath: '/repo/packages/pkg/package.json',
        manifestType: 'package.json',
      });
      vi.spyOn(semver, 'prerelease').mockReturnValue(null);
      vi.spyOn(versionUtils, 'bumpVersion').mockReturnValue('2.0.0');
    }
    const stableFirstReleaseOptions: VersionOptions = {
      latestTag: '',
      hasRealTag: false,
      type: 'major',
      versionPrefix: 'v',
      path: '/repo/packages/pkg',
      name: 'my-pkg',
    };

    it('should warn but still apply the bump on a first-release stable manifest', async () => {
      stableFirstReleaseMocks();
      const config = { ...defaultConfig, stableOnly: true, type: 'major' as const };
      const version = await calculateVersion(config as Config, stableFirstReleaseOptions);
      expect(version).toBe('2.0.0');
      expect(logging.log).toHaveBeenCalledWith(expect.stringContaining('will publish 2.0.0, not 1.0.0'), 'warning');
    });

    it('should abort a first-release stable-manifest bump under mismatchStrategy "error"', async () => {
      stableFirstReleaseMocks();
      const config = { ...defaultConfig, stableOnly: true, type: 'major' as const, mismatchStrategy: 'error' as const };
      await expect(calculateVersion(config as Config, stableFirstReleaseOptions)).rejects.toThrow(
        /First-release version overshoot/,
      );
    });

    it('should apply the bump silently when allowFirstBump acknowledges it', async () => {
      stableFirstReleaseMocks();
      const config = { ...defaultConfig, stableOnly: true, type: 'major' as const, allowFirstBump: true };
      const version = await calculateVersion(config as Config, stableFirstReleaseOptions);
      expect(version).toBe('2.0.0');
      expect(logging.log).not.toHaveBeenCalledWith(expect.stringContaining('will publish 2.0.0, not 1.0.0'), 'warning');
    });

    it('should apply the bump silently under mismatchStrategy "ignore"', async () => {
      stableFirstReleaseMocks();
      const config = {
        ...defaultConfig,
        stableOnly: true,
        type: 'major' as const,
        mismatchStrategy: 'ignore' as const,
      };
      const version = await calculateVersion(config as Config, stableFirstReleaseOptions);
      expect(version).toBe('2.0.0');
      expect(logging.log).not.toHaveBeenCalledWith(expect.stringContaining('will publish 2.0.0, not 1.0.0'), 'warning');
    });
  });

  describe('Specified version type (explicit bump)', () => {
    it('should increment version based on specified type', async () => {
      const options: VersionOptions = {
        latestTag: 'v1.0.0',
        type: 'minor',
        versionPrefix: 'v',
      };

      vi.spyOn(versionUtils, 'bumpVersion').mockReturnValue('1.1.0');

      const version = await calculateVersion(defaultConfig as Config, options);

      expect(semver.clean).toHaveBeenCalledWith('v1.0.0');
      expect(versionUtils.bumpVersion).toHaveBeenCalledWith('1.0.0', 'minor', undefined);
      expect(version).toBe('1.1.0');
    });

    it('should automatically clean prerelease identifiers when using major bump', async () => {
      vi.resetAllMocks();

      vi.spyOn(semver, 'clean').mockReturnValue('1.0.0-next.0');
      vi.spyOn(semver, 'prerelease').mockReturnValue(['next', 0]);
      vi.spyOn(versionUtils, 'bumpVersion').mockReturnValue('2.0.0');

      const options: VersionOptions = {
        latestTag: 'v1.0.0-next.0',
        type: 'major',
        versionPrefix: 'v',
      };

      const version = await calculateVersion(defaultConfig as Config, options);

      expect(semver.clean).toHaveBeenCalledWith('v1.0.0-next.0');
      expect(versionUtils.bumpVersion).toHaveBeenCalledWith('1.0.0-next.0', 'major', undefined);
      expect(version).toBe('2.0.0');
    });

    it('should automatically clean prerelease identifiers when using minor bump', async () => {
      vi.resetAllMocks();

      vi.spyOn(semver, 'clean').mockReturnValue('1.0.0-beta.1');
      vi.spyOn(semver, 'prerelease').mockReturnValue(['beta', 1]);
      vi.spyOn(versionUtils, 'bumpVersion').mockReturnValue('1.1.0');

      const options: VersionOptions = {
        latestTag: 'v1.0.0-beta.1',
        type: 'minor',
        versionPrefix: 'v',
      };

      const version = await calculateVersion(defaultConfig as Config, options);

      expect(semver.clean).toHaveBeenCalledWith('v1.0.0-beta.1');
      expect(versionUtils.bumpVersion).toHaveBeenCalledWith('1.0.0-beta.1', 'minor', undefined);
      expect(version).toBe('1.1.0');
    });

    it('should automatically clean prerelease identifiers when using patch bump', async () => {
      vi.resetAllMocks();

      vi.spyOn(semver, 'clean').mockReturnValue('1.0.0-alpha.2');
      vi.spyOn(semver, 'prerelease').mockReturnValue(['alpha', 2]);
      vi.spyOn(versionUtils, 'bumpVersion').mockReturnValue('1.0.1');

      const options: VersionOptions = {
        latestTag: 'v1.0.0-alpha.2',
        type: 'patch',
        versionPrefix: 'v',
      };

      const version = await calculateVersion(defaultConfig as Config, options);

      expect(semver.clean).toHaveBeenCalledWith('v1.0.0-alpha.2');
      expect(versionUtils.bumpVersion).toHaveBeenCalledWith('1.0.0-alpha.2', 'patch', undefined);
      expect(version).toBe('1.0.1');
    });

    it('should still use prerelease identifiers when using prerelease bump types', async () => {
      const options: VersionOptions = {
        latestTag: 'v1.0.0',
        type: 'prerelease',
        versionPrefix: 'v',
        prereleaseIdentifier: 'alpha',
      };

      vi.spyOn(versionUtils, 'bumpVersion').mockReturnValue('1.0.0-alpha.1');

      const version = await calculateVersion(defaultConfig as Config, options);

      expect(versionUtils.bumpVersion).toHaveBeenCalledWith('1.0.0', 'prerelease', 'alpha');
      expect(version).toBe('1.0.0-alpha.1');
    });

    it('should handle premajor bump type correctly', async () => {
      const options: VersionOptions = {
        latestTag: 'v1.3.0',
        type: 'premajor',
        versionPrefix: 'v',
        prereleaseIdentifier: 'next',
      };

      vi.spyOn(versionUtils, 'bumpVersion').mockReturnValue('2.0.0-next.0');

      const version = await calculateVersion(defaultConfig as Config, options);

      expect(versionUtils.bumpVersion).toHaveBeenCalledWith('1.3.0', 'premajor', 'next');
      expect(version).toBe('2.0.0-next.0');
    });

    it('should create prerelease version when using major bump with prerelease flag', async () => {
      const config = {
        ...defaultConfig,
        type: 'major',
        isPrerelease: true,
        prereleaseIdentifier: 'next',
      };

      const options: VersionOptions = {
        latestTag: 'v1.3.0',
        versionPrefix: 'v',
      };

      vi.spyOn(semver, 'prerelease').mockReturnValue(null);
      vi.spyOn(versionUtils, 'normalizePrereleaseIdentifier').mockReturnValue('next');
      vi.spyOn(versionUtils, 'bumpVersion').mockReturnValue('2.0.0-next.0');

      const version = await calculateVersion(config as Config, options);

      expect(semver.clean).toHaveBeenCalledWith('v1.3.0');
      expect(versionUtils.bumpVersion).toHaveBeenCalledWith('1.3.0', 'major', 'next');
      expect(version).toBe('2.0.0-next.0');
    });

    it('should create prerelease version when using minor bump with prerelease flag', async () => {
      const config = {
        ...defaultConfig,
        type: 'minor',
        isPrerelease: true,
        prereleaseIdentifier: 'next',
      };

      const options: VersionOptions = {
        latestTag: 'v1.3.0',
        versionPrefix: 'v',
      };

      vi.spyOn(semver, 'prerelease').mockReturnValue(null);
      vi.spyOn(versionUtils, 'normalizePrereleaseIdentifier').mockReturnValue('next');
      vi.spyOn(versionUtils, 'bumpVersion').mockReturnValue('1.4.0-next.0');

      const version = await calculateVersion(config as Config, options);

      expect(semver.clean).toHaveBeenCalledWith('v1.3.0');
      expect(versionUtils.bumpVersion).toHaveBeenCalledWith('1.3.0', 'minor', 'next');
      expect(version).toBe('1.4.0-next.0');
    });

    it('should create prerelease version when using patch bump with prerelease flag', async () => {
      const config = {
        ...defaultConfig,
        type: 'patch',
        isPrerelease: true,
        prereleaseIdentifier: 'next',
      };

      const options: VersionOptions = {
        latestTag: 'v1.3.1',
        versionPrefix: 'v',
      };

      vi.spyOn(semver, 'prerelease').mockReturnValue(null);
      vi.spyOn(versionUtils, 'normalizePrereleaseIdentifier').mockReturnValue('next');
      vi.spyOn(versionUtils, 'bumpVersion').mockReturnValue('1.3.2-next.0');

      const version = await calculateVersion(config as Config, options);

      expect(semver.clean).toHaveBeenCalledWith('v1.3.1');
      expect(versionUtils.bumpVersion).toHaveBeenCalledWith('1.3.1', 'patch', 'next');
      expect(version).toBe('1.3.2-next.0');
    });

    it('should correctly strip sanitized dash-format package prefix from tag', async () => {
      // A scoped package name produces tags in the sanitized dash format via a tagTemplate
      // (e.g. "@scope/pkg" → "scope-pkg-v1.2.3"). semver.clean returns null for compound
      // strings, so the strip pattern must handle the dash separator as well as the default
      // "@" separator, otherwise version extraction falls back to '0.0.0'.
      vi.resetAllMocks();

      // Behaves like the real semver.clean.
      vi.spyOn(semver, 'clean').mockImplementation((version) => {
        if (typeof version !== 'string') {
          return null;
        }
        const match = version.match(/^v?(\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?)$/);
        return match ? match[1] : null;
      });
      vi.spyOn(semver, 'prerelease').mockReturnValue(null);
      vi.spyOn(versionUtils, 'getBestVersionSource').mockResolvedValue({
        source: 'git',
        version: 'scope-pkg-v1.2.3',
        reason: 'Versions equal, using git tag',
      });
      vi.spyOn(versionUtils, 'bumpVersion').mockReturnValue('1.3.0');
      vi.spyOn(manifestHelpers, 'getVersionFromManifests').mockReturnValue({
        version: '1.2.3',
        manifestFound: true,
        manifestPath: '/repo/packages/pkg/package.json',
        manifestType: 'package.json',
      });

      const options: VersionOptions = {
        latestTag: 'scope-pkg-v1.2.3',
        type: 'minor',
        versionPrefix: 'v',
        path: '/repo/packages/pkg',
        name: '@scope/pkg',
      };

      const version = await calculateVersion(defaultConfig as Config, options);

      expect(versionUtils.bumpVersion).toHaveBeenCalledWith('1.2.3', 'minor', undefined);
      expect(version).toBe('1.3.0');
    });

    it('should correctly strip template-based package prefix from tag', async () => {
      // The sanitized name makes the strip prefix `wdio-native-spy@v`.
      vi.resetAllMocks();

      vi.spyOn(semver, 'clean').mockImplementation((version) => {
        if (typeof version !== 'string') {
          return null;
        }
        const match = version.match(/^v?(\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?)$/);
        return match ? match[1] : null;
      });
      vi.spyOn(semver, 'prerelease').mockReturnValue(null);
      vi.spyOn(versionUtils, 'getBestVersionSource').mockResolvedValue({
        source: 'git',
        version: 'wdio-native-spy@v1.2.3',
        reason: 'Git tag is newer',
      });
      vi.spyOn(versionUtils, 'bumpVersion').mockReturnValue('1.3.0');
      vi.spyOn(manifestHelpers, 'getVersionFromManifests').mockReturnValue({
        version: '1.2.3',
        manifestFound: true,
        manifestPath: '/repo/packages/native-spy/package.json',
        manifestType: 'package.json',
      });

      const config: Partial<Config> = {
        ...defaultConfig,
        tagTemplate: '${packageName}@v${version}',
        packageSpecificTags: true,
      };

      const options: VersionOptions = {
        latestTag: 'wdio-native-spy@v1.2.3',
        hasRealTag: true,
        versionPrefix: 'v',
        path: '/repo/packages/native-spy',
        name: '@wdio/native-spy',
        type: 'minor',
      };

      const version = await calculateVersion(config as Config, options);

      expect(versionUtils.bumpVersion).toHaveBeenCalledWith('1.2.3', 'minor', undefined);
      expect(version).toBe('1.3.0');
    });

    it('should fall back to hardcoded patterns when tagTemplate does not include packageName', async () => {
      vi.resetAllMocks();

      vi.spyOn(semver, 'clean').mockImplementation((version) => {
        if (typeof version !== 'string') {
          return null;
        }
        const match = version.match(/^v?(\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?)$/);
        return match ? match[1] : null;
      });
      vi.spyOn(semver, 'prerelease').mockReturnValue(null);
      vi.spyOn(versionUtils, 'getBestVersionSource').mockResolvedValue({
        source: 'git',
        version: 'scope-pkg-v1.2.3',
        reason: 'Git tag is newer',
      });
      vi.spyOn(versionUtils, 'bumpVersion').mockReturnValue('1.3.0');
      vi.spyOn(manifestHelpers, 'getVersionFromManifests').mockReturnValue({
        version: '1.2.3',
        manifestFound: true,
        manifestPath: '/repo/packages/pkg/package.json',
        manifestType: 'package.json',
      });

      const config: Partial<Config> = {
        ...defaultConfig,
        tagTemplate: '${prefix}${version}',
        packageSpecificTags: true,
      };

      const options: VersionOptions = {
        latestTag: 'scope-pkg-v1.2.3',
        hasRealTag: true,
        versionPrefix: 'v',
        path: '/repo/packages/pkg',
        name: '@scope/pkg',
        type: 'minor',
      };

      const version = await calculateVersion(config as Config, options);

      expect(versionUtils.bumpVersion).toHaveBeenCalledWith('1.2.3', 'minor', undefined);
      expect(version).toBe('1.3.0');
    });

    it('should strip a multi-segment baselineTagTemplate prefix from latestTag', async () => {
      // If the strip regex only knew the consumer prefix `v`, semver.clean would return null for
      // `release/v0.21.0` and the bump would run from '0.0.0'.
      vi.resetAllMocks();
      vi.spyOn(semver, 'clean').mockImplementation((version) => {
        if (typeof version !== 'string') {
          return null;
        }
        const match = version.match(/^v?(\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?)$/);
        return match ? match[1] : null;
      });
      vi.spyOn(semver, 'prerelease').mockReturnValue(null);
      vi.spyOn(versionUtils, 'getBestVersionSource').mockResolvedValue({
        source: 'git',
        version: 'release/v0.21.0',
        reason: 'Git tag reachable',
      });
      vi.spyOn(versionUtils, 'bumpVersion').mockReturnValue('0.22.0');
      vi.spyOn(manifestHelpers, 'getVersionFromManifests').mockReturnValue({
        version: '0.21.0',
        manifestFound: true,
        manifestPath: '/repo/package.json',
        manifestType: 'package.json',
      });

      const config: Partial<Config> = {
        ...defaultConfig,
        tagTemplate: '${prefix}${version}',
        baselineTagTemplate: 'release/${prefix}${version}',
      };

      const options: VersionOptions = {
        latestTag: 'release/v0.21.0',
        hasRealTag: true,
        versionPrefix: 'v',
        path: '/repo',
        type: 'minor',
      };

      const version = await calculateVersion(config as Config, options);

      expect(versionUtils.bumpVersion).toHaveBeenCalledWith('0.21.0', 'minor', undefined);
      expect(version).toBe('0.22.0');
    });
  });

  describe('Conventional commits analysis', () => {
    it('should call Bumper.commits with baseRef when config.baseRef is set', async () => {
      const commitsSpy = vi.spyOn(Bumper.prototype, 'commits').mockReturnThis();
      vi.spyOn(versionUtils, 'bumpVersion').mockReturnValue('1.0.1');

      const config = { ...defaultConfig, baseRef: 'deadbeef123' } as Config;
      const options: VersionOptions = { latestTag: 'v1.0.0', versionPrefix: 'v' };

      await calculateVersion(config, options);

      expect(commitsSpy).toHaveBeenCalledWith({ from: 'deadbeef123' });
    });

    it('should bound the bumper to latestTag when baseRef is absent and the tag exists', async () => {
      // Unbounded, conventional-recommended-bump scans the entire history and historical feats inflate the bump
      // (a docs-only window bumps minor instead of patch).
      const commitsSpy = vi.spyOn(Bumper.prototype, 'commits').mockReturnThis();
      vi.spyOn(gitTags, 'refExists').mockReturnValue(true);
      vi.spyOn(versionUtils, 'bumpVersion').mockReturnValue('1.0.1');

      const options: VersionOptions = { latestTag: 'v1.0.0', versionPrefix: 'v' };

      await calculateVersion(defaultConfig as Config, options);

      expect(commitsSpy).toHaveBeenCalledWith({ from: 'v1.0.0' });
    });

    it('should bound the bumper to a multi-segment baseline tag when baseRef is absent', async () => {
      const commitsSpy = vi.spyOn(Bumper.prototype, 'commits').mockReturnThis();
      vi.spyOn(gitTags, 'refExists').mockReturnValue(true);
      vi.spyOn(versionUtils, 'bumpVersion').mockReturnValue('0.29.1');

      const config = { ...defaultConfig, baselineTagTemplate: 'release/${prefix}${version}' } as Config;
      const options: VersionOptions = { latestTag: 'release/v0.29.0', versionPrefix: 'v' };

      await calculateVersion(config, options);

      expect(commitsSpy).toHaveBeenCalledWith({ from: 'release/v0.29.0' });
    });

    it('should leave the bumper unbounded when baseRef is absent and latestTag does not resolve', async () => {
      // Falls back to unbounded rather than throwing, like the changelog path's rev-parse guard.
      const commitsSpy = vi.spyOn(Bumper.prototype, 'commits').mockReturnThis();
      vi.spyOn(gitTags, 'refExists').mockReturnValue(false);
      vi.spyOn(versionUtils, 'bumpVersion').mockReturnValue('1.0.1');

      const options: VersionOptions = { latestTag: 'v1.0.0', versionPrefix: 'v' };

      await calculateVersion(defaultConfig as Config, options);

      expect(commitsSpy).not.toHaveBeenCalled();
    });

    it('should use conventional commits when no type or branch pattern matches', async () => {
      vi.spyOn(Bumper.prototype, 'bump').mockResolvedValue({
        releaseType: 'patch',
      } as unknown as BumperRecommendationResult);
      vi.spyOn(versionUtils, 'bumpVersion').mockReturnValue('1.0.1');

      const options: VersionOptions = {
        latestTag: 'v1.0.0',
        versionPrefix: 'v',
      };

      const version = await calculateVersion(defaultConfig as Config, options);

      expect(Bumper.prototype.bump).toHaveBeenCalledWith(createAngularPreset().whatBump);
      expect(versionUtils.bumpVersion).toHaveBeenCalledWith('1.0.0', 'patch', undefined);
      expect(version).toBe('1.0.1');
    });

    it('should return empty string if no commits since last tag', async () => {
      vi.spyOn(gitTags, 'getCommitsLength').mockResolvedValue(0);

      vi.spyOn(versionUtils, 'getBestVersionSource').mockResolvedValueOnce({
        source: 'git',
        version: 'v1.0.0',
        reason: 'Git tag exists',
      });

      vi.spyOn(Bumper.prototype, 'bump').mockResolvedValue({} as unknown as BumperRecommendationResult);

      const options: VersionOptions = {
        latestTag: 'v1.0.0',
        versionPrefix: 'v',
      };

      const version = await calculateVersion(defaultConfig as Config, options);

      expect(version).toBe('');
      expect(logging.log).toHaveBeenCalledWith(
        'No relevant commits found for project since v1.0.0, skipping version bump',
        'info',
      );
    });

    it('should return empty string if conventional-commits finds no relevant commits', async () => {
      vi.spyOn(Bumper.prototype, 'bump').mockResolvedValue({} as unknown as BumperRecommendationResult);

      const options: VersionOptions = {
        latestTag: 'v1.0.0',
        versionPrefix: 'v',
      };

      const version = await calculateVersion(defaultConfig as Config, options);

      expect(version).toBe('');
      expect(logging.log).toHaveBeenCalledWith(expect.stringContaining('No relevant commits found'), 'info');
    });

    it('should return initial version if no tags exist and conventional-commits suggests a type', async () => {
      vi.spyOn(manifestHelpers, 'getVersionFromManifests').mockReturnValueOnce({
        version: '0.0.0',
        manifestFound: true,
        manifestPath: 'path/to/package.json',
        manifestType: 'package.json',
      });
      vi.spyOn(versionUtils, 'bumpVersion').mockReturnValue('0.0.1');

      const options: VersionOptions = {
        // @ts-expect-error - Testing with null latestTag
        latestTag: null,
        versionPrefix: 'v',
      };

      const version = await calculateVersion(defaultConfig as Config, options);

      expect(version).toBe('0.0.1');
    });
  });

  describe('Pre-1.0 breaking changes (zeroMajor)', () => {
    function setupInferred(releaseType: ReleaseType, currentVersion: string): void {
      vi.spyOn(Bumper.prototype, 'bump').mockResolvedValue({
        releaseType,
      } as unknown as BumperRecommendationResult);
      vi.spyOn(versionUtils, 'getBestVersionSource').mockResolvedValue({
        source: 'git',
        version: `v${currentVersion}`,
        reason: 'Git tag exists',
      });
    }

    it('should bump the 0.x minor for an inferred breaking change under the default (0.24.0 -> 0.25.0)', async () => {
      setupInferred('major', '0.24.0');
      const bumpSpy = vi.spyOn(versionUtils, 'bumpVersion').mockReturnValue('0.25.0');

      const version = await calculateVersion(defaultConfig as Config, {
        latestTag: 'v0.24.0',
        versionPrefix: 'v',
      });

      expect(bumpSpy).toHaveBeenCalledWith('0.24.0', 'minor', undefined);
      expect(version).toBe('0.25.0');
    });

    it('should bump to the next major for an inferred breaking change at/after 1.0.0 (1.2.0 -> 2.0.0)', async () => {
      setupInferred('major', '1.2.0');
      const bumpSpy = vi.spyOn(versionUtils, 'bumpVersion').mockReturnValue('2.0.0');

      const version = await calculateVersion(defaultConfig as Config, {
        latestTag: 'v1.2.0',
        versionPrefix: 'v',
      });

      expect(bumpSpy).toHaveBeenCalledWith('1.2.0', 'major', undefined);
      expect(version).toBe('2.0.0');
    });

    it("should bump to 1.0.0 for an inferred breaking change pre-1.0 when zeroMajor is 'strict'", async () => {
      setupInferred('major', '0.24.0');
      const bumpSpy = vi.spyOn(versionUtils, 'bumpVersion').mockReturnValue('1.0.0');

      const config = { ...defaultConfig, zeroMajor: 'strict' } as Config;
      const version = await calculateVersion(config, {
        latestTag: 'v0.24.0',
        versionPrefix: 'v',
      });

      // strict matches semantic-release: breaking -> major even pre-1.0.
      expect(bumpSpy).toHaveBeenCalledWith('0.24.0', 'major', undefined);
      expect(version).toBe('1.0.0');
    });

    it('should NOT downgrade an explicit major bump pre-1.0 (specifiedType: major on 0.24.0 -> 1.0.0)', async () => {
      vi.spyOn(versionUtils, 'getBestVersionSource').mockResolvedValue({
        source: 'git',
        version: 'v0.24.0',
        reason: 'Git tag exists',
      });
      const bumpSpy = vi.spyOn(versionUtils, 'bumpVersion').mockReturnValue('1.0.0');

      const version = await calculateVersion(defaultConfig as Config, {
        latestTag: 'v0.24.0',
        type: 'major',
        versionPrefix: 'v',
      });

      expect(bumpSpy).toHaveBeenCalledWith('0.24.0', 'major', undefined);
      expect(version).toBe('1.0.0');
    });

    it('should leave an inferred feat (minor) untouched pre-1.0 (0.24.0 -> 0.25.0, not 0.24.1)', async () => {
      setupInferred('minor', '0.24.0');
      const bumpSpy = vi.spyOn(versionUtils, 'bumpVersion').mockReturnValue('0.25.0');

      const version = await calculateVersion(defaultConfig as Config, {
        latestTag: 'v0.24.0',
        versionPrefix: 'v',
      });

      // Only the irreversible breaking->major (1.0.0) jump is corrected; feat->minor is not downgraded to patch.
      expect(bumpSpy).toHaveBeenCalledWith('0.24.0', 'minor', undefined);
      expect(version).toBe('0.25.0');
    });

    it('should downgrade an inferred breaking change to minor pre-1.0 in the prerelease flow (0.24.0 -> 0.25.0-next.0)', async () => {
      setupInferred('major', '0.24.0');
      const bumpSpy = vi.spyOn(versionUtils, 'bumpVersion').mockReturnValue('0.25.0-next.0');

      const config = { ...defaultConfig, isPrerelease: true, prereleaseIdentifier: 'next' } as Config;
      const version = await calculateVersion(config, {
        latestTag: 'v0.24.0',
        versionPrefix: 'v',
      });

      // The identifier is threaded through so bumpVersion emits the preminor-shaped 0.25.0-next.0.
      expect(bumpSpy).toHaveBeenCalledWith('0.24.0', 'minor', 'next');
      expect(version).toBe('0.25.0-next.0');
    });
  });

  describe('Error handling', () => {
    it('should rethrow errors during conventional bump calculation', async () => {
      vi.spyOn(Bumper.prototype, 'bump').mockRejectedValue(new Error('Failed to analyze commits'));

      const options: VersionOptions = {
        latestTag: 'v1.0.0',
        versionPrefix: 'v',
      };

      await expect(calculateVersion(defaultConfig as Config, options)).rejects.toThrow('Failed to analyze commits');

      expect(logging.log).toHaveBeenCalledWith(expect.stringContaining('Failed to calculate version'), 'error');
    });

    it('should return initial version if error includes "No names found"', async () => {
      const error = new Error('No names found, cannot describe anything');
      vi.spyOn(Bumper.prototype, 'bump').mockRejectedValue(error);

      const options: VersionOptions = {
        latestTag: 'v1.0.0',
        versionPrefix: 'v',
      };

      const version = await calculateVersion(defaultConfig as Config, options);

      expect(version).toBe('0.1.0');
      expect(logging.log).toHaveBeenCalledWith(expect.stringContaining('No tags found'), 'info');
    });
  });

  describe('First release scenarios', () => {
    beforeEach(() => {
      vi.resetAllMocks();

      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify({ version: '1.0.0-beta.1' }));

      vi.spyOn(path, 'join').mockImplementation((...segments) => segments.join('/'));

      vi.spyOn(semver, 'prerelease').mockReturnValue(['beta', 1]);

      vi.spyOn(semver, 'parse').mockImplementation((version) => {
        if (version === '1.0.0-beta.1') {
          return {
            major: 1,
            minor: 0,
            patch: 0,
            prerelease: ['beta', 1],
          } as unknown as semver.SemVer;
        }
        if (version === '1.0.0-next.0') {
          return {
            major: 1,
            minor: 0,
            patch: 0,
            prerelease: ['next', 0],
          } as unknown as semver.SemVer;
        }
        return null;
      });

      vi.spyOn(semver, 'inc').mockImplementation((version, releaseType, identifier) => {
        if (!version) {
          return '1.0.0';
        }

        if (version === '1.0.0-beta.1' && releaseType === 'patch') {
          return '1.0.1';
        }
        if (version === '1.0.1' && releaseType === 'major') {
          return '2.0.0';
        }

        if (version === '1.0.1' && releaseType === 'minor') {
          return '1.1.0';
        }

        if (version === '1.0.0-beta.1' && releaseType === 'patch' && !identifier) {
          return '1.0.1';
        }

        if (version === '1.0.0' && releaseType === 'patch') {
          return '1.0.1';
        }

        if (identifier) {
          return `${version}-${identifier}.0`;
        }

        return '1.0.0-test';
      });
    });

    afterEach(() => {
      vi.clearAllMocks();
    });

    it.each([
      ['missing or unreadable', { version: null, manifestFound: false, manifestPath: '', manifestType: null }],
      [
        'versionless',
        { version: null, manifestFound: true, manifestPath: '/test/path/package.json', manifestType: 'package.json' },
      ],
    ] as const)('should bump from the initial version when the manifest is %s', async (_label, manifest) => {
      vi.spyOn(manifestHelpers, 'getVersionFromManifests').mockReturnValue(manifest);
      const actual = await vi.importActual<typeof versionUtils>('../../../src/utils/versionUtils.js');
      vi.spyOn(versionUtils, 'getBestVersionSource').mockImplementation(actual.getBestVersionSource);
      vi.spyOn(versionUtils, 'bumpVersion').mockReturnValue('0.2.0');

      const version = await calculateVersion(defaultConfig as Config, {
        latestTag: '',
        type: 'minor',
        versionPrefix: 'v',
        path: '/test/path',
      });

      expect(versionUtils.bumpVersion).toHaveBeenCalledWith('0.1.0', 'minor', undefined);
      expect(version).toBe('0.2.0');
    });

    it('should apply bump to manifest version for first release with explicit bump', async () => {
      vi.spyOn(manifestHelpers, 'getVersionFromManifests').mockReturnValue({
        version: '1.0.0-beta.1',
        manifestFound: true,
        manifestPath: 'path/to/package.json',
        manifestType: 'package.json',
      });
      vi.spyOn(versionUtils, 'getBestVersionSource').mockResolvedValue({
        source: 'package',
        version: '1.0.0-beta.1',
        reason: 'No git tag provided',
      });
      vi.spyOn(versionUtils, 'bumpVersion').mockReturnValue('2.0.0');

      const options: VersionOptions = {
        latestTag: '',
        type: 'major',
        versionPrefix: 'v',
        path: '/test/path',
      };

      const version = await calculateVersion(defaultConfig as Config, options);

      expect(versionUtils.bumpVersion).toHaveBeenCalledWith('1.0.0-beta.1', 'major', undefined);
      expect(version).toBe('2.0.0');
      expect(logging.log).toHaveBeenCalledWith(expect.stringContaining('Using version source: package'), 'info');
    });

    it('should apply bump to prerelease manifest version on first release', async () => {
      vi.spyOn(manifestHelpers, 'getVersionFromManifests').mockReturnValue({
        version: '1.0.0-next.0',
        manifestFound: true,
        manifestPath: 'path/to/package.json',
        manifestType: 'package.json',
      });
      vi.spyOn(versionUtils, 'getBestVersionSource').mockResolvedValue({
        source: 'package',
        version: '1.0.0-next.0',
        reason: 'No git tag provided',
      });
      vi.spyOn(versionUtils, 'bumpVersion').mockReturnValue('2.0.0');

      const config: Partial<Config> = {
        ...defaultConfig,
        type: 'major',
      };

      const options: VersionOptions = {
        latestTag: '',
        versionPrefix: 'v',
        path: '/test/path',
      };

      const version = await calculateVersion(config as Config, options);
      expect(versionUtils.bumpVersion).toHaveBeenCalledWith('1.0.0-next.0', 'major', undefined);
      expect(version).toBe('2.0.0');
    });

    it('should apply bump to stable manifest version on first release', async () => {
      vi.spyOn(manifestHelpers, 'getVersionFromManifests').mockReturnValue({
        version: '1.0.0',
        manifestFound: true,
        manifestPath: 'path/to/package.json',
        manifestType: 'package.json',
      });
      vi.spyOn(versionUtils, 'getBestVersionSource').mockResolvedValue({
        source: 'package',
        version: '1.0.0',
        reason: 'No git tag provided',
      });
      vi.spyOn(semver, 'prerelease').mockReturnValue(null);
      vi.spyOn(versionUtils, 'bumpVersion').mockReturnValue('1.0.1');

      const config: Partial<Config> = {
        ...defaultConfig,
        type: 'patch',
      };

      const options: VersionOptions = {
        latestTag: '',
        versionPrefix: 'v',
        path: '/test/path',
      };

      const version = await calculateVersion(config as Config, options);
      expect(versionUtils.bumpVersion).toHaveBeenCalledWith('1.0.0', 'patch', undefined);
      expect(version).toBe('1.0.1');
    });
  });

  describe('Version Mismatch Detection', () => {
    it('should use smart fallback when package.json version is ahead of Git tag version', async () => {
      vi.spyOn(versionUtils, 'getBestVersionSource').mockResolvedValueOnce({
        source: 'package',
        version: '1.1.0',
        reason: 'Package version is newer',
      });

      const config: Partial<Config> = {
        ...defaultConfig,
        type: 'patch', // Bypass conventional commits
      };

      const options: VersionOptions = {
        latestTag: 'v1.0.0',
        versionPrefix: 'v',
        path: '/test/path',
      };

      const version = await calculateVersion(config as Config, options);
      expect(version).toBe('1.1.1');
    });

    it('should use smart fallback with Cargo.toml when package version is ahead', async () => {
      vi.spyOn(versionUtils, 'getBestVersionSource').mockResolvedValueOnce({
        source: 'package',
        version: '1.1.0',
        reason: 'Package version is newer',
      });

      const config: Partial<Config> = {
        ...defaultConfig,
        type: 'patch',
      };

      const options: VersionOptions = {
        latestTag: 'v1.0.0',
        versionPrefix: 'v',
        path: '/test/path',
      };

      const version = await calculateVersion(config as Config, options);
      expect(version).toBe('1.1.1');
    });

    it('should use smart fallback when Git tag version is ahead of package.json version', async () => {
      vi.spyOn(versionUtils, 'getBestVersionSource').mockResolvedValueOnce({
        source: 'git',
        version: 'v1.2.0',
        reason: 'Git tag is newer',
      });

      const config: Partial<Config> = {
        ...defaultConfig,
        type: 'patch',
      };

      const options: VersionOptions = {
        latestTag: 'v1.2.0',
        versionPrefix: 'v',
        path: '/test/path',
      };

      const version = await calculateVersion(config as Config, options);
      expect(version).toBe('1.2.1');
    });

    it('should use smart fallback when Git tag version is ahead of Cargo.toml version', async () => {
      vi.spyOn(versionUtils, 'getBestVersionSource').mockResolvedValueOnce({
        source: 'git',
        version: 'v1.2.0',
        reason: 'Git tag is newer',
      });

      const config: Partial<Config> = {
        ...defaultConfig,
        type: 'patch',
      };

      const options: VersionOptions = {
        latestTag: 'v1.2.0',
        versionPrefix: 'v',
        path: '/test/path',
      };

      const version = await calculateVersion(config as Config, options);
      expect(version).toBe('1.2.1');
    });

    it('should use smart fallback for tag-ahead scenario', async () => {
      vi.spyOn(versionUtils, 'getBestVersionSource').mockResolvedValueOnce({
        source: 'git',
        version: 'v1.2.0',
        reason: 'Git tag is newer',
      });

      const config: Partial<Config> = {
        ...defaultConfig,
        type: 'patch',
      };

      const options: VersionOptions = {
        latestTag: 'v1.2.0',
        versionPrefix: 'v',
        path: '/test/path',
      };

      const version = await calculateVersion(config as Config, options);
      expect(version).toBe('1.2.1');
    });

    it('should not warn when package.json version equals Git tag version', async () => {
      vi.spyOn(versionUtils, 'getBestVersionSource').mockResolvedValueOnce({
        source: 'git',
        version: 'v1.0.0',
        reason: 'Versions equal, using git tag',
      });

      const config: Partial<Config> = {
        ...defaultConfig,
        type: 'patch',
      };

      const options: VersionOptions = {
        latestTag: 'v1.0.0',
        versionPrefix: 'v',
        path: '/test/path',
      };

      const version = await calculateVersion(config as Config, options);
      expect(version).toBe('1.0.1');
    });

    it('should not warn when package.json version is behind Git tag version', async () => {
      vi.spyOn(versionUtils, 'getBestVersionSource').mockResolvedValueOnce({
        source: 'git',
        version: 'v1.2.0',
        reason: 'Git tag is newer',
      });

      const config: Partial<Config> = {
        ...defaultConfig,
        type: 'patch',
      };

      const options: VersionOptions = {
        latestTag: 'v1.2.0',
        versionPrefix: 'v',
        path: '/test/path',
      };

      const version = await calculateVersion(config as Config, options);
      expect(version).toBe('1.2.1');
    });

    it('should apply bump to package.json version for first release when hasNoTags is true', async () => {
      vi.spyOn(versionUtils, 'getBestVersionSource').mockResolvedValueOnce({
        source: 'package',
        version: '1.0.0',
        reason: 'No git tag provided',
      });

      const config: Partial<Config> = {
        ...defaultConfig,
        type: 'patch',
      };

      const options: VersionOptions = {
        latestTag: '',
        versionPrefix: 'v',
        path: '/test/path',
      };

      const version = await calculateVersion(config as Config, options);
      expect(version).toBe('1.0.1');
    });

    it('should not warn when no manifest is found', async () => {
      vi.spyOn(versionUtils, 'getBestVersionSource').mockResolvedValueOnce({
        source: 'git',
        version: 'v1.0.0',
        reason: 'Git tag exists, no package version to compare',
      });

      const config: Partial<Config> = {
        ...defaultConfig,
        type: 'patch',
      };

      const options: VersionOptions = {
        latestTag: 'v1.0.0',
        versionPrefix: 'v',
        path: '/test/path',
      };

      const version = await calculateVersion(config as Config, options);
      expect(version).toBe('1.0.1');
    });

    it('should handle package-specific tags correctly with smart fallback', async () => {
      vi.spyOn(versionUtils, 'getBestVersionSource').mockResolvedValueOnce({
        source: 'package',
        version: '1.1.0',
        reason: 'Package version is newer',
      });

      const config: Partial<Config> = {
        ...defaultConfig,
        type: 'patch',
      };

      const options: VersionOptions = {
        latestTag: 'my-package@v1.0.0',
        versionPrefix: 'v',
        path: '/test/path',
        name: 'my-package',
      };

      const version = await calculateVersion(config as Config, options);
      expect(version).toBe('1.1.1');
    });

    it('should use smart fallback when package version is ahead', async () => {
      vi.spyOn(versionUtils, 'getBestVersionSource').mockResolvedValueOnce({
        source: 'package',
        version: '1.1.0',
        reason: 'Package version is newer',
      });

      const config: Partial<Config> = {
        ...defaultConfig,
        type: 'patch',
      };

      const options: VersionOptions = {
        latestTag: 'v1.0.0',
        versionPrefix: 'v',
        path: '/test/path',
      };

      const version = await calculateVersion(config as Config, options);
      expect(version).toBe('1.1.1');
    });
  });

  describe('Prerelease Logic Fix', () => {
    describe('prereleaseIdentifier config vs isPrerelease flag', () => {
      it('should NOT create prerelease when prereleaseIdentifier is in config but isPrerelease is not set', async () => {
        const config: Partial<Config> = {
          ...defaultConfig,
          prereleaseIdentifier: 'next',
          type: 'patch',
        };

        const options: VersionOptions = {
          latestTag: 'v1.0.0',
          versionPrefix: 'v',
          path: '/test',
        };

        const result = await calculateVersion(config as Config, options);

        expect(versionUtils.bumpVersion).toHaveBeenCalledWith('1.0.0', 'patch', undefined);
        expect(result).toBe('1.0.1');
      });

      it('should create prerelease when prereleaseIdentifier is in config AND isPrerelease is true', async () => {
        const config: Partial<Config> = {
          ...defaultConfig,
          prereleaseIdentifier: 'next',
          type: 'patch',
          isPrerelease: true,
        };

        const options: VersionOptions = {
          latestTag: 'v1.0.0',
          versionPrefix: 'v',
          path: '/test',
        };

        vi.spyOn(versionUtils, 'bumpVersion').mockReturnValue('1.0.1-next.0');

        const result = await calculateVersion(config as Config, options);

        expect(versionUtils.bumpVersion).toHaveBeenCalledWith('1.0.0', 'patch', 'next');
        expect(result).toBe('1.0.1-next.0');
      });

      it('should handle existing prerelease correctly (even without isPrerelease flag)', async () => {
        const config: Partial<Config> = {
          ...defaultConfig,
          prereleaseIdentifier: 'next',
          type: 'patch',
        };

        const options: VersionOptions = {
          latestTag: 'v1.0.0-next.0',
          versionPrefix: 'v',
          path: '/test',
        };

        vi.spyOn(semver, 'prerelease').mockReturnValue(['next', 0]);
        vi.spyOn(semver, 'clean').mockImplementation((version) => {
          if (version === 'v1.0.0-next.0') {
            return '1.0.0-next.0';
          }
          return version?.replace(/^[^\d]*/, '') || null;
        });
        vi.spyOn(versionUtils, 'bumpVersion').mockReturnValue('1.0.0');

        const result = await calculateVersion(config as Config, options);

        expect(versionUtils.bumpVersion).toHaveBeenCalledWith('1.0.0-next.0', 'patch', undefined);
        expect(result).toBe('1.0.0');
      });
    });
  });

  describe('stableOnly mode (release:graduate without bump label)', () => {
    it('should graduate a prerelease package to its stable base version', async () => {
      const config: Partial<Config> = {
        ...defaultConfig,
        stableOnly: true,
      };

      const options: VersionOptions = {
        latestTag: 'v1.0.0-next.6',
        versionPrefix: 'v',
        path: '/test',
      };

      vi.spyOn(semver, 'prerelease').mockReturnValue(['next', 6]);
      vi.spyOn(semver, 'parse').mockReturnValue({
        major: 1,
        minor: 0,
        patch: 0,
        prerelease: ['next', 6],
      } as unknown as semver.SemVer);

      const result = await calculateVersion(config as Config, options);

      expect(result).toBe('1.0.0');
      expect(versionUtils.bumpVersion).not.toHaveBeenCalled();
    });

    it('should skip an already-stable package when no bump label is set', async () => {
      const config: Partial<Config> = {
        ...defaultConfig,
        stableOnly: true,
      };

      const options: VersionOptions = {
        latestTag: 'v2.0.0',
        versionPrefix: 'v',
        path: '/test',
      };

      vi.spyOn(semver, 'prerelease').mockReturnValue(null);

      const result = await calculateVersion(config as Config, options);

      expect(result).toBe('');
      expect(versionUtils.bumpVersion).not.toHaveBeenCalled();
    });

    it('should apply bump label to an already-stable package (release:graduate + bump:minor)', async () => {
      const config: Partial<Config> = {
        ...defaultConfig,
        stableOnly: true,
        type: 'minor',
      };

      const options: VersionOptions = {
        latestTag: 'v2.0.0',
        versionPrefix: 'v',
        path: '/test',
      };

      vi.spyOn(semver, 'prerelease').mockReturnValue(null);

      const result = await calculateVersion(config as Config, options);

      expect(versionUtils.bumpVersion).toHaveBeenCalledWith('2.0.0', 'minor', undefined);
      expect(result).toBe('2.1.0');
    });

    it('should graduate a prerelease package even when a bump label is also set', async () => {
      const config: Partial<Config> = {
        ...defaultConfig,
        stableOnly: true,
        type: 'minor',
      };

      const options: VersionOptions = {
        latestTag: 'v1.0.0-next.6',
        versionPrefix: 'v',
        path: '/test',
      };

      vi.spyOn(semver, 'prerelease').mockReturnValue(['next', 6]);
      vi.spyOn(semver, 'parse').mockReturnValue({
        major: 1,
        minor: 0,
        patch: 0,
        prerelease: ['next', 6],
      } as unknown as semver.SemVer);

      const result = await calculateVersion(config as Config, options);

      expect(result).toBe('1.0.0');
      expect(versionUtils.bumpVersion).not.toHaveBeenCalled();
    });

    it('should graduate regardless of conventional commits', async () => {
      const config: Partial<Config> = {
        ...defaultConfig,
        stableOnly: true,
      };

      const options: VersionOptions = {
        latestTag: 'v1.1.0-beta.3',
        versionPrefix: 'v',
        path: '/test',
      };

      vi.spyOn(semver, 'prerelease').mockReturnValue(['beta', 3]);
      vi.spyOn(semver, 'parse').mockReturnValue({
        major: 1,
        minor: 1,
        patch: 0,
        prerelease: ['beta', 3],
      } as unknown as semver.SemVer);
      vi.spyOn(gitTags, 'getCommitsLength').mockResolvedValue(0);

      const result = await calculateVersion(config as Config, options);

      expect(result).toBe('1.1.0');
      expect(versionUtils.bumpVersion).not.toHaveBeenCalled();
    });
  });
});
