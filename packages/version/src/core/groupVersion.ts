/**
 * A fixed/linked group's version is `bump(max member baseline)` applied once, using the largest bump
 * any member earned. Members below it (never released, or an older package joining a higher family)
 * adopt it.
 */

import type { Package } from '@manypkg/get-packages';
import { shouldMatchPackageTargets } from '@releasekit/core';
import type { ReleaseType } from 'semver';
import semver from 'semver';
import type { Config } from '../types.js';
import type { ResolvedGroup } from './groupResolution.js';

const BUMP_RANK: Record<string, number> = {
  patch: 1,
  prepatch: 1,
  minor: 2,
  preminor: 2,
  major: 3,
  premajor: 3,
  prerelease: 0,
};

/** Rank 0 is special-cased in computeGroup: `semver.inc` with a stable type would graduate the group. */
const RANK_TO_TYPE: Record<number, 'patch' | 'minor' | 'major' | 'prerelease'> = {
  0: 'prerelease',
  1: 'patch',
  2: 'minor',
  3: 'major',
};

export interface PackagePlan {
  pkg: Package;
  baseline: string;
  latestTag: string;
  usedPackageSpecificTag: boolean;
  /** The prefix of the repo's tags `latestTag` falls back to. */
  globalPrefix: string | undefined;
  /** Version this package would bump to on its own ('' when it earned no releasable change). */
  ownNext: string;
  changed: boolean;
  commitScope: string[];
  /** A `cargo.paths` or `pub.paths` entry that couldn't be resolved; raised only if the package releases. */
  pathsError?: Error;
}

function memberBumpRank(plan: PackagePlan): number {
  if (!plan.changed) {
    return -1;
  }
  const diff = semver.diff(plan.baseline, plan.ownNext);
  if (!diff) {
    // Treat as a patch so the group still advances.
    return BUMP_RANK.patch;
  }
  return BUMP_RANK[diff] ?? BUMP_RANK.patch;
}

export interface GroupComputation {
  /** Empty for `independent` groups, whose members each release at their own `ownNext`. */
  groupVersion: string;
  releasing: PackagePlan[];
  hasChange: boolean;
}

/** Prerequisites keep their own channel, so a group with no member in the override scope isn't forced onto the target's. */
function inOverrideScope(group: ResolvedGroup, config: Config): boolean {
  const scope = config.overrideScope;
  return !scope?.length || group.members.some((m) => shouldMatchPackageTargets(m.packageJson.name, scope));
}

/** A fixed/linked group shares one version and channel, so graduating ANY member graduates the group. */
function isGroupGraduating(group: ResolvedGroup, config: Config): boolean {
  if (!config.stableOnly) {
    return false;
  }
  const scope = config.graduateScope;
  if (!scope || scope.length === 0) {
    return inOverrideScope(group, config);
  }
  return group.members.some((m) => shouldMatchPackageTargets(m.packageJson.name, scope));
}

/** Twin of {@link isGroupGraduating}: a single scoped member pulls the whole group onto the prerelease line. */
function isGroupPrereleasing(group: ResolvedGroup, config: Config): boolean {
  if (!config.isPrerelease) {
    return false;
  }
  const scope = config.prereleaseScope;
  if (!scope || scope.length === 0) {
    return inOverrideScope(group, config);
  }
  return group.members.some((m) => shouldMatchPackageTargets(m.packageJson.name, scope));
}

export function computeGroup(group: ResolvedGroup, plans: PackagePlan[], config: Config): GroupComputation {
  const changedPlans = plans.filter((p) => p.changed);
  if (changedPlans.length === 0) {
    return { groupVersion: '', releasing: [], hasChange: false };
  }

  // Independent-group atomicity is enforced by target expansion and the caller's partial-subset warning.
  if (group.sync === 'independent') {
    return { groupVersion: '', releasing: changedPlans, hasChange: true };
  }

  const maxBaseline = plans.map((p) => p.baseline).sort(semver.rcompare)[0];

  // Graduation is bump-less: the group lands on the highest baseline's stable base (1.2.0-next.3 → 1.2.0).
  if (isGroupGraduating(group, config) && semver.prerelease(maxBaseline)) {
    const parsed = semver.parse(maxBaseline);
    let groupVersion = parsed ? `${parsed.major}.${parsed.minor}.${parsed.patch}` : maxBaseline;
    for (const plan of changedPlans) {
      if (semver.valid(plan.ownNext) && semver.gt(plan.ownNext, groupVersion)) {
        groupVersion = plan.ownNext;
      }
    }
    const releasing = group.sync === 'fixed' ? plans : changedPlans;
    return { groupVersion, releasing, hasChange: true };
  }
  const maxRank = Math.max(...changedPlans.map(memberBumpRank));
  const bumpType = RANK_TO_TYPE[maxRank] ?? 'patch';

  // The scoped flag is the explicit request; the member scan infers one when a member's own calculation
  // already produced a prerelease. `isGroupPrereleasing` (not raw `config.isPrerelease`) stops a
  // per-package prerelease forcing groups with no scoped member onto a prerelease line.
  const wantsPrerelease =
    isGroupPrereleasing(group, config) ||
    changedPlans.some((p) => semver.valid(p.ownNext) && semver.prerelease(p.ownNext) !== null);

  // Creating a prerelease from a stable baseline (e.g. 0.0.1 -> 1.0.0-next.0): RANK_TO_TYPE collapses
  // premajor/preminor/prepatch to a stable magnitude, so applying it directly would graduate the group,
  // and never-regress can't recover that (1.0.0-next.0 < 1.0.0).
  const creatingPrerelease = bumpType !== 'prerelease' && !semver.prerelease(maxBaseline) && wantsPrerelease;

  // Advance within an existing prerelease line (1.0.0-next.0 -> 1.0.0-next.1) - graduation requires
  // stable=true. Otherwise a prerelease rank re-emits the published baseline unchanged, which never-regress
  // can't recover when a member's ownNext sits below it.
  const stayOnPrereleaseLine = !!semver.prerelease(maxBaseline) && wantsPrerelease;

  let groupVersion: string;
  if (stayOnPrereleaseLine) {
    groupVersion = config.prereleaseIdentifier
      ? (semver.inc(maxBaseline, 'prerelease', config.prereleaseIdentifier) ?? maxBaseline)
      : (semver.inc(maxBaseline, 'prerelease') ?? maxBaseline);
  } else if (bumpType === 'prerelease') {
    // Rank 0 with a *stable* max baseline (a lower member is on a prerelease line). Don't regress
    // the stable baseline; never-regress pulls the group up to the member's own prerelease next.
    groupVersion = maxBaseline;
  } else if (creatingPrerelease) {
    const preBump = `pre${bumpType}` as ReleaseType;
    groupVersion = config.prereleaseIdentifier
      ? (semver.inc(maxBaseline, preBump, config.prereleaseIdentifier) ?? maxBaseline)
      : (semver.inc(maxBaseline, preBump) ?? maxBaseline);
  } else {
    groupVersion = semver.inc(maxBaseline, bumpType) ?? maxBaseline;
  }

  // Never-regress: no member releases below its own independently-computed next version.
  for (const plan of changedPlans) {
    if (semver.valid(plan.ownNext) && semver.gt(plan.ownNext, groupVersion)) {
      groupVersion = plan.ownNext;
    }
  }

  const releasing = group.sync === 'fixed' ? plans : changedPlans;
  return { groupVersion, releasing, hasChange: true };
}
