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

// Per-package graduation (#486): `graduateScope` gates ONLY the `stableOnly` graduation, leaving any
// bump/prerelease the run also carries intact. A graduate config carries stableOnly (no other override).
const gradCfg = (graduateScope?: string[]): Config =>
  ({
    tagTemplate: '${prefix}${version}',
    preset: 'conventional',
    sync: false,
    packages: [],
    versionPrefix: 'v',
    stableOnly: true,
    graduateScope,
  }) as Config;

describe('applyOverrideScope — graduateScope (#486)', () => {
  it('should keep stableOnly for a package inside graduateScope', () => {
    const { config } = applyOverrideScope(gradCfg(['@scope/a']), opts('@scope/a'));
    expect(config.stableOnly).toBe(true);
  });

  it('should clear stableOnly for a package outside graduateScope so it stays on its line', () => {
    const { config } = applyOverrideScope(gradCfg(['@scope/a']), opts('@other/b'));
    expect(config.stableOnly).toBeUndefined();
  });

  it('should graduate every package when graduateScope is undefined (global graduate)', () => {
    const { config } = applyOverrideScope(gradCfg(undefined), opts('@other/b'));
    expect(config.stableOnly).toBe(true);
  });

  it('should leave a bump override intact when gating an out-of-scope package (graduate is bump-less)', () => {
    // stableOnly + graduateScope + a forced bump: the out-of-scope package loses graduation but keeps
    // the bump, so it advances along its line rather than graduating.
    const config = { ...gradCfg(['@scope/a']), type: 'minor' } as Config;
    const { config: scoped, options } = applyOverrideScope(config, opts('@other/b'));
    expect(scoped.stableOnly).toBeUndefined();
    expect(scoped.type).toBe('minor');
    expect(options.type).toBe('major'); // options.type from opts() is untouched by graduateScope gating
  });

  it('should not mutate the input config', () => {
    const input = gradCfg(['@scope/a']);
    applyOverrideScope(input, opts('@other/b'));
    expect(input.stableOnly).toBe(true);
  });
});
