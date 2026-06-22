import { describe, expect, it } from 'vitest';
import { applyOverrideScope } from '../../../src/core/versionCalculator.js';
import type { Config, VersionOptions } from '../../../src/types.js';

// A config carrying a forced override (bump major + prerelease + stable), optionally scoped.
const cfg = (overrideScope?: string[]): Config =>
  ({
    tagTemplate: '${prefix}${version}',
    preset: 'conventional',
    sync: false,
    packages: [],
    updateInternalDependencies: 'minor',
    versionPrefix: 'v',
    type: 'major',
    isPrerelease: true,
    stableOnly: true,
    overrideScope,
  }) as Config;

const opts = (name: string): VersionOptions => ({ latestTag: 'v1.0.0', name, versionPrefix: 'v', type: 'major' });

describe('applyOverrideScope', () => {
  it('should apply the override to every package when overrideScope is undefined', () => {
    const { config, options } = applyOverrideScope(cfg(undefined), opts('@scope/a'));
    expect(config.type).toBe('major');
    expect(config.isPrerelease).toBe(true);
    expect(config.stableOnly).toBe(true);
    expect(options.type).toBe('major');
  });

  it('should keep the override for a package that matches overrideScope', () => {
    const { config, options } = applyOverrideScope(cfg(['@scope/*']), opts('@scope/a'));
    expect(config.type).toBe('major');
    expect(config.isPrerelease).toBe(true);
    expect(config.stableOnly).toBe(true);
    expect(options.type).toBe('major');
  });

  it('should strip the override for a package outside overrideScope so it computes commit-driven', () => {
    const { config, options } = applyOverrideScope(cfg(['@scope/a']), opts('@other/b'));
    expect(config.type).toBeUndefined();
    expect(config.isPrerelease).toBeUndefined();
    expect(config.stableOnly).toBeUndefined();
    expect(options.type).toBeUndefined();
  });

  it('should apply the override when the package has no name (single-package repo)', () => {
    const { config, options } = applyOverrideScope(cfg(['@scope/a']), {
      latestTag: 'v1.0.0',
      versionPrefix: 'v',
      type: 'major',
    });
    expect(config.type).toBe('major');
    expect(config.isPrerelease).toBe(true);
    expect(options.type).toBe('major');
  });

  it('should not mutate the input config (returns a scoped copy)', () => {
    const input = cfg(['@scope/a']);
    applyOverrideScope(input, opts('@other/b'));
    expect(input.type).toBe('major');
    expect(input.isPrerelease).toBe(true);
  });

  it('should treat an empty overrideScope as "all packages"', () => {
    const { config } = applyOverrideScope(cfg([]), opts('@other/b'));
    expect(config.type).toBe('major');
  });
});
