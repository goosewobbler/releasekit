import fs from 'node:fs';
import type { Package } from '@manypkg/get-packages';
import { shouldProcessPackage } from '@releasekit/core';
import { createGitCli } from '@releasekit/git';
import semver from 'semver';
import { loadConfig } from '../config.js';
import { VersionEngine } from '../core/versionEngine.js';
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
import { getBestVersionSource } from '../utils/versionUtils.js';
import {
  readVersionRecord,
  serializeVersionRecord,
  type VersionRecordEntry,
  versionRecordKey,
  versionRecordPath,
} from './versionRecord.js';

export interface MigrationResult {
  file: string;
  written: boolean;
  seeded: Array<{ path: string; name: string; version: string; tag: string }>;
  kept: Array<{ path: string; name: string }>;
  /** Packages to seed by hand if they've been released. */
  unseeded: Array<{ path: string; name: string; reason: string }>;
}

/** The tag a version run resolves as a package's last release, and where its last stable tag is looked up. */
interface ReleaseLookup {
  tag: string;
  packageTag: boolean;
  globalPrefix?: string;
  sourceName?: string;
  sourceDir: string;
}

type Seed = { entry: Omit<VersionRecordEntry, 'name'>; tag: string } | { reason: string };

async function tagCommit(tag: string, cwd: string): Promise<string> {
  return (await createGitCli().log({ range: `refs/tags/${tag}`, format: '%H', extraArgs: ['-1'], cwd })).trim();
}

/** Mirrors the sync strategy's lookup: one tag for the whole release, read through its version-source package. */
async function syncLookup(config: Config, packages: Package[], root: string): Promise<ReleaseLookup> {
  const formattedPrefix = formatVersionPrefix(config.versionPrefix);
  const globalPrefix =
    deriveBaselineTagPrefix(config.baselineTagTemplate, formattedPrefix, config.mainPackage) ??
    (config.packageSpecificTags ? undefined : deriveBaselineTagPrefix(config.tagTemplate, formattedPrefix));
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
async function packageLookup(config: Config, pkg: Package, mode: 'group' | 'single' | 'async'): Promise<ReleaseLookup> {
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
      ? (deriveBaselineTagPrefix(config.baselineTagTemplate, formattedPrefix) ??
        (config.packageSpecificTags ? undefined : deriveBaselineTagPrefix(config.tagTemplate, formattedPrefix)))
      : config.packageSpecificTags
        ? undefined
        : deriveBaselineTagPrefix(config.tagTemplate, formattedPrefix, name);
  return { ...lookup, globalPrefix, tag: await getLatestTag(globalPrefix), packageTag: false };
}

async function seedFrom(lookup: ReleaseLookup, config: Config, root: string): Promise<Seed> {
  if (!lookup.tag) {
    return { reason: 'no release tag is reachable from HEAD' };
  }
  let version: string | null;
  try {
    const manifestVersion = getVersionFromManifests(lookup.sourceDir).version ?? undefined;
    const source = await getBestVersionSource(lookup.tag, manifestVersion, lookup.sourceDir, config.mismatchStrategy);
    version = source.source === 'git' ? versionFromTag(lookup.tag) : source.version;
  } catch (error) {
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
  return { entry, tag: lookup.tag };
}

/**
 * Seeds `releasekit.versions.json` with each package's last release as a version run resolves it today, keeping any
 * entry the record already has. Writes the file only when it seeds something.
 */
/** Seeds the record of the project in the working directory, where the tag lookups run. */
export async function migrateVersionRecord(options: { configPath?: string } = {}): Promise<MigrationResult> {
  const config = loadConfig({ configPath: options.configPath });
  const workspace = await new VersionEngine(config, { dryRun: true }).getWorkspacePackages();
  const root = workspace.root;
  const packages = workspace.packages.filter(
    (pkg) =>
      shouldProcessPackage(pkg.packageJson.name, config.skip) && hasManifestToBump(pkg.dir, config, { repoRoot: root }),
  );
  const mode = config.sync
    ? 'sync'
    : Object.keys(config.groups ?? {}).length > 0
      ? 'group'
      : workspace.packages.length === 1
        ? 'single'
        : 'async';

  const record = readVersionRecord(root);
  const result: MigrationResult = { file: versionRecordPath(root), written: false, seeded: [], kept: [], unseeded: [] };
  let syncSeed: Seed | undefined;
  for (const pkg of packages) {
    const name = pkg.packageJson.name;
    const path = versionRecordKey(root, pkg.dir);
    if (record[path]) {
      result.kept.push({ path, name });
      continue;
    }
    let seed: Seed;
    if (mode === 'sync') {
      syncSeed ??= await seedFrom(await syncLookup(config, workspace.packages, root), config, root);
      seed = syncSeed;
    } else {
      seed = await seedFrom(await packageLookup(config, pkg, mode), config, root);
    }
    if ('reason' in seed) {
      result.unseeded.push({ path, name, reason: seed.reason });
      continue;
    }
    record[path] = { name, ...seed.entry };
    result.seeded.push({ path, name, version: seed.entry.version, tag: seed.tag });
  }

  // Written even when empty: releases only update a record that exists, so a repo with nothing to seed yet starts here.
  if (result.seeded.length > 0 || !fs.existsSync(result.file)) {
    fs.writeFileSync(result.file, serializeVersionRecord(record));
    result.written = true;
  }
  return result;
}
