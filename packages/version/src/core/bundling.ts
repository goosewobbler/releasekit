import type { Package } from '@manypkg/get-packages';
import {
  shouldMatchPackageTargets,
  type VersionBundledPackage,
  type VersionBundledRelease,
  type VersionChangelogEntry,
  type VersionOutput,
  type WorkspaceDependencyGraph,
} from '@releasekit/core';
import { createGitCli, type Git } from '@releasekit/git';
import semver from 'semver';
import { extractChangelogEntriesFromCommits } from '../changelog/commitParser.js';
import { listPackageTags } from '../git/tagsAndBranches.js';
import type { Config } from '../types.js';
import { resolveCommitScope } from '../utils/commitScope.js';
import { formatVersionPrefix } from '../utils/formatting.js';
import { setBundled } from '../utils/jsonOutput.js';
import { versionFromTag } from '../utils/versionAction.js';
import { resolveGroups } from './groupResolution.js';
import { buildWorkspaceGraph } from './workspaceGraph.js';

function isPlaceholder(entry: VersionChangelogEntry, version: string): boolean {
  return entry.synthetic === true || entry.description === `Update version to ${version}`;
}

/** Group-mates, then internal dependencies transitively, without following into another primary. */
function bundledPackageNames(
  primary: string,
  graph: WorkspaceDependencyGraph,
  groupMates: string[],
  isPrimary: (name: string) => boolean,
): string[] {
  const names = new Set(groupMates.filter((name) => name !== primary && !isPrimary(name)));
  const seen = new Set([primary]);
  const visit = (name: string) => {
    for (const dep of graph.getInternalDependencies(name)) {
      if (seen.has(dep) || isPrimary(dep)) {
        continue;
      }
      seen.add(dep);
      names.add(dep);
      visit(dep);
    }
  };
  visit(primary);
  return [...names];
}

/**
 * Records on each releasing primary the group-mates and dependencies released since its previous release, and stores
 * their earlier releases once. Per-package tags only: sync releases and first releases bundle nothing.
 */
export async function recordBundledReleases(
  output: VersionOutput,
  packages: Package[],
  config: Config,
  repoRoot: string,
  git: Git = createGitCli(),
): Promise<void> {
  const primaryPatterns = config.primaryPackages ?? [];
  // A PR preview's `baseRef` run isn't a release.
  if (primaryPatterns.length === 0 || !config.packageSpecificTags || config.baseRef) {
    return;
  }
  if (output.strategy !== 'async' && output.strategy !== 'group') {
    return;
  }

  const isPrimary = (name: string) => shouldMatchPackageTargets(name, primaryPatterns);
  // Shared packages' changes already reach every package's notes as project-wide entries, which only async releases
  // record.
  const isShared = (name: string) =>
    output.strategy === 'async' && shouldMatchPackageTargets(name, config.sharedPackages ?? []);
  const graph = buildWorkspaceGraph(packages);
  // Every discovered package, so a group-mate held back from this run still has its earlier releases bundled.
  const groups = resolveGroups(config, packages);
  const prefix = formatVersionPrefix(config.versionPrefix);
  const byName = new Map(packages.map((p) => [p.packageJson.name, p]));
  const thisRun = new Map(output.changelogs.map((c) => [c.packageName, c]));
  const tagOptions = { tagTemplate: config.tagTemplate, packageSpecificTags: config.packageSpecificTags };
  const releases = new Map<string, VersionBundledRelease>();
  const bundledByPrimary = new Map<string, VersionBundledPackage[]>();

  /** Oldest first. */
  const tagsReachableFrom = async (name: string, ref: string) =>
    (await listPackageTags(name, prefix, tagOptions, git, ref))
      .map((tag) => ({ tag, version: versionFromTag(tag) }))
      .filter((t): t is { tag: string; version: string } => t.version !== null)
      .sort((a, b) => semver.compare(a.version, b.version));

  const releasesSince = async (name: string, primaryTag: string): Promise<string[]> => {
    const pkg = byName.get(name);
    if (!pkg) {
      return [];
    }
    const reachable = await tagsReachableFrom(name, 'HEAD');
    const before = new Set((await tagsReachableFrom(name, primaryTag)).map((t) => t.tag));
    // A release in this run covers its range: a graduation's earlier prereleases are already in it.
    const ownStart = thisRun.get(name)?.revisionRange.split('..')[0];
    const coveredByOwn = ownStart ? new Set((await tagsReachableFrom(name, ownStart)).map((t) => t.tag)) : undefined;
    // As each strategy scopes the package's own changelog.
    const scope = resolveCommitScope(pkg.dir, config, { repoRoot, ignorePaths: output.strategy === 'group' }).scope;

    const versions: string[] = [];
    for (const [i, { tag, version }] of reachable.entries()) {
      if (before.has(tag) || (coveredByOwn && !coveredByOwn.has(tag))) {
        continue;
      }
      const key = `${name}@${version}`;
      if (!releases.has(key)) {
        // A package's first tag starts at the nearest earlier tag, as its own first release did.
        // A tag on the root commit has no parent to list from.
        const [nearest] =
          i > 0 ? [] : await git.listTags({ sort: '-creatordate', merged: `${tag}^`, cwd: repoRoot }).catch(() => []);
        const from = reachable[i - 1]?.tag ?? nearest;
        const range = from ? `${from}..${tag}` : tag;
        const entries = await extractChangelogEntriesFromCommits(pkg.dir, range, config.preset, scope);
        releases.set(key, { packageName: name, version, entries: entries.filter((e) => !isPlaceholder(e, version)) });
      }
      if ((releases.get(key)?.entries.length ?? 0) > 0) {
        versions.push(version);
      }
    }
    return versions;
  };

  for (const primary of output.changelogs.filter((c) => isPrimary(c.packageName))) {
    // Its own tags, not its changelog's range start, which can be a fallback ref. A stable release reaches back to the
    // last stable tag, as its own notes do on graduation.
    const primaryTags = await tagsReachableFrom(primary.packageName, 'HEAD');
    const stable = semver.prerelease(primary.version)
      ? primaryTags
      : primaryTags.filter((t) => !semver.prerelease(t.version));
    const primaryTag = (stable.at(-1) ?? primaryTags.at(-1))?.tag;
    if (!primaryTag) {
      continue;
    }
    const groupMates = groups.groupOf(primary.packageName)?.members.map((p) => p.packageJson.name) ?? [];
    const bundled: VersionBundledPackage[] = [];
    for (const name of bundledPackageNames(primary.packageName, graph, groupMates, isPrimary)) {
      if (isShared(name)) {
        continue;
      }
      const versions = await releasesSince(name, primaryTag);
      const own = thisRun.get(name);
      if (own?.entries.some((e) => !isPlaceholder(e, own.version))) {
        versions.push(own.version);
      }
      if (versions.length > 0) {
        bundled.push({ packageName: name, versions });
      }
    }
    if (bundled.length > 0) {
      bundledByPrimary.set(primary.packageName, bundled);
    }
  }

  const used = new Set(
    [...bundledByPrimary.values()].flatMap((b) => b.flatMap((p) => p.versions.map((v) => `${p.packageName}@${v}`))),
  );
  setBundled(
    bundledByPrimary,
    [...releases.entries()].filter(([key]) => used.has(key)).map(([, release]) => release),
  );
}
