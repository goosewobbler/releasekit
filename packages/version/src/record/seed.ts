import type { Package } from '@manypkg/get-packages';
import { shouldProcessPackage } from '@releasekit/core';
import { createGitCli } from '@releasekit/git';
import semver from 'semver';
import {
  getLatestStableTag,
  getLatestStableTagForPackage,
  getLatestTag,
  getLatestTagForPackage,
} from '../git/tagsAndBranches.js';
import type { Config } from '../types.js';
import { deriveBaselineTagPrefix, formatVersionPrefix } from '../utils/formatting.js';
import { getVersionFromManifests } from '../utils/manifestHelpers.js';
import { hasManifestToBump } from '../utils/manifestUpdates.js';
import { versionFromTag } from '../utils/versionAction.js';
import { getBestVersionSource, VersionMismatchError } from '../utils/versionUtils.js';
import { type VersionRecordEntries, type VersionRecordEntry, versionRecordKey } from './versionRecord.js';

/** The tag a version run resolves as a package's last release, and where its last stable tag is looked up. */
interface ReleaseLookup {
  tag: string;
  packageTag: boolean;
  globalPrefix?: string;
  sourceName?: string;
  sourceDir: string;
}

type Seed = { entry: Omit<VersionRecordEntry, 'name'> } | { reason: string };

async function tagCommit(tag: string, cwd: string): Promise<string> {
  return (await createGitCli().log({ range: `refs/tags/${tag}`, format: '%H', extraArgs: ['-1'], cwd })).trim();
}

type SeedMode = 'sync' | 'group' | 'single' | 'async';

function seedMode(config: Config, packageCount: number): SeedMode {
  if (config.sync) {
    return 'sync';
  }
  if (Object.keys(config.groups ?? {}).length > 0) {
    return 'group';
  }
  return packageCount === 1 ? 'single' : 'async';
}

/** The prefix of the repo-wide tags a lookup falls back to, or none when tags are per package. */
function repoTagPrefix(config: Config, formattedPrefix: string, name?: string): string | undefined {
  if (config.packageSpecificTags) {
    return undefined;
  }
  return deriveBaselineTagPrefix(config.tagTemplate, formattedPrefix, name);
}

/** Mirrors the sync strategy's lookup: one tag for the whole release, read through its version-source package. */
async function syncLookup(config: Config, packages: Package[], root: string): Promise<ReleaseLookup> {
  const formattedPrefix = formatVersionPrefix(config.versionPrefix);
  const globalPrefix =
    deriveBaselineTagPrefix(config.baselineTagTemplate, formattedPrefix, config.mainPackage) ??
    repoTagPrefix(config, formattedPrefix);
  const source = config.mainPackage ? packages.find((p) => p.packageJson.name === config.mainPackage) : packages[0];
  const sourceName = source?.packageJson.name;
  const lookup = { globalPrefix, sourceName, sourceDir: source?.dir ?? root };
  if (sourceName && !config.baselineTagTemplate) {
    const tag = await getLatestTagForPackage(sourceName, formattedPrefix, {
      tagTemplate: config.tagTemplate,
      packageSpecificTags: config.packageSpecificTags,
    });
    if (tag) {
      return { ...lookup, tag, packageTag: true };
    }
  }
  return { ...lookup, tag: await getLatestTag(globalPrefix), packageTag: false };
}

/**
 * Mirrors the group, single and async strategies' lookups. A group with `baselineTagTemplate` reads only the baseline
 * tags, and an async package without its own tag falls back to its manifest, so it has no tag to seed from.
 */
