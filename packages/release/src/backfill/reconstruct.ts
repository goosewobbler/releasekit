import type { VersionPackageChangelog } from '@releasekit/core';
import { createGitCli } from '@releasekit/git';
import { extractChangelogEntriesFromCommits, listGlobalTags, listPackageTags } from '@releasekit/version';
import semver from 'semver';

const VERSION_RE = /\d{1,16}\.\d{1,16}\.\d{1,16}(?:-[0-9A-Za-z.-]{1,256})?/;

/** Extract the semver from a tag (e.g. `pkg@v1.2.0-next.0` → `1.2.0-next.0`), or null if none. */
export function versionFromTag(tag: string): string | null {
  const match = tag.match(VERSION_RE);
  return match && semver.valid(match[0]) ? match[0] : null;
}

/**
 * The committer date (`YYYY-MM-DD`) of the commit a tag points to — the closest reconstruction of
 * when the version was actually released. Returns undefined if git can't resolve it, so the caller
 * falls back to the pipeline's default (today). Uses `--date=short` (universal) rather than `%cs`.
 */
async function tagDate(tag: string, cwd: string): Promise<string | undefined> {
  try {
    return (
      (await createGitCli().log({ range: tag, format: '%cd', extraArgs: ['-1', '--date=short'], cwd })).trim() ||
      undefined
    );
  } catch {
    return undefined;
  }
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
  /** The tag's commit date (`YYYY-MM-DD`), or undefined if git couldn't resolve it. */
  date?: string;
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
  // Package-specific repos tag each package (`pkg@v1.2.0`); sync/single repos share one global tag
  // series (`v1.2.0`). listPackageTags returns [] for the latter, so pick the matching source — then
  // the (commit-scoped) changelog extraction still isolates this package's history either way.
  const tags: string[] = opts.packageSpecificTags
    ? await listPackageTags(opts.packageName, opts.versionPrefix, {
        tagTemplate: opts.tagTemplate,
        packageSpecificTags: true,
      })
    : await listGlobalTags(opts.versionPrefix);

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
      date: await tagDate(tag, opts.pkgPath),
      changelog: {
        packageName: opts.packageName,
        version,
        previousVersion: prev?.version ?? null,
        revisionRange,
        repoUrl: opts.repoUrl ?? null,
        entries: await extractChangelogEntriesFromCommits(opts.pkgPath, revisionRange),
      },
    });
  }

  return reconstructed;
}
