import type { VersionPackageChangelog } from '@releasekit/core';
import semver from 'semver';

export interface MergedRow {
  packageName: string;
  baseline: string | null;
  standing?: string;
  current?: string;
  afterMerge: string;
  status: 'unchanged' | 'escalated' | 'new-from-pr' | 'standing-only';
}

/** Higher semver wins per package: the highest bump in the union of commits decides. */
export function mergeForPreview(
  standingChangelogs: VersionPackageChangelog[],
  currentChangelogs: VersionPackageChangelog[],
): MergedRow[] {
  const byName = new Map<string, MergedRow>();

  for (const cl of standingChangelogs) {
    if (!cl.entries.length && cl.version === cl.previousVersion) {
      continue;
    }
    byName.set(cl.packageName, {
      packageName: cl.packageName,
      baseline: cl.previousVersion,
      standing: cl.version,
      afterMerge: cl.version,
      status: 'standing-only',
    });
  }

  for (const cl of currentChangelogs) {
    if (!cl.entries.length && cl.version === cl.previousVersion) {
      continue;
    }
    const existing = byName.get(cl.packageName);
    if (!existing) {
      byName.set(cl.packageName, {
        packageName: cl.packageName,
        baseline: cl.previousVersion,
        current: cl.version,
        afterMerge: cl.version,
        status: 'new-from-pr',
      });
      continue;
    }
    if (semver.valid(cl.version)) {
      existing.current = cl.version;
    }
    // semver.gt throws on malformed versions (older manifests, unexpected calculator output), which would abort the
    // whole preview, so treat them as 'unchanged'.
    const bothValid = semver.valid(cl.version) && existing.standing && semver.valid(existing.standing);
    if (bothValid && existing.standing && semver.gt(cl.version, existing.standing)) {
      existing.afterMerge = cl.version;
      existing.status = 'escalated';
    } else {
      existing.status = 'unchanged';
      if (semver.valid(cl.version) && existing.standing && !semver.valid(existing.standing)) {
        existing.afterMerge = cl.version;
      }
    }
  }

  return [...byName.values()].sort((a, b) => a.packageName.localeCompare(b.packageName));
}
