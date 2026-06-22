/**
 * Version-group resolution.
 *
 * A "version group" binds a set of packages to a sync mode:
 *  - `fixed`:  any releasable change in any member releases ALL members at the shared group version
 *              (`bump(max(member baselines))`).
 *  - `linked`: only members with releasable changes release, but every releasing member shares the
 *              same computed version.
 *  - `independent`: only members with releasable changes release, each on its own commit-driven
 *              version line (no shared version), but the set is atomic — targeting any member pulls
 *              in the whole group so it never ships a partial subset.
 *
 * The global `version.sync: true` flag is **sugar** for a single implicit `fixed` group containing
 * every workspace package — there is exactly one mechanism, normalized here, not two. This keeps
 * the engine, output contract, and CI surfaces uniform regardless of whether the user wrote
 * `sync: true` or an explicit group.
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
  /** Raw patterns from config. */
  patterns: string[];
  /** Workspace packages that matched this group's patterns. */
  members: Package[];
  /** True when this group came from `version.sync: true` rather than `version.groups`. */
  implicit: boolean;
}

export interface GroupResolution {
  /** All resolved groups with at least one matched member, in config order. */
  groups: ResolvedGroup[];
  /** Packages not matched by any group — versioned independently (per-package). */
  ungrouped: Package[];
  /** Fast lookup from package name to the group it belongs to (undefined if ungrouped). */
  groupOf: (packageName: string) => ResolvedGroup | undefined;
}

/**
 * Normalize the user's config into the canonical list of group definitions, before matching
 * against the workspace. `sync: true` becomes the implicit all-packages fixed group; explicit
 * `groups` are carried through as-is.
 *
 * When both `sync: true` and `groups` are set, the implicit all-packages group would swallow
 * every package and make the explicit groups meaningless — this is a config conflict. We surface
 * it loudly and let the implicit sync group win (back-compat: `sync: true` keeps its historical
 * all-lockstep meaning), so a user who forgot to flip `sync: false` gets a warning rather than a
 * silently-split release.
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
        // `**` documents "all packages"; resolveGroups also special-cases the implicit group so
        // membership never depends on glob slash-crossing semantics for scoped names.
        packages: ['**'],
        sync: 'fixed',
      },
    ];
  }

  return explicit;
}

/**
 * Resolve group definitions against the discovered workspace packages.
 *
 * Validates that no package is claimed by more than one group (overlapping patterns that bind a
 * package to two groups are a config error — there's no defined winner). Empty groups (patterns
 * that matched nothing) are dropped with a warning so a stale pattern doesn't abort the run.
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
      // The implicit sync group is "every package" by definition — don't route it through glob
      // matching, where a bare `*` would fail to cross the `/` in scoped names.
      if (!matchesAll && !shouldMatchPackageTargets(name, def.packages)) continue;

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
 * Whether explicit named groups are configured under `version.groups`.
 *
 * This drives strategy selection. `version.sync: true` is *conceptually* one implicit fixed group
 * (and {@link normalizeGroupDefinitions} models it that way), but for back-compat the established
 * sync strategy keeps owning the `sync: true` path — its single-shared-tag / `monorepo`-changelog /
 * root-bump output is depended on by standing-PR manifests and downstream consumers. The group
 * engine is selected only when the user opts into `version.groups`.
 */
export function hasExplicitGroups(config: Config): boolean {
  return Object.keys(config.groups ?? {}).length > 0;
}

/**
 * Whether any group mechanism applies (explicit groups or the desugared `sync: true`).
 * Used by {@link normalizeGroupDefinitions} consumers that reason about the unified model.
 */
export function hasGroups(config: Config): boolean {
  return config.sync === true || hasExplicitGroups(config);
}

/**
 * Expand a set of `--target` patterns so that targeting any member of an **atomic** group (`fixed`
 * or `independent`) pulls in the whole group. Silently splitting an atomic group breaks its
 * invariant — fixed members all release at the same version; an independent group's changed members
 * all release together — so we expand rather than error.
 *
 * Returns the expanded target patterns plus a record of which groups were expanded (for logging).
 * `linked` groups are left untouched — partial targeting of a linked group is well defined (only
 * changed, targeted members release).
 */
export function expandTargetsForAtomicGroups(
  resolution: GroupResolution,
  targets: string[],
): { targets: string[]; expandedGroups: string[] } {
  if (targets.length === 0) return { targets, expandedGroups: [] };

  const expanded = new Set(targets);
  const expandedGroups: string[] = [];

  for (const group of resolution.groups) {
    if (group.sync === 'linked') continue;

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
