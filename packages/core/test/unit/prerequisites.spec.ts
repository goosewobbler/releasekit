import { describe, expect, it } from 'vitest';
import { buildDependencyGraph, type GraphPackage } from '../../src/dependencyGraph.js';
import { resolvePrerequisites } from '../../src/prerequisites.js';

function pkg(name: string, deps: string[]): GraphPackage {
  return { name, dir: `/ws/${name}`, ecosystem: 'npm', deps };
}

// core <- utils, core <- types, {utils,types} <- app
const graph = buildDependencyGraph([
  pkg('core', []),
  pkg('utils', ['core']),
  pkg('types', ['core']),
  pkg('app', ['utils', 'types']),
]);

describe('resolvePrerequisites', () => {
  it('should derive changed transitive deps as prerequisites, dependency-ordered', () => {
    const { targets, prerequisites, targetSet } = resolvePrerequisites(
      graph,
      ['app'],
      ['app', 'utils', 'types', 'core'],
    );
    expect(targets).toEqual(['app']);
    expect(new Set(prerequisites)).toEqual(new Set(['core', 'utils', 'types']));
    // core is depended on by utils + types, so it must come first.
    expect(prerequisites.indexOf('core')).toBeLessThan(prerequisites.indexOf('utils'));
    expect(prerequisites.indexOf('core')).toBeLessThan(prerequisites.indexOf('types'));
    expect(targetSet).toEqual(new Set(['app', 'utils', 'types', 'core']));
  });

  it('should skip dependencies that did not change', () => {
    const { prerequisites, targetSet } = resolvePrerequisites(graph, ['app'], ['app', 'utils']);
    expect(prerequisites).toEqual(['utils']);
    expect(targetSet).toEqual(new Set(['app', 'utils']));
  });

  it('should return no prerequisites when the target has no changed dependencies', () => {
    const { prerequisites, targetSet } = resolvePrerequisites(graph, ['app'], ['app']);
    expect(prerequisites).toEqual([]);
    expect(targetSet).toEqual(new Set(['app']));
  });

  it('should never count an explicit target as its own prerequisite', () => {
    const { prerequisites } = resolvePrerequisites(graph, ['app', 'utils'], ['app', 'utils', 'core']);
    expect(prerequisites).toEqual(['core']);
    expect(prerequisites).not.toContain('utils');
  });

  it('should order prerequisites by the full release graph when a prereq depends on a target', () => {
    // utils (a prerequisite) depends on core (an explicit target). The complete release order must
    // place core before utils — prerequisites must not be treated as "publish before the targets".
    const { targets, prerequisites, targetSet } = resolvePrerequisites(
      graph,
      ['core', 'app'],
      ['app', 'utils', 'core'],
    );
    expect(targets).toEqual(['core', 'app']);
    expect(prerequisites).toEqual(['utils']); // core is a target, so only utils is a derived prereq
    expect(targetSet).toEqual(new Set(['core', 'app', 'utils']));
    // The authoritative publish order is the topo-sort of the full release set: core before utils.
    const order = graph.topologicalOrder([...targetSet]);
    expect(order.indexOf('core')).toBeLessThan(order.indexOf('utils'));
  });

  it('should dedupe a prerequisite shared by multiple targets', () => {
    const { prerequisites } = resolvePrerequisites(graph, ['utils', 'types'], ['utils', 'types', 'core']);
    expect(prerequisites).toEqual(['core']);
  });

  it('should not throw and derive nothing for a target outside the graph', () => {
    const { targets, prerequisites } = resolvePrerequisites(graph, ['ghost'], ['ghost', 'core']);
    expect(targets).toEqual(['ghost']);
    expect(prerequisites).toEqual([]);
  });
});
