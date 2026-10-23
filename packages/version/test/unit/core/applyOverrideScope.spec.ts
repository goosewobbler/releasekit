import { describe, expect, it } from 'vitest';
import { applyOverrideScope } from '../../../src/core/versionCalculator.js';
import type { Config, VersionOptions } from '../../../src/types.js';

const cfg = (overrideScope?: string[]): Config =>
  ({
    tagTemplate: '${prefix}${version}',
    preset: 'conventionalcommits',
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

// graduateScope gates only the stableOnly graduation, leaving any bump/prerelease the run carries intact.
const gradCfg = (graduateScope?: string[]): Config =>
  ({
    tagTemplate: '${prefix}${version}',
    preset: 'conventionalcommits',
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
    const config = { ...gradCfg(['@scope/a']), type: 'minor' } as Config;
    const { config: scoped, options } = applyOverrideScope(config, opts('@other/b'));
    expect(scoped.stableOnly).toBeUndefined();
    expect(scoped.type).toBe('minor');
    expect(options.type).toBe('major'); // from opts(), untouched by graduateScope gating
  });

  it('should not mutate the input config', () => {
    const input = gradCfg(['@scope/a']);
    applyOverrideScope(input, opts('@other/b'));
    expect(input.stableOnly).toBe(true);
  });
});

// `release:with-prerequisites` scopes the bump override to the explicit targets (overrideScope), while
// `graduate:<pkg>` can target a transitive prerequisite outside it, so graduateScope must win for stableOnly.
const comboCfg = (): Config =>
  ({
    tagTemplate: '${prefix}${version}',
    preset: 'conventionalcommits',
    sync: false,
    packages: [],
    versionPrefix: 'v',
    stableOnly: true,
    overrideScope: ['@scope/target'],
    graduateScope: ['@scope/prereq'],
  }) as Config;

describe('applyOverrideScope — graduateScope + overrideScope combo (#486)', () => {
  it('should keep stableOnly for a graduated prerequisite outside overrideScope', () => {
    const { config } = applyOverrideScope(comboCfg(), opts('@scope/prereq'));
    expect(config.stableOnly).toBe(true);
    // Graduation is bump-less, so losing the override is fine.
    expect(config.type).toBeUndefined();
    expect(config.isPrerelease).toBeUndefined();
  });

  it('should clear stableOnly for a non-graduated prerequisite outside both scopes (stays on its line)', () => {
    const { config } = applyOverrideScope(comboCfg(), opts('@scope/other-prereq'));
    expect(config.stableOnly).toBeUndefined();
  });

  it('should clear stableOnly for an in-overrideScope target that was not graduated', () => {
    const { config } = applyOverrideScope(comboCfg(), opts('@scope/target'));
    expect(config.stableOnly).toBeUndefined();
  });
});

// prereleaseScope is graduateScope's twin: it gates only the isPrerelease shift, which is folded in from
// runOptions.prereleaseScope.
const preCfg = (prereleaseScope?: string[]): Config =>
  ({
    tagTemplate: '${prefix}${version}',
    preset: 'conventionalcommits',
    sync: false,
    packages: [],
    versionPrefix: 'v',
    isPrerelease: true,
    prereleaseScope,
  }) as Config;

describe('applyOverrideScope — prereleaseScope (#521)', () => {
  it('should keep isPrerelease for a package inside prereleaseScope', () => {
    const { config } = applyOverrideScope(preCfg(['@scope/a']), opts('@scope/a'));
    expect(config.isPrerelease).toBe(true);
  });

  it('should clear isPrerelease for a package outside prereleaseScope so it stays on its projected line', () => {
    const { config } = applyOverrideScope(preCfg(['@scope/a']), opts('@other/b'));
    expect(config.isPrerelease).toBeUndefined();
  });

  it('should prerelease every package when prereleaseScope is undefined (global channel:prerelease)', () => {
    const { config } = applyOverrideScope(preCfg(undefined), opts('@other/b'));
    expect(config.isPrerelease).toBe(true);
  });

  it('should treat an empty prereleaseScope as "all packages"', () => {
    const { config } = applyOverrideScope(preCfg([]), opts('@other/b'));
    expect(config.isPrerelease).toBe(true);
  });

  it('should not mutate the input config', () => {
    const input = preCfg(['@scope/a']);
    applyOverrideScope(input, opts('@other/b'));
    expect(input.isPrerelease).toBe(true);
  });

  it('should re-assert isPrerelease for an in-prereleaseScope package that sits outside overrideScope', () => {
    // prereleaseScope membership must survive the overrideScope clearing, as graduateScope does.
    const config = { ...preCfg(['@scope/pre']), overrideScope: ['@scope/target'], type: 'minor' } as Config;
    const { config: scoped } = applyOverrideScope(config, opts('@scope/pre'));
    expect(scoped.isPrerelease).toBe(true);
    // The prerelease shift stays commit-driven.
    expect(scoped.type).toBeUndefined();
  });
});
