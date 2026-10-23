import type { VersionPackageChangelog } from '@releasekit/core';
import { createGitCli } from '@releasekit/git';
import { extractChangelogEntriesFromCommits, listGlobalTags, listPackageTags } from '@releasekit/version';
import semver from 'semver';

const VERSION_RE = /\d{1,16}\.\d{1,16}\.\d{1,16}(?:-[0-9A-Za-z.-]{1,256})?/;

export function versionFromTag(tag: string): string | null {
  const match = tag.match(VERSION_RE);
  return match && semver.valid(match[0]) ? match[0] : null;
}

/** `--date=short` because it's universal, unlike `%cs`. */
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
  pkgPath: string;
  repoUrl?: string | null;
  versionPrefix?: string;
  tagTemplate?: string;
  packageSpecificTags?: boolean;
  /** Inclusive bounds. */
  from?: string;
  to?: string;
}

export interface ReconstructedVersion {
  tag: string;
  date?: string;
  changelog: VersionPackageChangelog;
}

/** Tags are sorted by semver, not creation order, so each pairs with its version predecessor. */
export async function reconstructChangelogs(opts: ReconstructOptions): Promise<ReconstructedVersion[]> {
  // Sync/single repos share one global tag series, for which listPackageTags returns []; the path-scoped extraction
  // still isolates this package's history.
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
    if (!current) {
      continue;
    }
    const { tag, version } = current;
    if (opts.from && semver.lt(version, opts.from)) {
      continue;
    }
    if (opts.to && semver.gt(version, opts.to)) {
      continue;
    }

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
