import { describe, expect, it } from 'vitest';
import {
  composeBumpFromLabels,
  DEFAULT_LABELS,
  graduatedPackageFromLabel,
  graduatePackageLabel,
  isGraduatePackageLabel,
} from '../../src/label-utils.js';

describe('composeBumpFromLabels', () => {
  it('should return the magnitude when only a bump label is present', () => {
    expect(composeBumpFromLabels(['bump:major'])).toBe('major');
    expect(composeBumpFromLabels(['bump:minor'])).toBe('minor');
    expect(composeBumpFromLabels(['bump:patch'])).toBe('patch');
  });

  it('should compose a pre* bump when a bump label accompanies the prerelease channel', () => {
    expect(composeBumpFromLabels(['bump:major', 'channel:prerelease'])).toBe('premajor');
    expect(composeBumpFromLabels(['bump:minor', 'channel:prerelease'])).toBe('preminor');
    expect(composeBumpFromLabels(['bump:patch', 'channel:prerelease'])).toBe('prepatch');
  });

  it('should return prerelease when the prerelease channel is present with no magnitude (iterate an existing line)', () => {
    // This 'prerelease' return is only consumed in commit-trigger mode (via evaluatePR). In
    // label-trigger mode the gate rejects prerelease-alone (shouldRelease: false) before it ever
    // reaches the version engine, and the standing-PR path keeps it commit-driven — so the value
    // is meaningful, but which path acts on it is context-dependent.
    expect(composeBumpFromLabels(['channel:prerelease'])).toBe('prerelease');
  });

  it('should return undefined when release:graduate is present (graduation is bump-less), even with a bump label', () => {
    expect(composeBumpFromLabels(['release:graduate'])).toBeUndefined();
    expect(composeBumpFromLabels(['release:graduate', 'bump:major'])).toBeUndefined();
  });

  it('should return undefined when no bump or channel labels are present', () => {
    expect(composeBumpFromLabels([])).toBeUndefined();
    expect(composeBumpFromLabels(['release', 'area:ci'])).toBeUndefined();
  });

  it('should prefer major over minor over patch when several magnitudes are present', () => {
    // Conflict detection lives in detectLabelConflicts; this helper just composes deterministically.
    expect(composeBumpFromLabels(['bump:patch', 'bump:minor', 'bump:major'])).toBe('major');
    expect(composeBumpFromLabels(['bump:patch', 'bump:minor', 'bump:major', 'channel:prerelease'])).toBe('premajor');
  });

  it('should honour renamed labels from a custom LabelConfig', () => {
    const labels = { ...DEFAULT_LABELS, major: 'bump/major', prerelease: 'release:prerelease' };
    expect(composeBumpFromLabels(['bump/major', 'release:prerelease'], labels)).toBe('premajor');
  });
});

describe('per-package graduate labels (#486)', () => {
  it('should build a graduate:<package> label from a package name', () => {
    expect(graduatePackageLabel('@scope/pkg')).toBe('graduate:@scope/pkg');
  });

  it('should recognise a per-package graduate label', () => {
    expect(isGraduatePackageLabel('graduate:@scope/pkg')).toBe(true);
    expect(isGraduatePackageLabel('graduate:core')).toBe(true);
  });

  it('should not treat the bare prefix, the whole-batch graduate, or unrelated labels as per-package', () => {
    expect(isGraduatePackageLabel('graduate:')).toBe(false);
    expect(isGraduatePackageLabel('release:graduate')).toBe(false);
    expect(isGraduatePackageLabel('bump:major')).toBe(false);
  });

  it('should extract the package name from a per-package graduate label, undefined otherwise', () => {
    expect(graduatedPackageFromLabel('graduate:@scope/pkg')).toBe('@scope/pkg');
    expect(graduatedPackageFromLabel('release:graduate')).toBeUndefined();
    expect(graduatedPackageFromLabel('graduate:')).toBeUndefined();
  });

  it('should honour a renamed graduatePackagePrefix', () => {
    const labels = { ...DEFAULT_LABELS, graduatePackagePrefix: 'promote/' };
    expect(graduatePackageLabel('@scope/pkg', labels)).toBe('promote/@scope/pkg');
    expect(isGraduatePackageLabel('promote/@scope/pkg', labels)).toBe(true);
    expect(graduatedPackageFromLabel('promote/@scope/pkg', labels)).toBe('@scope/pkg');
    // The default prefix no longer matches when renamed.
    expect(isGraduatePackageLabel('graduate:@scope/pkg', labels)).toBe(false);
  });

  it('should fall back to the default prefix when a partial config omits it', () => {
    const partial = { graduate: 'release:graduate' };
    expect(graduatePackageLabel('core', partial)).toBe('graduate:core');
    expect(isGraduatePackageLabel('graduate:core', partial)).toBe(true);
  });
});
