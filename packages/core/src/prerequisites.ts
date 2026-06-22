/**
 * Prerequisite resolution — given a set of explicit release targets, derive the *prerequisite*
 * releases: the transitive internal dependencies of those targets that ALSO have a releasable
 * change. Prerequisites are pulled in only if they changed (an unchanged dependency needs no
 * release), are listed in the workspace's dependency order (the full release set is published
 * deps-first), and keep their own commit-driven bump (the override applies to the explicit targets,
 * not their prerequisites).
 *
 * Group expansion of the explicit targets is the caller's concern — this operates on whatever
 * target list it is given.
 */

import type { WorkspaceDependencyGraph } from './dependencyGraph.js';

export interface PrerequisiteResolution {
  /** The explicit release targets, verbatim — they receive any bump/prerelease/stable override. */
  targets: string[];
  /**
   * Derived prerequisites: transitive internal dependencies of the targets that also changed,
   * excluding the targets themselves, each keeping its own commit-driven bump. Listed in the
   * workspace's dependency order — consistent with the full release set, not just among themselves.
   * The authoritative publish order is `topologicalOrder([...targetSet])`; prerequisites are NOT a
   * standalone "publish these before the targets" list.
   */
  prerequisites: string[];
  /** Everything that will release: targets ∪ prerequisites. */
  targetSet: Set<string>;
  /**
   * For each derived prerequisite, the explicit target(s) that pulled it in (i.e. the targets that
   * transitively depend on it). A shared dependency can serve several targets. Lets callers render
   * "target → its prerequisites" without re-walking the graph.
   */
  prerequisiteOf: Record<string, string[]>;
}

export function resolvePrerequisites(
  graph: WorkspaceDependencyGraph,
  explicitTargets: string[],
  changedPackages: Iterable<string>,
): PrerequisiteResolution {
  const changed = new Set(changedPackages);
  const targetSet = new Set(explicitTargets);
  const prereqSet = new Set<string>();
  const prerequisiteOf: Record<string, string[]> = {};

  for (const target of explicitTargets) {
    for (const dep of graph.transitiveDependencies(target)) {
      // A dependency is a prerequisite only when it actually changed and isn't itself a target.
      // `targetSet` here still holds only the explicit targets (prerequisites are added below).
      if (changed.has(dep) && !targetSet.has(dep)) {
        prereqSet.add(dep);
        prerequisiteOf[dep] = [...(prerequisiteOf[dep] ?? []), target];
      }
    }
  }
  for (const name of prereqSet) targetSet.add(name);

  // Order by the FULL release set's dependency order, then filter to the derived subset — so a
  // prerequisite that depends on an explicit target sorts after it. Ordering the prerequisite slice
  // alone would miss that cross-boundary edge (the target isn't in the slice).
  const prerequisites = graph.topologicalOrder([...targetSet]).filter((name) => prereqSet.has(name));

  // Return a copy of the targets, not the caller's array, so all fields are freshly owned.
  return { targets: [...explicitTargets], prerequisites, targetSet, prerequisiteOf };
}
