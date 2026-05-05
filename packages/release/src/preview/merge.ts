import type { VersionPackageChangelog } from '@releasekit/core';
import semver from 'semver';

export interface MergedRow {
  packageName: string;
  /** Current published version (from changelogs[].previousVersion). null on first release. */
  baseline: string | null;
  /** New version proposed by the standing PR. undefined if the standing PR doesn't touch this package. */
  standing?: string;
  /** New version proposed by THIS PR. undefined if this PR doesn't touch this package. */
  current?: string;
  /** Predicted version after merge (max of standing, current). */
  afterMerge: string;
  status: 'unchanged' | 'escalated' | 'new-from-pr' | 'standing-only';
}

/**
 * Merge a standing PR's queued package changelogs with the current PR's changelogs to
 * predict the resulting per-package versions after merge. Higher semver wins per package
 * (matches conventional-commits semantics: highest bump magnitude in the union of commits
 * determines the bump).
 *
 * The result is sorted alphabetically by package name for stable output across re-runs.
 */
export function mergeForPreview(
  standingChangelogs: VersionPackageChangelog[],
  currentChangelogs: VersionPackageChangelog[],
): MergedRow[] {
  const byName = new Map<string, MergedRow>();

  for (const cl of standingChangelogs) {
    if (!cl.entries.length && cl.version === cl.previousVersion) continue;
    byName.set(cl.packageName, {
      packageName: cl.packageName,
      baseline: cl.previousVersion,
      standing: cl.version,
      afterMerge: cl.version,
      status: 'standing-only',
    });
  }

  for (const cl of currentChangelogs) {
    if (!cl.entries.length && cl.version === cl.previousVersion) continue;
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
    existing.current = cl.version;
    // Guard semver comparison against malformed version strings (older manifests, unexpected
    // calculator output) — semver.gt throws on invalid input, which would otherwise abort the
    // entire preview. Treat unparseable versions as 'unchanged' to keep the preview non-fatal.
    const bothValid = semver.valid(cl.version) && existing.standing && semver.valid(existing.standing);
    if (bothValid && existing.standing && semver.gt(cl.version, existing.standing)) {
      existing.afterMerge = cl.version;
      existing.status = 'escalated';
    } else {
      existing.status = 'unchanged';
      // When only the standing version is invalid, prefer the current PR's valid prediction so
      // the rendered "After merge" cell shows a real version rather than a garbled string.
      if (semver.valid(cl.version) && existing.standing && !semver.valid(existing.standing)) {
        existing.afterMerge = cl.version;
      }
    }
  }

  return [...byName.values()].sort((a, b) => a.packageName.localeCompare(b.packageName));
}
