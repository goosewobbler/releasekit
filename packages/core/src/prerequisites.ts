import type { WorkspaceDependencyGraph } from './dependencyGraph.js';

export interface PrerequisiteResolution {
  /** The only packages that receive a bump/prerelease/stable override. */
  targets: string[];
  /**
   * Transitive internal dependencies of the targets that also changed, excluding the targets themselves. Not a
   * "publish these before the targets" list: a prerequisite can depend on a target, so publish in
   * `topologicalOrder([...targetSet])`.
   */
  prerequisites: string[];
  /** Everything that will release: targets ∪ prerequisites. */
  targetSet: Set<string>;
  prerequisiteOf: Record<string, string[]>;
}

/** `explicitTargets` must already be group-expanded. */
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
      if (changed.has(dep) && !targetSet.has(dep)) {
        prereqSet.add(dep);
        prerequisiteOf[dep] = [...(prerequisiteOf[dep] ?? []), target];
      }
    }
  }
  for (const name of prereqSet) {
    targetSet.add(name);
  }

  // Sort the full release set, then filter: sorting the prerequisites alone would miss a prerequisite's edge to a
  // target, which must sort first.
  const prerequisites = graph.topologicalOrder([...targetSet]).filter((name) => prereqSet.has(name));

  return { targets: [...explicitTargets], prerequisites, targetSet, prerequisiteOf };
}
