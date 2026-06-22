/**
 * Prerequisite resolution — given a set of explicit release targets, derive the *prerequisite*
 * releases: the transitive internal dependencies of those targets that ALSO have a releasable
 * change. Prerequisites are pulled in only if they changed (an unchanged dependency needs no
 * release), are dependency-ordered so a dependency precedes its dependents, and keep their own
 * commit-driven bump (the override applies to the explicit targets, not their prerequisites).
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
   * dependency-ordered, excluding the targets themselves. Each keeps its own commit-driven bump.
   */
  prerequisites: string[];
  /** Everything that will release: targets ∪ prerequisites. */
  targetSet: Set<string>;
}

export function resolvePrerequisites(
  graph: WorkspaceDependencyGraph,
  explicitTargets: string[],
  changedPackages: Iterable<string>,
): PrerequisiteResolution {
  const changed = new Set(changedPackages);
  const targetSet = new Set(explicitTargets);
  const prereqSet = new Set<string>();

  for (const target of explicitTargets) {
    for (const dep of graph.transitiveDependencies(target)) {
      // A dependency is a prerequisite only when it actually changed and isn't itself a target.
      if (changed.has(dep) && !targetSet.has(dep)) prereqSet.add(dep);
    }
  }

  // Dependency-ordered so the publish stage sees prerequisites before their dependents.
  const prerequisites = graph.topologicalOrder([...prereqSet]);
  for (const name of prerequisites) targetSet.add(name);

  return { targets: explicitTargets, prerequisites, targetSet };
}
