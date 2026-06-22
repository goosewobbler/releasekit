import type { Package } from '@manypkg/get-packages';
import { buildDependencyGraph, type GraphPackage } from '@releasekit/core';
import { describe, expect, it } from 'vitest';
import { resolvePrerequisiteTargets } from '../../../src/core/prerequisiteScope.js';
import type { Config } from '../../../src/types.js';

function pkg(name: string): Package {
  return { dir: `/ws/${name}`, relativeDir: name, packageJson: { name, version: '1.0.0' } } as unknown as Package;
}
function gpkg(name: string, deps: string[]): GraphPackage {
  return { name, dir: `/ws/${name}`, ecosystem: 'npm', deps };
}
const baseConfig = (overrides: Partial<Config> = {}): Config =>
  ({
    sync: false,
    preset: 'conventional',
    packages: [],
    tagTemplate: '',
    updateInternalDependencies: 'minor',
    versionPrefix: '',
    ...overrides,
  }) as Config;

// core <- utils, core <- types, {utils,types} <- app
const packages = [pkg('core'), pkg('utils'), pkg('types'), pkg('app')];
const graph = buildDependencyGraph([
  gpkg('core', []),
  gpkg('utils', ['core']),
  gpkg('types', ['core']),
  gpkg('app', ['utils', 'types']),
]);

describe('resolvePrerequisiteTargets', () => {
  it('should pull changed transitive deps in as targets while scoping the override to the explicit target', () => {
    const result = resolvePrerequisiteTargets(graph, packages, baseConfig(), ['app'], () => true);
    expect(new Set(result.targets)).toEqual(new Set(['app', 'utils', 'types', 'core']));
    expect(result.overrideScope).toEqual(['app']);
  });

  it('should not pull in unchanged dependencies', () => {
    const result = resolvePrerequisiteTargets(graph, packages, baseConfig(), ['app'], (n) => n === 'utils');
    expect(new Set(result.targets)).toEqual(new Set(['app', 'utils']));
    expect(result.overrideScope).toEqual(['app']);
  });

  it('should expand an explicit target to its whole group for the override scope', () => {
    const config = baseConfig({ groups: { g: { packages: ['app', 'utils'], sync: 'fixed' } } });
    const result = resolvePrerequisiteTargets(graph, packages, config, ['app'], () => false);
    expect(new Set(result.overrideScope)).toEqual(new Set(['app', 'utils']));
    expect(new Set(result.targets)).toEqual(new Set(['app', 'utils']));
  });

  it('should derive prerequisites from the group-expanded target set', () => {
    const config = baseConfig({ groups: { g: { packages: ['app', 'utils'], sync: 'fixed' } } });
    const result = resolvePrerequisiteTargets(graph, packages, config, ['app'], (n) => n === 'core');
    expect(new Set(result.targets)).toEqual(new Set(['app', 'utils', 'core']));
    expect(new Set(result.overrideScope)).toEqual(new Set(['app', 'utils']));
    expect(result.targets).not.toContain('types');
  });
});
