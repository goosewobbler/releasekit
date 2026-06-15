import type { VersionPackageChangelog } from '@releasekit/core';
import { extractChangelogEntriesFromCommits, listPackageTags } from '@releasekit/version';
import semver from 'semver';

const VERSION_RE = /\d{1,16}\.\d{1,16}\.\d{1,16}(?:-[0-9A-Za-z.-]{1,256})?/;

/** Extract the semver from a tag (e.g. `pkg@v1.2.0-next.0` → `1.2.0-next.0`), or null if none. */
export function versionFromTag(tag: string): string | null {
  const match = tag.match(VERSION_RE);
  return match && semver.valid(match[0]) ? match[0] : null;
}

export interface ReconstructOptions {
  packageName: string;
  /** Directory the package's commits are scoped to (for path-filtered changelog extraction). */
  pkgPath: string;
  repoUrl?: string | null;
  versionPrefix?: string;
  tagTemplate?: string;
  packageSpecificTags?: boolean;
  /** Inclusive version bounds; omit for the whole tag history. */
  from?: string;
  to?: string;
}

/** A reconstructed version: its source git tag plus the changelog rebuilt for that tag's range. */
export interface ReconstructedVersion {
  /** The git tag this version was reconstructed from (e.g. `pkg@v1.2.0`). */
  tag: string;
  changelog: VersionPackageChangelog;
}

/**
 * Rebuild a {@link VersionPackageChangelog} for each of a package's historical tags by pairing every
 * tag with its predecessor to scope the commit range (`prevTag..tag`; the first tag uses all commits
 * reachable from it). Tags are re-sorted ascending by semver so the pairing is chronological by
 * version regardless of creation order. This is the offline counterpart of the live version stage's
 * per-package changelog build, for the notes-backfill command (#293).
 */
export async function reconstructChangelogs(opts: ReconstructOptions): Promise<ReconstructedVersion[]> {
  const tags: string[] = await listPackageTags(opts.packageName, opts.versionPrefix, {
    tagTemplate: opts.tagTemplate,
    packageSpecificTags: opts.packageSpecificTags ?? false,
  });

  const versioned = tags
    .map((tag) => ({ tag, version: versionFromTag(tag) }))
    .filter((t): t is { tag: string; version: string } => t.version !== null)
    .sort((a, b) => semver.compare(a.version, b.version));

  const reconstructed: ReconstructedVersion[] = [];
  for (let i = 0; i < versioned.length; i++) {
    const current = versioned[i];
    if (!current) continue;
    const { tag, version } = current;
    if (opts.from && semver.lt(version, opts.from)) continue;
    if (opts.to && semver.gt(version, opts.to)) continue;

    const prev = versioned[i - 1];
    const revisionRange = prev ? `${prev.tag}..${tag}` : tag;
    reconstructed.push({
      tag,
      changelog: {
        packageName: opts.packageName,
        version,
        previousVersion: prev?.version ?? null,
        revisionRange,
        repoUrl: opts.repoUrl ?? null,
        entries: extractChangelogEntriesFromCommits(opts.pkgPath, revisionRange),
      },
    });
  }

  return reconstructed;
}
