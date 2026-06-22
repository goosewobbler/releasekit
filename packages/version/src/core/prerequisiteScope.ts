/**
 * Compose the prerequisite-release target set and override scope for a `--include-prerequisites`
 * run, bridging the discovered workspace to the core `resolvePrerequisites`.
 *
 *  - Explicit targets are expanded to their whole group (any mode) — the bump/prerelease/stable
 *    override applies to the declared coordination set, not just the one package named.
 *  - Their transitive internal dependencies that *also changed* are pulled in as derived
 *    prerequisites, which keep their own commit-driven bump (excluded from the override scope).
 *
 * The graph and changed-detection are injected so this stays a pure, unit-testable composition.
 */

import type { Package } from '@manypkg/get-packages';
import { resolvePrerequisites, shouldMatchPackageTargets, type WorkspaceDependencyGraph } from '@releasekit/core';
import type { Config } from '../types.js';
import { resolveGroups } from './groupResolution.js';

export interface PrerequisiteTargets {
  /** Every package that will release: group-expanded explicit targets ∪ derived prerequisites. */
  targets: string[];
  /** The packages the bump/prerelease/stable override applies to (the group-expanded explicit set). */
  overrideScope: string[];
}

export function resolvePrerequisiteTargets(
  graph: WorkspaceDependencyGraph,
  packages: Package[],
  config: Config,
  explicitTargets: string[],
  isChanged: (name: string) => boolean,
): PrerequisiteTargets {
  const explicitNames = packages
    .map((p) => p.packageJson.name)
    .filter((name) => shouldMatchPackageTargets(name, explicitTargets));

  // Expand each explicit target to its whole group, regardless of sync mode — the override is
  // meant for the declared coordination set, and prerequisite derivation starts from that set.
  const resolution = resolveGroups(config, packages);
  const overrideSet = new Set(explicitNames);
  for (const name of explicitNames) {
    const group = resolution.groupOf(name);
    if (group) for (const member of group.members) overrideSet.add(member.packageJson.name);
  }

  // Detect which transitive dependencies of the expanded targets actually changed — only those
  // become prerequisites (an unchanged dependency needs no release).
  const candidateDeps = new Set<string>();
  for (const name of overrideSet) {
    for (const dep of graph.transitiveDependencies(name)) candidateDeps.add(dep);
  }
  const changed = [...candidateDeps].filter((name) => isChanged(name));

  const { targetSet } = resolvePrerequisites(graph, [...overrideSet], changed);
  return { targets: [...targetSet], overrideScope: [...overrideSet] };
}
