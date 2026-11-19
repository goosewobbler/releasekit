import type { Package } from '@manypkg/get-packages';
import { buildDependencyGraph } from '@releasekit/core';
import type { Git } from '@releasekit/git';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as commitParser from '../../../src/changelog/commitParser.js';
import { recordBundledReleases } from '../../../src/core/bundling.js';
import * as tags from '../../../src/git/tagsAndBranches.js';
import type { Config } from '../../../src/types.js';
import {
  addChangelogData,
  enableJsonOutput,
  getJsonData,
  setVersioningStrategy,
} from '../../../src/utils/jsonOutput.js';

vi.mock('../../../src/git/tagsAndBranches.js');
vi.mock('../../../src/changelog/commitParser.js');
vi.mock('../../../src/core/workspaceGraph.js', () => ({
  buildWorkspaceGraph: (packages: Package[]) =>
    buildDependencyGraph(
      packages.map((p) => ({
        name: p.packageJson.name,
        dir: p.dir,
        ecosystem: 'npm',
        deps: Object.keys((p.packageJson as { dependencies?: Record<string, string> }).dependencies ?? {}),
      })),
    ),
}));

function pkg(name: string, deps: string[] = []): Package {
  return {
    dir: `/ws/${name}`,
    relativeDir: name,
    packageJson: { name, version: '1.0.0', dependencies: Object.fromEntries(deps.map((d) => [d, '*'])) },
  } as unknown as Package;
}

const config = {
  versionPrefix: 'v',
  tagTemplate: '${packageName}/v${version}',
  packageSpecificTags: true,
  preset: 'angular',
  primaryPackages: ['app', 'cli'],
} as unknown as Config;

const packages = [pkg('app', ['lib']), pkg('cli', ['lib', 'app']), pkg('lib')];

/** Each package's tags, and the ones reachable from a given tag. */
const allTags: Record<string, string[]> = {
  app: ['app/v1.1.0', 'app/v1.0.0'],
  cli: ['cli/v1.0.0'],
  lib: ['lib/v1.0.2', 'lib/v1.0.1', 'lib/v1.0.0'],
  newdep: ['newdep/v1.0.0'],
  svc: ['svc/v2.0.0-next.1', 'svc/v1.0.0'],
};
const reachableFrom: Record<string, string[]> = {
  'app/v1.1.0': ['lib/v1.0.1', 'lib/v1.0.0'],
  'cli/v1.0.0': ['lib/v1.0.0'],
  'lib/v1.0.1': ['lib/v1.0.1', 'lib/v1.0.0'],
  'svc/v1.0.0': ['lib/v1.0.0'],
};

function changelog(name: string, previousTag: string, version: string) {
  addChangelogData({
    packageName: name,
    version,
    previousVersion: previousTag,
    revisionRange: `${previousTag}..HEAD`,
    repoUrl: null,
    entries: [{ type: 'fix', description: `fix ${name}` }],
  });
}

describe('recordBundledReleases', () => {
  beforeEach(() => {
    enableJsonOutput(true);
    setVersioningStrategy('async');
    vi.mocked(tags.listPackageTags).mockImplementation(async (name, _prefix, _options, _git, merged) =>
      merged && merged !== 'HEAD' ? (reachableFrom[merged] ?? []) : (allTags[name] ?? []),
    );
    vi.mocked(commitParser.extractChangelogEntriesFromCommits).mockImplementation(async (_dir, range) => [
      { type: 'fix', description: `commits in ${range}` },
    ]);
  });

  it("should give each primary its dependencies' releases since its own previous release, storing each once", async () => {
    changelog('app', 'app/v1.1.0', '1.2.0');
    changelog('cli', 'cli/v1.0.0', '1.0.1');

    await recordBundledReleases(getJsonData(), packages, config, '/ws');

    const output = getJsonData();
    expect(Object.fromEntries(output.changelogs.map((c) => [c.packageName, c.bundled]))).toEqual({
      app: [{ packageName: 'lib', versions: ['1.0.2'] }],
      cli: [{ packageName: 'lib', versions: ['1.0.1', '1.0.2'] }],
    });
    expect(
      Object.fromEntries(
        (output.bundledReleases ?? []).map((r) => [`${r.packageName}@${r.version}`, r.entries[0]?.description]),
      ),
    ).toEqual({
      'lib@1.0.1': 'commits in lib/v1.0.0..lib/v1.0.1',
      'lib@1.0.2': 'commits in lib/v1.0.1..lib/v1.0.2',
    });
  });

  it('should bundle nothing in a sync release', async () => {
    setVersioningStrategy('sync');
    changelog('app', 'app/v1.1.0', '1.2.0');

    await recordBundledReleases(getJsonData(), packages, config, '/ws');

    expect(getJsonData().changelogs[0]?.bundled).toBeUndefined();
    expect(getJsonData().bundledReleases).toBeUndefined();
  });

  it('should leave out a shared package, whose changes are project-wide', async () => {
    changelog('app', 'app/v1.1.0', '1.2.0');

    await recordBundledReleases(getJsonData(), packages, { ...config, sharedPackages: ['lib'] }, '/ws');

    expect(getJsonData().changelogs[0]?.bundled).toBeUndefined();
  });

  it('should bundle a shared package in a grouped release, which records no project-wide entries', async () => {
    setVersioningStrategy('group');
    changelog('app', 'app/v1.1.0', '1.2.0');

    await recordBundledReleases(getJsonData(), packages, { ...config, sharedPackages: ['lib'] }, '/ws');

    expect(getJsonData().changelogs[0]?.bundled).toEqual([{ packageName: 'lib', versions: ['1.0.2'] }]);
  });

  it("should leave out a release that the package's own release in this run already covers", async () => {
    changelog('app', 'app/v1.1.0', '1.2.0');
    changelog('lib', 'lib/v1.0.1', '1.1.0');

    await recordBundledReleases(getJsonData(), packages, config, '/ws');

    expect(getJsonData().changelogs[0]?.bundled).toEqual([{ packageName: 'lib', versions: ['1.1.0'] }]);
  });

  it("should start a dependency's first release at the nearest earlier tag", async () => {
    changelog('app', 'app/v1.1.0', '1.2.0');
    const git = { listTags: vi.fn().mockResolvedValue(['app/v1.1.0']) } as unknown as Git;

    await recordBundledReleases(getJsonData(), [pkg('app', ['newdep']), pkg('newdep')], config, '/ws', git);

    expect(getJsonData().bundledReleases).toEqual([
      {
        packageName: 'newdep',
        version: '1.0.0',
        entries: [{ type: 'fix', description: 'commits in app/v1.1.0..newdep/v1.0.0' }],
      },
    ]);
  });

  it("should reach back to a graduating primary's last stable release", async () => {
    changelog('svc', 'svc/v1.0.0', '2.0.0');

    await recordBundledReleases(
      getJsonData(),
      [pkg('svc', ['lib']), pkg('lib')],
      { ...config, primaryPackages: ['svc'] },
      '/ws',
    );

    expect(getJsonData().changelogs[0]?.bundled).toEqual([{ packageName: 'lib', versions: ['1.0.1', '1.0.2'] }]);
  });
});
