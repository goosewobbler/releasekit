/**
 * Workspace dependency graph — the internal (workspace-member-to-workspace-member) dependency
 * relationships used to order publishes dependencies-first and, later, to derive prerequisite
 * release sets. Ecosystem-agnostic: callers resolve each ecosystem's edges to workspace package
 * names (npm dependency keys ∩ workspace; cargo `path:` deps resolved to crate names) and hand the
 * graph already-named edges.
 */

export type Ecosystem = 'npm' | 'cargo' | 'pub';

/**
 * One workspace package as input to {@link buildDependencyGraph}. `deps` is the package's declared
 * dependency identifiers (names); any that aren't themselves workspace members are ignored when the
 * graph is built, so callers may pass a superset.
 */
export interface GraphPackage {
  /** Canonical package name (npm name / crate name). */
  name: string;
  /** Absolute package directory. */
  dir: string;
  ecosystem: Ecosystem;
  /** Declared internal-dependency candidate names. Filtered to workspace members on build. */
  deps: string[];
}

export interface WorkspaceDependencyGraph {
  /** Direct internal dependencies of `name` (workspace members it depends on). */
  getInternalDependencies(name: string): Set<string>;
  /** Direct internal dependents of `name` (workspace members that depend on it). */
  getInternalDependents(name: string): Set<string>;
  /** Transitive closure of `name`'s internal dependencies, excluding `name` itself. */
  transitiveDependencies(name: string): Set<string>;
  /**
   * The given names ordered dependencies-first: a dependency always precedes anything that depends
   * on it. Names not in the graph are dropped; only edges among the given names are considered.
   * Cycle members can't be ordered — they are appended in input order so nothing is lost.
   */
  topologicalOrder(names: string[]): string[];
  /** True when the workspace graph contains at least one dependency cycle. */
  hasCycle(): boolean;
}

export function buildDependencyGraph(packages: GraphPackage[]): WorkspaceDependencyGraph {
  const known = new Set(packages.map((p) => p.name));
  const deps = new Map<string, Set<string>>();
  const dependents = new Map<string, Set<string>>();
  for (const p of packages) {
    if (!deps.has(p.name)) deps.set(p.name, new Set());
    if (!dependents.has(p.name)) dependents.set(p.name, new Set());
  }
  for (const p of packages) {
    for (const d of p.deps) {
      // Ignore self-edges and dependencies outside the workspace (the ∩-workspace filter).
      if (d === p.name || !known.has(d)) continue;
      deps.get(p.name)?.add(d);
      dependents.get(d)?.add(p.name);
    }
  }

  const getInternalDependencies = (name: string): Set<string> => new Set(deps.get(name) ?? []);
  const getInternalDependents = (name: string): Set<string> => new Set(dependents.get(name) ?? []);

  const transitiveDependencies = (name: string): Set<string> => {
    const out = new Set<string>();
    const stack = [...(deps.get(name) ?? [])];
    while (stack.length > 0) {
      const cur = stack.pop();
      if (cur === undefined || cur === name || out.has(cur)) continue;
      out.add(cur);
      for (const d of deps.get(cur) ?? []) stack.push(d);
    }
    return out;
  };

  const topologicalOrder = (names: string[]): string[] => {
    const subset = names.filter((n) => known.has(n));
    const inSubset = new Set(subset);
    const indegree = new Map<string, number>();
    for (const n of subset) {
      let degree = 0;
      for (const dep of deps.get(n) ?? []) if (inSubset.has(dep)) degree++;
      indegree.set(n, degree);
    }
    // Seed with nodes that have no in-subset dependencies, preserving input order for stability.
    const ready = subset.filter((n) => indegree.get(n) === 0);
    const result: string[] = [];
    const emitted = new Set<string>();
    while (ready.length > 0) {
      const n = ready.shift();
      if (n === undefined || emitted.has(n)) continue;
      result.push(n);
      emitted.add(n);
      for (const dependent of dependents.get(n) ?? []) {
        if (!inSubset.has(dependent) || emitted.has(dependent)) continue;
        const next = (indegree.get(dependent) ?? 1) - 1;
        indegree.set(dependent, next);
        if (next === 0) ready.push(dependent);
      }
    }
    // Cycle members never reach indegree 0 — append them in input order rather than dropping them.
    for (const n of subset) if (!emitted.has(n)) result.push(n);
    return result;
  };

  let cycle: boolean | undefined;
  const hasCycle = (): boolean => {
    if (cycle === undefined) {
      // A full toposort that can't emit every node has a cycle.
      const indegree = new Map<string, number>();
      for (const p of packages) indegree.set(p.name, deps.get(p.name)?.size ?? 0);
      const ready = packages.filter((p) => indegree.get(p.name) === 0).map((p) => p.name);
      let emittedCount = 0;
      while (ready.length > 0) {
        const n = ready.shift();
        if (n === undefined) break;
        emittedCount++;
        for (const dependent of dependents.get(n) ?? []) {
          const next = (indegree.get(dependent) ?? 1) - 1;
          indegree.set(dependent, next);
          if (next === 0) ready.push(dependent);
        }
      }
      cycle = emittedCount !== known.size;
    }
    return cycle;
  };

  return {
    getInternalDependencies,
    getInternalDependents,
    transitiveDependencies,
    topologicalOrder,
    hasCycle,
  };
}
