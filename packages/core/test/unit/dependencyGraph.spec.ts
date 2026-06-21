import { describe, expect, it } from 'vitest';
import { buildDependencyGraph, type GraphPackage } from '../../src/dependencyGraph.js';

function pkg(name: string, deps: string[], ecosystem: GraphPackage['ecosystem'] = 'npm'): GraphPackage {
  return { name, dir: `/ws/${name}`, ecosystem, deps };
}

// core <- utils, core <- types, {utils,types} <- app; `left-pad` is an external (non-workspace) dep.
const workspace: GraphPackage[] = [
  pkg('core', []),
  pkg('utils', ['core']),
  pkg('types', ['core']),
  pkg('app', ['utils', 'types', 'left-pad']),
];

describe('buildDependencyGraph', () => {
  it('should expose direct internal dependencies and dependents', () => {
    const g = buildDependencyGraph(workspace);
    expect([...g.getInternalDependencies('app')].sort()).toEqual(['types', 'utils']);
    expect([...g.getInternalDependents('core')].sort()).toEqual(['types', 'utils']);
    expect(g.getInternalDependencies('core').size).toBe(0);
    expect(g.getInternalDependents('app').size).toBe(0);
  });

  it('should ignore dependencies that are not workspace members', () => {
    const g = buildDependencyGraph(workspace);
    expect(g.getInternalDependencies('app').has('left-pad')).toBe(false);
  });

  it('should ignore self-dependencies', () => {
    const g = buildDependencyGraph([pkg('a', ['a', 'b']), pkg('b', [])]);
    expect([...g.getInternalDependencies('a')]).toEqual(['b']);
    expect(g.hasCycle()).toBe(false);
  });

  it('should compute the transitive dependency closure excluding self', () => {
    const g = buildDependencyGraph(workspace);
    expect([...g.transitiveDependencies('app')].sort()).toEqual(['core', 'types', 'utils']);
    expect(g.transitiveDependencies('core').size).toBe(0);
  });

  it('should order names dependencies-first', () => {
    const g = buildDependencyGraph(workspace);
    const order = g.topologicalOrder(['app', 'core', 'utils', 'types']);
    const idx = (n: string) => order.indexOf(n);
    expect(order).toHaveLength(4);
    expect(idx('core')).toBeLessThan(idx('utils'));
    expect(idx('core')).toBeLessThan(idx('types'));
    expect(idx('utils')).toBeLessThan(idx('app'));
    expect(idx('types')).toBeLessThan(idx('app'));
  });

  it('should only consider edges among the requested names in topologicalOrder', () => {
    // app depends on core only transitively (via utils/types) — with those excluded there is no
    // direct edge, so both are roots and the subset is returned intact.
    const g = buildDependencyGraph(workspace);
    expect(g.topologicalOrder(['app', 'core']).sort()).toEqual(['app', 'core']);
  });

  it('should drop names that are not in the graph', () => {
    const g = buildDependencyGraph(workspace);
    const order = g.topologicalOrder(['app', 'ghost', 'core']);
    expect(order).not.toContain('ghost');
    expect(order).toHaveLength(2);
  });

  it('should order a mixed npm + cargo workspace dependencies-first', () => {
    const g = buildDependencyGraph([
      pkg('core-rs', [], 'cargo'),
      pkg('plugin-rs', ['core-rs'], 'cargo'),
      pkg('app', ['plugin-rs'], 'npm'),
    ]);
    const order = g.topologicalOrder(['app', 'plugin-rs', 'core-rs']);
    expect(order.indexOf('core-rs')).toBeLessThan(order.indexOf('plugin-rs'));
    expect(order.indexOf('plugin-rs')).toBeLessThan(order.indexOf('app'));
  });

  describe('cycles', () => {
    it('should report a cycle via hasCycle', () => {
      const g = buildDependencyGraph([pkg('a', ['b']), pkg('b', ['c']), pkg('c', ['a'])]);
      expect(g.hasCycle()).toBe(true);
    });

    it('should append cycle members without dropping or hanging', () => {
      const g = buildDependencyGraph([pkg('a', ['b']), pkg('b', ['c']), pkg('c', ['a'])]);
      expect(g.topologicalOrder(['a', 'b', 'c']).sort()).toEqual(['a', 'b', 'c']);
    });

    it('should report no cycle for an acyclic graph', () => {
      expect(buildDependencyGraph(workspace).hasCycle()).toBe(false);
    });
  });
});
