import type { VersionOutput } from '@releasekit/core';

/** Excludes the sync-mode workspace-root bump, unless that's the only update (a single-package repo). */
export function publishableUpdates(versionOutput: VersionOutput): VersionOutput['updates'] {
  const nonRoot = versionOutput.updates.filter((u) => !u.isRoot);
  return nonRoot.length > 0 ? nonRoot : versionOutput.updates;
}

/** Updates carry tags only under packageSpecificTags, so when none has one, tags[0] is the shared tag. */
export function syncVersionDisplay(versionOutput: VersionOutput): string {
  const sharedTag = versionOutput.updates.every((u) => !u.tag) ? versionOutput.tags?.[0] : undefined;
  return sharedTag ?? publishableUpdates(versionOutput)[0]?.newVersion ?? '';
}

/**
 * `previousVersion` is persisted as the consumer tag, for compare URLs. End-anchored so a numeric package name stays
 * safe: `package2@v1.0.0` → `1.0.0`, not `2.0.0`.
 */
export function toDisplayVersion(tagOrVersion: string): string {
  const match = tagOrVersion.match(/(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)$/);
  return match?.[1] ?? tagOrVersion;
}

export function syncVersionRange(versionOutput: VersionOutput): string {
  const next = syncVersionDisplay(versionOutput);
  const prev = versionOutput.changelogs[0]?.previousVersion;
  return prev ? `${prev} → ${next}` : next;
}
