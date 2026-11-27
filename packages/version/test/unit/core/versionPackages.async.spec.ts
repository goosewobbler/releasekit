import * as fs from 'node:fs';
import type { Package } from '@manypkg/get-packages';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as cargoHandler from '../../../src/cargo/cargoHandler.js';
import * as commitParser from '../../../src/changelog/commitParser.js';
import * as calculator from '../../../src/core/versionCalculator.js';
import type { PackagesWithRoot } from '../../../src/core/versionEngine.js';
import { versionPackages } from '../../../src/core/versionPackages.js';
import { StrictReachableError } from '../../../src/errors/strictReachableError.js';
import * as gitTags from '../../../src/git/tagsAndBranches.js';
import * as tagVerification from '../../../src/git/tagVerification.js';
import * as packageManagement from '../../../src/package/packageManagement.js';
import * as pubHandler from '../../../src/pub/pubHandler.js';
import type { VersionRecord } from '../../../src/record/recordFile.js';
import type { Config } from '../../../src/types.js';
import * as formatting from '../../../src/utils/formatting.js';
import * as jsonOutput from '../../../src/utils/jsonOutput.js';
import * as logging from '../../../src/utils/logging.js';

const record = {
  current: (pkg: Package) => ({ version: pkg.packageJson.version, recorded: true }),
} as unknown as VersionRecord;

vi.mock('../../../src/package/packageManagement.js');
vi.mock('../../../src/git/tagsAndBranches.js');
vi.mock('../../../src/git/tagVerification.js');
vi.mock('../../../src/utils/logging.js');
vi.mock('../../../src/utils/formatting.js', () => ({
  formatVersionPrefix: vi.fn(),
  formatTag: vi.fn(),
  deriveBaselineTagPrefix: vi.fn(),
  displayTag: vi.fn(),
}));
vi.mock('../../../src/utils/jsonOutput.js');
vi.mock('../../../src/core/versionCalculator.js');
vi.mock('node:fs');
vi.mock('../../../src/cargo/cargoHandler.js');
vi.mock('../../../src/pub/pubHandler.js');

const ROOT = '/path/to';
const TAG_TEMPLATE = '${prefix}${version}';
const BASELINE_TAG_TEMPLATE = 'release/${prefix}${version}';

function pkg(name: string, version = '1.0.0'): Package {
  return { dir: `${ROOT}/${name}`, packageJson: { name, version } } as Package;
}

const packageA = pkg('package-a');
const packageB = pkg('package-b');
const packageC = pkg('package-c');
const allPackages = [packageA, packageB, packageC];

const baseConfig: Config = {
  sync: false,
  preset: 'conventionalcommits',
  versionPrefix: 'v',
  tagTemplate: TAG_TEMPLATE,
  packages: [],
  commitMessage: 'chore(release): ${version}',
  dryRun: false,
};

function run(config: Partial<Config> = {}, packages: Package[] = allPackages, targets: string[] = []) {
  return versionPackages(
    { ...baseConfig, ...config },
    { root: ROOT, packages, tool: 'pnpm' } as unknown as PackagesWithRoot,
    record,
    targets,
  );
}

function changelogFor(name: string) {
  return vi.mocked(jsonOutput.addChangelogData).mock.calls.find(([data]) => data.packageName === name)?.[0];
}

