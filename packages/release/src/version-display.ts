import type { VersionOutput } from '@releasekit/core';

/**
 * Updates excluding the workspace-root lockstep bump (sync mode) — i.e. the publishable
 * packages. Falls back to all updates when filtering would leave nothing (e.g. old
 * manifests produced before `isRoot` existed, or single-package repos).
 */
export function publishableUpdates(versionOutput: VersionOutput): VersionOutput['updates'] {
  const nonRoot = versionOutput.updates.filter((u) => !u.isRoot);
  return nonRoot.length > 0 ? nonRoot : versionOutput.updates;
}

/**
 * The display form of a sync release's single version — the shared consumer-facing tag when one
 * exists, otherwise the raw version. Per the VersionOutput contract, updates carry per-package
 * tags only when each package is tagged individually (packageSpecificTags), so "no update has
 * a tag" means tags[0] is the single shared tag.
 */
export function syncVersionDisplay(versionOutput: VersionOutput): string {
  const sharedTag = versionOutput.updates.every((u) => !u.tag) ? versionOutput.tags?.[0] : undefined;
  return sharedTag ?? publishableUpdates(versionOutput)[0]?.newVersion ?? '';
}

/**
 * Bare semver for display. `previousVersion` is persisted as the consumer tag (e.g. `pkg@v10.1.0`,
 * `release/v1.2.0`, `v1.2.0`) so compare-URL generation can build links from it; renderers want the
 * bare version. Extract the semver from the TAIL of the string with an end-anchored match so a
 * numeric package name stays safe (`package2@v1.0.0` → `1.0.0`, not `2.0.0`). Returns the input
 * unchanged when it carries no recognisable semver.
 */
export function toDisplayVersion(tagOrVersion: string): string {
  const match = tagOrVersion.match(/(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)$/);
  return match?.[1] ?? tagOrVersion;
}

/** Previous-to-next version range when the previous version is known, otherwise just the next version. */
export function syncVersionRange(versionOutput: VersionOutput): string {
  const next = syncVersionDisplay(versionOutput);
  const prev = versionOutput.changelogs[0]?.previousVersion;
  return prev ? `${prev} → ${next}` : next;
}
