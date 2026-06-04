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

/** Previous-to-next version range when the previous version is known, otherwise just the next version. */
export function syncVersionRange(versionOutput: VersionOutput): string {
  const next = syncVersionDisplay(versionOutput);
  const prev = versionOutput.changelogs[0]?.previousVersion;
  return prev ? `${prev} → ${next}` : next;
}