async function packageLookup(config: Config, pkg: Package, mode: Exclude<SeedMode, 'sync'>): Promise<ReleaseLookup> {
  const formattedPrefix = formatVersionPrefix(config.versionPrefix);
  const name = pkg.packageJson.name;
  const lookup = { sourceName: name, sourceDir: pkg.dir };
  if (!(mode === 'group' && config.baselineTagTemplate)) {
    const tag = await getLatestTagForPackage(name, formattedPrefix, {
      tagTemplate: config.tagTemplate,
      packageSpecificTags: config.packageSpecificTags,
    });
    if (tag || mode === 'async') {
      return { ...lookup, tag, packageTag: true };
    }
  }
  const globalPrefix =
    mode === 'group'
      ? (deriveBaselineTagPrefix(config.baselineTagTemplate, formattedPrefix) ?? repoTagPrefix(config, formattedPrefix))
      : repoTagPrefix(config, formattedPrefix, name);
  return { ...lookup, globalPrefix, tag: await getLatestTag(globalPrefix), packageTag: false };
}

async function seedFrom(lookup: ReleaseLookup, config: Config, root: string): Promise<Seed> {
  if (!lookup.tag) {
    return { reason: 'no release tag of its own is reachable from HEAD' };
  }
  let version: string | null;
  try {
    const manifestVersion = getVersionFromManifests(lookup.sourceDir, config).version ?? undefined;
    const source = await getBestVersionSource(lookup.tag, manifestVersion, lookup.sourceDir, config.mismatchStrategy);
    version = source.source === 'git' ? versionFromTag(lookup.tag) : source.version;
  } catch (error) {
    // Under `mismatchStrategy: 'error'` a mismatch fails the run, as the lookup did before the record.
    if (error instanceof VersionMismatchError) {
      throw error;
    }
    return { reason: error instanceof Error ? error.message : String(error) };
  }
  if (!version) {
    return { reason: `no version can be read from ${lookup.tag}` };
  }

  const entry: Omit<VersionRecordEntry, 'name'> = { version, at: await tagCommit(lookup.tag, root) };
  if (semver.prerelease(version)) {
    const stableTag =
      lookup.packageTag && lookup.sourceName
        ? await getLatestStableTagForPackage(lookup.sourceName, formatVersionPrefix(config.versionPrefix), {
            tagTemplate: config.tagTemplate,
            packageSpecificTags: config.packageSpecificTags,
          })
        : await getLatestStableTag(lookup.globalPrefix);
    const stableVersion = stableTag ? versionFromTag(stableTag) : null;
    if (stableVersion) {
      entry.lastStable = { version: stableVersion, at: await tagCommit(stableTag, root) };
    }
  }
  return { entry };
}

/**
 * Gives each package without an entry its last release, found with the tag lookup a version run uses today. A package
 * with no reachable tag gets no entry and starts from its manifest.
 */
export async function seedMissingEntries(
  record: VersionRecordEntries,
  packages: Package[],
  config: Config,
  root: string,
): Promise<{ record: VersionRecordEntries; unseeded: Array<{ name: string; reason: string }> }> {
  const mode = seedMode(config, packages.length);
  // Group mode bumps only a package's own manifests, so cargo.paths and pub.paths don't make it versionable.
  const missing = packages.filter(
    (pkg) =>
      !record[versionRecordKey(root, pkg.dir)] &&
      shouldProcessPackage(pkg.packageJson.name, config.skip) &&
      hasManifestToBump(pkg.dir, config, { repoRoot: root, ignorePaths: mode === 'group' }),
  );

  const seeded: VersionRecordEntries = { ...record };
  const unseeded: Array<{ name: string; reason: string }> = [];
  let syncSeed: Seed | undefined;
  for (const pkg of missing) {
    const name = pkg.packageJson.name;
    let seed: Seed;
    if (mode === 'sync') {
      syncSeed ??= await seedFrom(await syncLookup(config, packages, root), config, root);
      seed = syncSeed;
    } else {
      seed = await seedFrom(await packageLookup(config, pkg, mode), config, root);
    }
    if ('reason' in seed) {
      unseeded.push({ name, reason: seed.reason });
    } else {
      seeded[versionRecordKey(root, pkg.dir)] = { name, ...seed.entry };
    }
  }
  return { record: seeded, unseeded };
}
