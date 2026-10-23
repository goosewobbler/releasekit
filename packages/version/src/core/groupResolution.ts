/**
 * A version group binds packages to a sync mode:
 *  - `fixed`: any releasable change in any member releases ALL members at the shared group version.
 *  - `linked`: only members with releasable changes release, all at the same computed version.
 *  - `independent`: only members with releasable changes release, each on its own version line, but
 *    targeting any member pulls in the whole group so it never ships a partial subset.
 */

import type { Package } from '@manypkg/get-packages';
import { shouldMatchPackageTargets } from '@releasekit/core';
import { createVersionError, VersionErrorCode } from '../errors/versionError.js';
import type { Config, VersionGroupConfig } from '../types.js';
import { log } from '../utils/logging.js';

/** Group name used for the implicit all-packages group that `version.sync: true` desugars to. */
export const IMPLICIT_SYNC_GROUP = '__sync__';

export interface ResolvedGroup {
  /** Config key (or {@link IMPLICIT_SYNC_GROUP} for the desugared `sync: true` group). */
  name: string;
  sync: 'fixed' | 'linked' | 'independent';
  patterns: string[];
  members: Package[];
  implicit: boolean;
}

export interface GroupResolution {
  /** All resolved groups with at least one matched member, in config order. */
  groups: ResolvedGroup[];
  /** Not in any group - versioned independently. */
  ungrouped: Package[];
  groupOf: (packageName: string) => ResolvedGroup | undefined;
}

/**
 * When both `sync: true` and `groups` are set, the implicit group wins - a user who forgot to flip
 * `sync: false` gets a warning, not a silently-split release.
 */
export function normalizeGroupDefinitions(config: Config): VersionGroupConfig[] {
  const explicit: VersionGroupConfig[] = Object.entries(config.groups ?? {}).map(([name, group]) => ({
    name,
    packages: group.packages,
    sync: group.sync,
  }));

  if (config.sync) {
    if (explicit.length > 0) {
      log(
        'version.sync is true AND version.groups is set. `sync: true` is sugar for one implicit ' +
          'fixed group of every package, which overrides the explicit groups. Set `version.sync: false` ' +
          'to use the named groups.',
        'warning',
      );
    }
    return [
      {
        name: IMPLICIT_SYNC_GROUP,
        // Documentation only - resolveGroups special-cases the implicit group.
        packages: ['**'],
        sync: 'fixed',
      },
    ];
  }

  return explicit;
}

/**
 * A package in two groups is an error (no defined winner); an empty group is dropped with a warning so a
 * stale pattern doesn't abort the run.
 */
export function resolveGroups(config: Config, packages: Package[]): GroupResolution {
  const definitions = normalizeGroupDefinitions(config);

  const memberOf = new Map<string, ResolvedGroup>();
  const groups: ResolvedGroup[] = [];

  for (const def of definitions) {
    const matchesAll = def.name === IMPLICIT_SYNC_GROUP;
    const members: Package[] = [];
    for (const pkg of packages) {
      const name = pkg.packageJson.name;
      // The implicit sync group is "every package" by definition - don't route it through glob
      // matching, where a bare `*` would fail to cross the `/` in scoped names.
      if (!matchesAll && !shouldMatchPackageTargets(name, def.packages)) {
        continue;
      }

      const existing = memberOf.get(name);
      if (existing) {
        throw createVersionError(
          VersionErrorCode.INVALID_CONFIG,
          `Package "${name}" matches more than one version group ("${existing.name}" and "${def.name}"). ` +
            'A package may belong to at most one group; tighten the patterns so each package matches a single group.',
        );
      }
      members.push(pkg);
    }

    if (members.length === 0) {
      log(`Version group "${def.name}" matched no workspace packages; ignoring.`, 'warning');
      continue;
    }

    const group: ResolvedGroup = {
      name: def.name,
      sync: def.sync,
      patterns: def.packages,
      members,
      implicit: def.name === IMPLICIT_SYNC_GROUP,
    };
    for (const pkg of members) {
      memberOf.set(pkg.packageJson.name, group);
    }
    groups.push(group);
  }

  const ungrouped = packages.filter((pkg) => !memberOf.has(pkg.packageJson.name));

  return {
    groups,
    ungrouped,
    groupOf: (packageName: string) => memberOf.get(packageName),
  };
}

/**
 * Drives strategy selection. `sync: true` stays on the sync strategy rather than the group engine: its
 * single-shared-tag / `monorepo`-changelog / root-bump output is depended on by standing-PR manifests
 * and downstream consumers.
 */
export function hasExplicitGroups(config: Config): boolean {
  return Object.keys(config.groups ?? {}).length > 0;
}

export function hasGroups(config: Config): boolean {
  return config.sync === true || hasExplicitGroups(config);
}

/**
 * Targeting any member of an atomic group (`fixed` or `independent`) pulls in the whole group; we expand
 * rather than error. `linked` groups are untouched - partial targeting is well defined there.
 */
export function expandTargetsForAtomicGroups(
  resolution: GroupResolution,
  targets: string[],
): { targets: string[]; expandedGroups: string[] } {
  if (targets.length === 0) {
    return { targets, expandedGroups: [] };
  }

  const expanded = new Set(targets);
  const expandedGroups: string[] = [];

  for (const group of resolution.groups) {
    if (group.sync === 'linked') {
      continue;
    }

    const someTargeted = group.members.some((m) => shouldMatchPackageTargets(m.packageJson.name, targets));
    const allTargeted = group.members.every((m) => shouldMatchPackageTargets(m.packageJson.name, targets));

    if (someTargeted && !allTargeted) {
      for (const member of group.members) {
        expanded.add(member.packageJson.name);
      }
      expandedGroups.push(group.name);
      log(
        `--target hit a strict subset of ${group.sync} group "${group.name}"; expanding to all ${group.members.length} ` +
          `members so the group releases atomically: ${group.members.map((m) => m.packageJson.name).join(', ')}.`,
        'warning',
      );
    }
  }

  return { targets: [...expanded], expandedGroups };
}
