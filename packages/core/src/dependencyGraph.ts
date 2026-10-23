export type Ecosystem = 'npm' | 'cargo' | 'pub';

export interface GraphPackage {
  name: string;
  /** Absolute package directory. */
  dir: string;
  ecosystem: Ecosystem;
  /**
   * Package names, already resolved by the caller (e.g. cargo `path:` deps to crate names). Non-members are ignored,
   * so a superset is fine.
   */
  deps: string[];
}

export interface WorkspaceDependencyGraph {
  getInternalDependencies(name: string): Set<string>;
  getInternalDependents(name: string): Set<string>;
  /** Excludes `name` itself. */
  transitiveDependencies(name: string): Set<string>;
  /**
   * Dependencies first. Names not in the graph are dropped, and only edges among the given names count. Cycle members
   * are appended in input order rather than dropped.
   */
  topologicalOrder(names: string[]): string[];
  hasCycle(): boolean;
}

export function buildDependencyGraph(packages: GraphPackage[]): WorkspaceDependencyGraph {
  const known = new Set(packages.map((p) => p.name));
  const deps = new Map<string, Set<string>>();
  const dependents = new Map<string, Set<string>>();
  for (const p of packages) {
    if (!deps.has(p.name)) {
      deps.set(p.name, new Set());
    }
    if (!dependents.has(p.name)) {
      dependents.set(p.name, new Set());
    }
  }
  for (const p of packages) {
    for (const d of p.deps) {
      if (d === p.name || !known.has(d)) {
        continue;
      }
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
      if (cur === undefined || cur === name || out.has(cur)) {
        continue;
      }
      out.add(cur);
      for (const d of deps.get(cur) ?? []) {
        stack.push(d);
      }
    }
    return out;
  };

  const topologicalOrder = (names: string[]): string[] => {
    const subset = names.filter((n) => known.has(n));
    const inSubset = new Set(subset);
    const indegree = new Map<string, number>();
    for (const n of subset) {
      let degree = 0;
      for (const dep of deps.get(n) ?? []) {
        if (inSubset.has(dep)) {
          degree++;
        }
      }
      indegree.set(n, degree);
    }
    // Input order is preserved for a stable result.
    const ready = subset.filter((n) => indegree.get(n) === 0);
    const result: string[] = [];
    const emitted = new Set<string>();
    while (ready.length > 0) {
      const n = ready.shift();
      if (n === undefined || emitted.has(n)) {
        continue;
      }
      result.push(n);
      emitted.add(n);
      for (const dependent of dependents.get(n) ?? []) {
        if (!inSubset.has(dependent) || emitted.has(dependent)) {
          continue;
        }
        const next = (indegree.get(dependent) ?? 1) - 1;
        indegree.set(dependent, next);
        if (next === 0) {
          ready.push(dependent);
        }
      }
    }
    for (const n of subset) {
      if (!emitted.has(n)) {
        result.push(n);
      }
    }
    return result;
  };

  let cycle: boolean | undefined;
  const hasCycle = (): boolean => {
    if (cycle === undefined) {
      const indegree = new Map<string, number>();
      for (const p of packages) {
        indegree.set(p.name, deps.get(p.name)?.size ?? 0);
      }
      const ready = packages.filter((p) => indegree.get(p.name) === 0).map((p) => p.name);
      let emittedCount = 0;
      while (ready.length > 0) {
        const n = ready.shift();
        if (n === undefined) {
          break;
        }
        emittedCount++;
        for (const dependent of dependents.get(n) ?? []) {
          const next = (indegree.get(dependent) ?? 1) - 1;
          indegree.set(dependent, next);
          if (next === 0) {
            ready.push(dependent);
          }
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