describe('versionPackages (async)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(cargoHandler.isVersionedCrate).mockReturnValue(true);
    vi.mocked(pubHandler.isReleasablePubspec).mockReturnValue(true);

    // Reachable baseline so changelog ranges resolve to `<tag>..HEAD`; all-history fallback tests override this.
    vi.mocked(tagVerification.verifyTag).mockResolvedValue({ exists: true, reachable: true });
    vi.mocked(gitTags.getLatestTagForPackage).mockResolvedValue('');
    vi.mocked(gitTags.getLatestTag).mockResolvedValue('v1.0.0');
    vi.mocked(gitTags.getNearestReachableTag).mockResolvedValue('');

    vi.mocked(calculator.calculateVersion).mockResolvedValue('1.1.0');

    vi.mocked(formatting.formatVersionPrefix).mockImplementation((prefix) => prefix);
    vi.mocked(formatting.formatTag).mockImplementation((version, prefix) => `${prefix}${version}`);
    vi.mocked(formatting.deriveBaselineTagPrefix).mockReturnValue(undefined);
    vi.mocked(formatting.displayTag).mockImplementation((tag, baselineTagPrefix, formattedPrefix) =>
      baselineTagPrefix && tag.startsWith(baselineTagPrefix)
        ? `${formattedPrefix}${tag.slice(baselineTagPrefix.length)}`
        : tag,
    );

    vi.mocked(fs.existsSync).mockImplementation((p) => String(p).endsWith('package.json'));
    vi.mocked(fs.readFileSync).mockImplementation((p) =>
      JSON.stringify(allPackages.find((candidate) => String(p).startsWith(candidate.dir))?.packageJson ?? {}),
    );

    vi.spyOn(commitParser, 'extractChangelogEntriesFromCommits').mockResolvedValue([]);
    vi.spyOn(commitParser, 'extractRepoLevelChangelogEntries').mockResolvedValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('releasing packages', () => {
    it('should record the strategy as async, even for a single package', async () => {
      await run({}, [packageA]);

      expect(jsonOutput.setVersioningStrategy).toHaveBeenCalledWith('async');
    });

    it('should record nothing when there are no packages', async () => {
      await run({}, []);

      expect(jsonOutput.addTag).not.toHaveBeenCalled();
      expect(jsonOutput.setCommitMessage).not.toHaveBeenCalled();
      expect(logging.log).toHaveBeenCalledWith('No packages required a version update.', 'info');
    });

    it('should release every package at its own next version', async () => {
      await run();

      expect(packageManagement.updatePackageVersion).toHaveBeenCalledTimes(3);
      expect(jsonOutput.addTag).toHaveBeenCalledTimes(3);
      expect(jsonOutput.setCommitMessage).toHaveBeenCalledTimes(1);
    });

    it('should bump the package.json and record the tag of a package with a version change', async () => {
      await run({}, [packageA]);

      expect(packageManagement.updatePackageVersion).toHaveBeenCalledWith(
        '/path/to/package-a/package.json',
        '1.1.0',
        false,
      );
      expect(jsonOutput.addTag).toHaveBeenCalledWith('v1.1.0');
      expect(jsonOutput.setPackageUpdateTag).toHaveBeenCalledWith('package-a', 'v1.1.0');
      expect(changelogFor('package-a')).toMatchObject({ version: '1.1.0', tag: 'v1.1.0' });
    });

    it('should skip packages in the skip list', async () => {
      await run({ skip: ['package-a'] });

      expect(calculator.calculateVersion).toHaveBeenCalledTimes(2);
      expect(calculator.calculateVersion).not.toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ name: 'package-a' }),
      );
      expect(packageManagement.updatePackageVersion).not.toHaveBeenCalledWith(
        expect.stringContaining('package-a'),
        expect.any(String),
        expect.anything(),
      );
    });

    it('should release only the targeted packages', async () => {
      await run({}, allPackages, ['package-b']);

      expect(calculator.calculateVersion).toHaveBeenCalledTimes(1);
      expect(jsonOutput.setPackageUpdateTag).toHaveBeenCalledWith('package-b', 'v1.1.0');
      expect(jsonOutput.setPackageUpdateTag).toHaveBeenCalledTimes(1);
    });

    it('should not update anything when no version change is needed', async () => {
      vi.mocked(calculator.calculateVersion).mockResolvedValue('');

      await run();

      expect(packageManagement.updatePackageVersion).not.toHaveBeenCalled();
      expect(jsonOutput.addTag).not.toHaveBeenCalled();
      expect(jsonOutput.setCommitMessage).not.toHaveBeenCalled();
    });

    it('should not tag or log a changelog for a package with no manifest to bump', async () => {
      vi.mocked(fs.existsSync).mockImplementation((p) => String(p).startsWith('/path/to/package-a/'));

      await run({ skip: ['package-c'] });

      expect(jsonOutput.setPackageUpdateTag).toHaveBeenCalledWith('package-a', 'v1.1.0');
      expect(changelogFor('package-b')).toBeUndefined();
      expect(jsonOutput.setPackageUpdateTag).not.toHaveBeenCalledWith('package-b', expect.anything());
      // Checked before the changelog is built, so its repo-level entries don't reach sharedEntries.
      expect(commitParser.extractChangelogEntriesFromCommits).not.toHaveBeenCalledWith(
        '/path/to/package-b',
        expect.anything(),
        'conventionalcommits',
        expect.anything(),
      );
      expect(logging.log).toHaveBeenCalledWith(
        'Not releasing package-b: it has no manifest releasekit can bump',
        'warning',
      );
    });

    it('should pass the configured release type to the version calculation', async () => {
      await run({ type: 'major' }, [packageA]);

      expect(calculator.calculateVersion).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ name: 'package-a', type: 'major' }),
      );
    });

    it('should pass dryRun to the manifest update and log what it would release', async () => {
      await run({ dryRun: true }, [packageA]);

      expect(packageManagement.updatePackageVersion).toHaveBeenCalledWith(
        '/path/to/package-a/package.json',
        '1.1.0',
        true,
      );
      expect(logging.log).toHaveBeenCalledWith('[DRY RUN] Would release package-a at 1.1.0 (tag: v1.1.0)', 'info');
    });
  });

  describe('commit message', () => {
    it('should fill the template with the released version', async () => {
      await run({ skip: ['package-c'] });

      expect(jsonOutput.setCommitMessage).toHaveBeenCalledWith('chore(release): 1.1.0');
    });

    it('should use a custom template for one package', async () => {
      await run({ commitMessage: 'release: v${version} of packages' }, [packageA]);

      expect(jsonOutput.setCommitMessage).toHaveBeenCalledWith('release: v1.1.0 of packages');
    });

    it('should replace the packageName placeholder for one package', async () => {
      await run({ commitMessage: 'chore: release ${packageName}@${version} [skip-ci]' }, [packageA]);

      expect(jsonOutput.setCommitMessage).toHaveBeenCalledWith('chore: release package-a@1.1.0 [skip-ci]');
    });

    it('should use a custom template for several packages', async () => {
      await run({ commitMessage: 'release: v${version} of package' });

      expect(jsonOutput.setCommitMessage).toHaveBeenCalledWith('release: v1.1.0 of package');
    });

    it('should list the released packages and their shared version by default', async () => {
      await run({ commitMessage: undefined });

      expect(jsonOutput.setCommitMessage).toHaveBeenCalledWith('chore: release package-a, package-b, package-c v1.1.0');
    });
  });

  describe('changelog baseline', () => {
    it('should read only the repo baseline tags and strip their prefix from previousVersion', async () => {
      vi.mocked(formatting.deriveBaselineTagPrefix).mockImplementation((template) =>
        template === BASELINE_TAG_TEMPLATE ? 'release/v' : undefined,
      );
      vi.mocked(gitTags.getLatestTag).mockResolvedValue('release/v1.0.0');

      await run({ baselineTagTemplate: BASELINE_TAG_TEMPLATE }, [packageA]);

      expect(gitTags.getLatestTagForPackage).not.toHaveBeenCalled();
      expect(gitTags.getLatestTag).toHaveBeenCalledWith('release/v');
      expect(changelogFor('package-a')).toMatchObject({
        previousVersion: 'v1.0.0',
        revisionRange: 'release/v1.0.0..HEAD',
      });
      // Same baseline as the changelog, in consumer-facing display form.
      expect(jsonOutput.setPackageUpdatePreviousVersion).toHaveBeenCalledWith('package-a', 'v1.0.0');
    });

    it('should record a baseline tag when baselineTagTemplate is set', async () => {
      vi.mocked(formatting.formatTag).mockImplementation((version, prefix, _name, template) =>
        template === BASELINE_TAG_TEMPLATE ? `release/${prefix}${version}` : `${prefix}${version}`,
      );

      await run({ baselineTagTemplate: BASELINE_TAG_TEMPLATE }, [packageA]);

      expect(jsonOutput.addBaselineTag).toHaveBeenCalledWith('release/v1.1.0');
      expect(jsonOutput.addTag).toHaveBeenCalledWith('v1.1.0');
    });

    it('should warn and omit previousVersion when the baseline tag is unreachable', async () => {
      vi.mocked(gitTags.getLatestTagForPackage).mockResolvedValue('v1.0.0');
      // Resolves as a ref but can't be verified from HEAD (shallow clone / unpushed tag).
      vi.mocked(tagVerification.verifyTag).mockResolvedValue({ exists: false, reachable: false, error: 'not found' });

      await run({}, [packageA]);

      expect(logging.log).toHaveBeenCalledWith(expect.stringContaining('could not be verified from HEAD'), 'warning');
      // Omitted so the changelog doesn't claim an undiffed baseline.
      expect(changelogFor('package-a')).toMatchObject({ previousVersion: null, revisionRange: 'HEAD' });
    });

    it('should aggregate the changelog from the last stable tag when a prerelease graduates', async () => {
      // The prerelease tag's range would hold only the release-prep commit.
      vi.mocked(gitTags.getLatestTagForPackage).mockResolvedValue('package-a@v1.1.0-next.0');
      vi.mocked(gitTags.getLatestStableTagForPackage).mockResolvedValue('package-a@v1.0.0');

      await run({ packageSpecificTags: true }, [packageA]);

      expect(gitTags.getLatestStableTagForPackage).toHaveBeenCalled();
      expect(changelogFor('package-a')).toMatchObject({ previousVersion: 'package-a@v1.0.0' });
    });

    it('should not use the stable base when releasing a prerelease', async () => {
      vi.mocked(gitTags.getLatestTagForPackage).mockResolvedValue('package-a@v1.1.0-next.0');
      vi.mocked(gitTags.getLatestStableTagForPackage).mockResolvedValue('package-a@v1.0.0');
      vi.mocked(calculator.calculateVersion).mockResolvedValue('1.1.0-next.1');

      await run({ packageSpecificTags: true }, [packageA]);

      expect(gitTags.getLatestStableTagForPackage).not.toHaveBeenCalled();
      expect(changelogFor('package-a')).toMatchObject({ previousVersion: 'package-a@v1.1.0-next.0' });
    });

    it('should graduate against the repo stable tag when packageSpecificTags is off', async () => {
      vi.mocked(formatting.deriveBaselineTagPrefix).mockImplementation((template, prefix) =>
        template === TAG_TEMPLATE ? prefix : undefined,
      );
      vi.mocked(gitTags.getLatestTag).mockResolvedValue('v1.1.0-next.0');
      vi.mocked(gitTags.getLatestStableTag).mockResolvedValue('v1.0.0');

      await run({ packageSpecificTags: false }, [packageB]);

      expect(gitTags.getLatestStableTag).toHaveBeenCalledWith('v');
      expect(gitTags.getLatestStableTagForPackage).not.toHaveBeenCalled();
      expect(changelogFor('package-b')).toMatchObject({ previousVersion: 'v1.0.0' });
    });

    it('should graduate against the repo stable tag when packageSpecificTags is on but the package has no tags', async () => {
      // The stable base must follow latestTag to the repo's tags: the empty package series would include every commit.
      vi.mocked(gitTags.getLatestTag).mockResolvedValue('v1.1.0-next.0');
      vi.mocked(gitTags.getLatestStableTag).mockResolvedValue('v1.0.0');

      await run({ packageSpecificTags: true }, [packageB]);

      expect(gitTags.getLatestStableTag).toHaveBeenCalled();
      expect(gitTags.getLatestStableTagForPackage).not.toHaveBeenCalled();
      expect(changelogFor('package-b')).toMatchObject({ previousVersion: 'v1.0.0' });
    });

    it('should warn about full git history when a package has no prior tag and no reachable baseline', async () => {
      vi.mocked(gitTags.getLatestTag).mockResolvedValue('');

      await run({ packageSpecificTags: true }, [packageB]);

      expect(logging.log).toHaveBeenCalledWith(
        expect.stringContaining('No prior tag found for package-b — its changelog will include the full git history'),
        'warning',
      );
    });

    it('should warn about the nearest reachable tag when a package has no prior tag but another tag is reachable', async () => {
      vi.mocked(gitTags.getLatestTag).mockResolvedValue('');
      vi.mocked(gitTags.getNearestReachableTag).mockResolvedValue('pkg-b@v1.0.0');

      await run({ packageSpecificTags: true }, [packageB]);

      expect(logging.log).toHaveBeenCalledWith(
        expect.stringContaining('No prior tag found for package-b — its changelog will start from pkg-b@v1.0.0'),
        'warning',
      );
      expect(logging.log).not.toHaveBeenCalledWith(expect.stringContaining('full git history'), 'warning');
    });

    it('should not warn about a missing tag for a package that has one', async () => {
      vi.mocked(gitTags.getLatestTagForPackage).mockResolvedValue('package-a@v1.0.0');

      await run({}, [packageA]);

      expect(logging.log).not.toHaveBeenCalledWith(expect.stringContaining('No prior tag found'), 'warning');
    });
  });

  describe('project-wide entries', () => {
    it('should bound repo-level entries by the nearest reachable tag when the package has no tag', async () => {
      // git describe sees per-package prefixed tags, so an untagged package doesn't collapse to full history.
      vi.mocked(gitTags.getLatestTag).mockResolvedValue('');
      vi.mocked(gitTags.getNearestReachableTag).mockResolvedValue('wdio-dioxus-bridge@v1.0.0-next.2');

      await run({ packageSpecificTags: true }, [packageA]);

      expect(commitParser.extractRepoLevelChangelogEntries).toHaveBeenCalledWith(
        expect.any(String),
        'wdio-dioxus-bridge@v1.0.0-next.2..HEAD',
        'conventionalcommits',
        expect.any(Array),
        expect.any(Array),
      );
    });

    it('should fall back to HEAD range for shared entries when no tag is reachable', async () => {
      vi.mocked(gitTags.getLatestTag).mockResolvedValue('');

      await run({ packageSpecificTags: true }, [packageA]);

      expect(commitParser.extractRepoLevelChangelogEntries).toHaveBeenCalledWith(
        expect.any(String),
        'HEAD',
        'conventionalcommits',
        expect.any(Array),
        expect.any(Array),
      );
    });

    it('should classify against the full workspace, not the release set, so a non-releasing package does not leak into shared', async () => {
      // package-b's dir must still count as a package dir, so a commit touching only package-b is attributed to it
      // (absent here), not dumped into shared.
      await run(
        {
          allWorkspacePackages: [
            { name: 'package-a', dir: '/path/to/package-a' },
            { name: 'package-b', dir: '/path/to/package-b' },
          ],
        },
        [packageA],
      );

      expect(commitParser.extractRepoLevelChangelogEntries).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        'conventionalcommits',
        ['/path/to/package-a', '/path/to/package-b'],
        [],
      );
    });

    it('should leave a configured sharedPackages package out of the package dirs, so its commits are repo-level', async () => {
      await run(
        {
          sharedPackages: ['package-b'],
          allWorkspacePackages: [
            { name: 'package-a', dir: '/path/to/package-a' },
            { name: 'package-b', dir: '/path/to/package-b' },
          ],
        },
        [packageA],
      );

      expect(commitParser.extractRepoLevelChangelogEntries).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        'conventionalcommits',
        ['/path/to/package-a'],
        ['/path/to/package-b'],
      );
    });

    it('should treat no package as shared when sharedPackages is unset — no hardcoded names', async () => {
      await run(
        {
          allWorkspacePackages: [
            { name: '@releasekit/core', dir: '/path/to/core' },
            { name: 'package-a', dir: '/path/to/package-a' },
          ],
        },
        [packageA],
      );

      expect(commitParser.extractRepoLevelChangelogEntries).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        'conventionalcommits',
        ['/path/to/core', '/path/to/package-a'],
        [],
      );
    });

    it('should emit repo-level entries as sharedEntries, not in individual package changelogs', async () => {
      const repoLevelEntry = { type: 'chore', description: 'Update CI workflow' };
      const pkgAEntry = { type: 'added', description: 'New feature in pkg-a' };
      vi.mocked(commitParser.extractChangelogEntriesFromCommits).mockImplementation(async (dir) =>
        dir.includes('package-a') ? [pkgAEntry] : [],
      );
      vi.mocked(commitParser.extractRepoLevelChangelogEntries).mockResolvedValue([repoLevelEntry]);

      await run();

      expect(jsonOutput.setSharedEntries).toHaveBeenCalledWith([repoLevelEntry]);
      for (const [data] of vi.mocked(jsonOutput.addChangelogData).mock.calls) {
        expect(data.entries).not.toContainEqual(repoLevelEntry);
      }
    });

    it('should keep a breaking repo-level entry apart from a non-breaking one with the same subject', async () => {
      const plain = { type: 'fixed', description: 'Reject the old preset' };
      const breaking = { ...plain, breaking: true };
      vi.mocked(commitParser.extractRepoLevelChangelogEntries).mockResolvedValue([plain, breaking]);

      await run();

      expect(jsonOutput.setSharedEntries).toHaveBeenCalledWith([plain, breaking]);
    });
  });

  describe('native manifests', () => {
    const hybridPackage = pkg('hybrid-package', '0.1.0');

    it('should update both package.json and Cargo.toml for hybrid packages', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);

      await run({}, [hybridPackage]);

      expect(packageManagement.updatePackageVersion).toHaveBeenCalledWith(
        '/path/to/hybrid-package/package.json',
        '1.1.0',
        false,
      );
      expect(packageManagement.updatePackageVersion).toHaveBeenCalledWith(
        '/path/to/hybrid-package/Cargo.toml',
        '1.1.0',
        false,
        { recordAs: 'hybrid-package' },
      );
    });

    it('should skip package.json but still update Cargo.toml when version.npm.enabled is false', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);

      await run({ npm: { enabled: false } }, [hybridPackage]);

      expect(packageManagement.updatePackageVersion).not.toHaveBeenCalledWith(
        '/path/to/hybrid-package/package.json',
        expect.anything(),
        expect.anything(),
      );
      expect(packageManagement.updatePackageVersion).toHaveBeenCalledWith(
        '/path/to/hybrid-package/Cargo.toml',
        '1.1.0',
        false,
        { recordAs: 'hybrid-package' },
      );
    });

    it('should release a Cargo-only package through its Cargo.toml', async () => {
      const rustPackage = pkg('rust-package');
      vi.mocked(fs.existsSync).mockImplementation((p) => String(p).endsWith('Cargo.toml'));

      await run({ cargo: { enabled: true } }, [rustPackage]);

      expect(packageManagement.updatePackageVersion).toHaveBeenCalledTimes(1);
      expect(packageManagement.updatePackageVersion).toHaveBeenCalledWith(
        '/path/to/rust-package/Cargo.toml',
        '1.1.0',
        false,
        { recordAs: 'rust-package' },
      );
      expect(jsonOutput.setPackageUpdateTag).toHaveBeenCalledWith('rust-package', 'v1.1.0');
    });
  });

  describe('tag lookup', () => {
    it("should use the package's own tag when it has one", async () => {
      vi.mocked(gitTags.getLatestTagForPackage).mockResolvedValue('package-a@v1.0.0');

      await run({}, [packageA]);

      expect(gitTags.getLatestTagForPackage).toHaveBeenCalledWith('package-a', 'v', {
        tagTemplate: TAG_TEMPLATE,
        packageSpecificTags: undefined,
      });
      expect(gitTags.getLatestTag).not.toHaveBeenCalled();
      expect(calculator.calculateVersion).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ latestTag: 'package-a@v1.0.0' }),
      );
    });

    it("should fall back to the repo's latest tag with the tag template's prefix", async () => {
      vi.mocked(formatting.deriveBaselineTagPrefix).mockImplementation((template, prefix) =>
        template === TAG_TEMPLATE ? prefix : undefined,
      );
      vi.mocked(gitTags.getLatestTag).mockResolvedValue('v0.9.0');

      await run({}, [packageA]);

      expect(gitTags.getLatestTag).toHaveBeenCalledWith('v');
      expect(calculator.calculateVersion).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ latestTag: 'v0.9.0' }),
      );
      expect(changelogFor('package-a')).toMatchObject({ previousVersion: 'v0.9.0', revisionRange: 'v0.9.0..HEAD' });
    });

    it("should fall back to the repo's latest tag of any prefix with packageSpecificTags", async () => {
      vi.mocked(formatting.deriveBaselineTagPrefix).mockImplementation((template, prefix) =>
        template === TAG_TEMPLATE ? prefix : undefined,
      );

      await run({ packageSpecificTags: true }, [packageA]);

      expect(gitTags.getLatestTag).toHaveBeenCalledWith(undefined);
    });

    it('should version from the record as a first release when there is no tag at all', async () => {
      vi.mocked(gitTags.getLatestTag).mockResolvedValue('');

      await run({}, [packageA]);

      expect(calculator.calculateVersion).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ latestTag: '', current: { version: '1.0.0', recorded: true } }),
      );
      expect(jsonOutput.setPackageUpdateAction).toHaveBeenCalledWith('package-a', 'first-release', expect.any(String));
      expect(jsonOutput.addTag).toHaveBeenCalledWith('v1.1.0');
    });
  });

  describe('custom tag formats', () => {
    it('should use the tagTemplate for tag creation', async () => {
      vi.mocked(formatting.formatTag).mockReturnValue('release/v1.1.0');

      await run({ tagTemplate: 'release/${prefix}${version}' }, [packageA]);

      expect(formatting.formatTag).toHaveBeenCalledWith(
        '1.1.0',
        'v',
        'package-a',
        'release/${prefix}${version}',
        undefined,
      );
      expect(jsonOutput.addTag).toHaveBeenCalledWith('release/v1.1.0');
    });

    it('should use the tagTemplate for package-specific tags', async () => {
      vi.mocked(formatting.formatTag).mockImplementation(
        (version, _prefix, packageName) => `${packageName}/v${version}`,
      );

      await run({ tagTemplate: '${packageName}/v${version}', packageSpecificTags: true }, [packageA]);

      expect(jsonOutput.addTag).toHaveBeenCalledWith('package-a/v1.1.0');
    });

    it('should use the formatted versionPrefix in tags and lookups', async () => {
      vi.mocked(formatting.formatVersionPrefix).mockReturnValue('ver');

      await run({ versionPrefix: 'ver/' }, [packageA]);

      expect(gitTags.getLatestTagForPackage).toHaveBeenCalledWith('package-a', 'ver', expect.anything());
      expect(jsonOutput.addTag).toHaveBeenCalledWith('ver1.1.0');
    });
  });

  // Both tests share strictReachable:true so the only variable is the error type.
  describe('strictReachable (#372)', () => {
    beforeEach(() => {
      // A real tag so the resolver verifies the baseline.
      vi.mocked(gitTags.getLatestTagForPackage).mockResolvedValue('v1.0.0');
    });

    it('should abort the run with a StrictReachableError when the baseline is unreachable', async () => {
      vi.mocked(tagVerification.verifyTag).mockResolvedValue({
        exists: true,
        reachable: false,
        error: 'exists but is not an ancestor of HEAD',
      });

      await expect(run({ strictReachable: true })).rejects.toBeInstanceOf(StrictReachableError);
    });

    it('should still degrade a genuine changelog-extraction error to a minimal entry', async () => {
      vi.mocked(commitParser.extractChangelogEntriesFromCommits).mockRejectedValue(new Error('git log failed'));

      await expect(run({ strictReachable: true })).resolves.toBeUndefined();
      expect(logging.log).toHaveBeenCalledWith(
        expect.stringContaining('Error extracting changelog entries'),
        'warning',
      );
      expect(changelogFor('package-a')).toMatchObject({
        entries: [{ type: 'changed', description: 'Update version to 1.1.0' }],
      });
    });
  });
});
