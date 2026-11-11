import type { VersionChangelogEntry } from '@releasekit/core';
import { shouldMatchPackageTargets } from '@releasekit/core';
import semver from 'semver';

type Groups = Record<string, { sync?: string; packages?: string[] }>;

/** From config, since an unchanged member has no update to read its group from. */
export function lockstepGroupOf(name: string, groups: Groups): string | undefined {
  for (const [group, cfg] of Object.entries(groups)) {
    if ((cfg.sync === 'fixed' || cfg.sync === 'linked') && shouldMatchPackageTargets(name, cfg.packages ?? [])) {
      return group;
    }
  }
  return undefined;
}

const RANK = { patch: 1, minor: 2, major: 3 } as const;
export type Magnitude = keyof typeof RANK;

/**
 * The bump that the queued changes need, when it's bigger than the one that opened the prerelease line (`1.1.0-next.N`
 * is a minor line). Graduating ships the line's base without a further bump, so it would understate them.
 */
export function graduationOvershoot(
  entries: readonly VersionChangelogEntry[],
  prereleaseVersion: string,
  zeroMajor: 'spec' | 'strict' = 'spec',
): Magnitude | undefined {
  const base = semver.parse(prereleaseVersion);
  if (!base) {
    return undefined;
  }
  const line: Magnitude = base.minor === 0 && base.patch === 0 ? 'major' : base.patch === 0 ? 'minor' : 'patch';
  let needed: Magnitude = 'patch';
  for (const entry of entries) {
    if (entry.synthetic) {
      continue;
    }
    const breaking: Magnitude = base.major === 0 && zeroMajor === 'spec' ? 'minor' : 'major';
    const magnitude: Magnitude = entry.breaking ? breaking : entry.type === 'added' ? 'minor' : 'patch';
    if (RANK[magnitude] > RANK[needed]) {
      needed = magnitude;
    }
  }
  return RANK[needed] > RANK[line] ? needed : undefined;
}
