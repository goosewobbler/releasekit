import type { Package } from '@manypkg/get-packages';
import { resolvePrerequisites, shouldMatchPackageTargets, type WorkspaceDependencyGraph } from '@releasekit/core';
import type { Config } from '../types.js';
import { resolveGroups } from './groupResolution.js';

export interface PrerequisiteTargets {
  /** Every package that will release: group-expanded explicit targets ∪ derived prerequisites. */
  targets: string[];
  /** The packages the bump/prerelease/stable override applies to (the group-expanded explicit set). */
  overrideScope: string[];
  /** For each derived prerequisite, the package(s) that pulled it in; an atomic group-mate shares its member's. */
  prerequisiteOf: Record<string, string[]>;
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

  // Expand each explicit target to its whole group, regardless of sync mode - the override is
  // meant for the declared coordination set, and prerequisite derivation starts from that set.
  const resolution = resolveGroups(config, packages);
  const overrideSet = new Set(explicitNames);
  for (const name of explicitNames) {
    const group = resolution.groupOf(name);
    if (group) {
      for (const member of group.members) {
        overrideSet.add(member.packageJson.name);
      }
    }
  }

  const targets = new Set(overrideSet);
  const prerequisiteOf: Record<string, string[]> = {};
  let frontier = [...overrideSet];
  while (frontier.length > 0) {
    const changed = frontier
      .flatMap((name) => [...graph.transitiveDependencies(name)])
      .filter((name) => !targets.has(name) && isChanged(name));
    const resolved = resolvePrerequisites(graph, frontier, changed);
    const added: string[] = [];
    for (const name of resolved.targetSet) {
      if (!targets.has(name)) {
        targets.add(name);
        added.push(name);
        prerequisiteOf[name] = resolved.prerequisiteOf[name];
      }
    }
    // The group strategy releases an atomic group whole, so a prerequisite's group-mates release too and their own
    // dependencies need the same walk.
    for (const name of [...added]) {
      const group = resolution.groupOf(name);
      if (!group || group.sync === 'linked') {
        continue;
      }
      for (const member of group.members) {
        const mate = member.packageJson.name;
        if (!targets.has(mate)) {
          targets.add(mate);
          added.push(mate);
          prerequisiteOf[mate] = prerequisiteOf[name];
        }
      }
    }
    frontier = added;
  }

  return { targets: [...targets], overrideScope: [...overrideSet], prerequisiteOf };
}
