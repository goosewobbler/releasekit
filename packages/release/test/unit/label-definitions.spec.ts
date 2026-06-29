import type { CIConfig } from '@releasekit/config';
import { createFakeForge } from '@releasekit/forge';
import { describe, expect, it, vi } from 'vitest';
import { checkLabels, deriveLabelDefinitions, type LabelDefinition, syncLabels } from '../../src/label-definitions.js';

// A fully-defaulted CIConfig.labels block (mirrors CILabelsConfigSchema defaults). Tests build
// on this so a rename only has to override the field under test.
const DEFAULT_LABELS_CONFIG = {
  graduate: 'release:graduate',
  prerelease: 'channel:prerelease',
  skip: 'release:skip',
  immediate: 'release:immediate',
  retry: 'release:retry',
  major: 'bump:major',
  minor: 'bump:minor',
  patch: 'bump:patch',
};

function ciConfig(overrides: Partial<CIConfig> = {}): CIConfig {
  return {
    releaseStrategy: 'direct',
    releaseTrigger: 'label',
    prPreview: { enabled: true, refreshAfterRelease: false },
    labels: DEFAULT_LABELS_CONFIG,
    ...overrides,
  } as CIConfig;
}

function names(defs: LabelDefinition[]): string[] {
  return defs.map((d) => d.name);
}

describe('deriveLabelDefinitions', () => {
  it('should include every default label when config is undefined', () => {
    const defs = deriveLabelDefinitions(undefined);
    expect(names(defs)).toEqual(
      expect.arrayContaining([
        'bump:patch',
        'bump:minor',
        'bump:major',
        'release:graduate',
        'channel:prerelease',
        'release:skip',
        'release:immediate',
        'release:retry',
        'release', // default standing-PR label
      ]),
    );
  });

  it('should give every definition a name, color, and description', () => {
    const defs = deriveLabelDefinitions(undefined);
    for (const def of defs) {
      expect(def.name).toBeTruthy();
      expect(def.color).toMatch(/^[0-9a-f]{6}$/);
      expect(def.description.length).toBeGreaterThan(0);
    }
  });

  it('should honor ci.labels renames', () => {
    const defs = deriveLabelDefinitions(ciConfig({ labels: { ...DEFAULT_LABELS_CONFIG, minor: 'semver:minor' } }));
    expect(names(defs)).toContain('semver:minor');
    expect(names(defs)).not.toContain('bump:minor');
  });

  it('should include configured scope labels from ci.scopeLabels', () => {
    const defs = deriveLabelDefinitions(
      ciConfig({ scopeLabels: { 'scope:frontend': 'packages/web', 'scope:backend': 'packages/api' } }),
    );
    expect(names(defs)).toContain('scope:frontend');
    expect(names(defs)).toContain('scope:backend');
  });

  it('should include the configured standing-PR labels', () => {
    const config = ciConfig({ standingPr: { labels: ['release', 'queued'] } } as Partial<CIConfig>);
    const defs = deriveLabelDefinitions(config);
    expect(names(defs)).toContain('release');
    expect(names(defs)).toContain('queued');
  });

  it('should dedupe when a scope label collides with a reserved label name', () => {
    const defs = deriveLabelDefinitions(ciConfig({ scopeLabels: { 'bump:minor': 'packages/web' } }));
    const minorCount = names(defs).filter((n) => n === 'bump:minor').length;
    expect(minorCount).toBe(1);
  });

  it('should dedupe duplicate standing-PR labels', () => {
    const config = ciConfig({ standingPr: { labels: ['release', 'release'] } } as Partial<CIConfig>);
    const defs = deriveLabelDefinitions(config);
    const releaseCount = names(defs).filter((n) => n === 'release').length;
    expect(releaseCount).toBe(1);
  });

  it('should seed a graduate:<package> label for each graduatable package (#486)', () => {
    const defs = deriveLabelDefinitions(ciConfig(), ['@scope/a', '@scope/b']);
    expect(names(defs)).toContain('graduate:@scope/a');
    expect(names(defs)).toContain('graduate:@scope/b');
    // The fixed whole-batch graduate label is still present and distinct.
    expect(names(defs)).toContain('release:graduate');
  });

  it('should emit no per-package graduate labels when no graduatable packages are passed (#486)', () => {
    const defs = deriveLabelDefinitions(ciConfig());
    expect(names(defs).some((n) => n.startsWith('graduate:'))).toBe(false);
  });

  it('should honour a renamed graduatePackagePrefix when seeding per-package graduate labels (#486)', () => {
    const config = ciConfig({
      labels: { ...DEFAULT_LABELS_CONFIG, graduatePackagePrefix: 'promote/' },
    } as Partial<CIConfig>);
    const defs = deriveLabelDefinitions(config, ['@scope/a']);
    expect(names(defs)).toContain('promote/@scope/a');
  });
});

describe('syncLabels', () => {
  it('should create every definition that does not already exist', async () => {
    const forge = createFakeForge();
    const defs: LabelDefinition[] = [
      { name: 'bump:minor', color: '0e8a16', description: 'x' },
      { name: 'release:skip', color: 'd93f0b', description: 'y' },
    ];

    const result = await syncLabels(forge, defs);

    expect(result.created).toEqual(['bump:minor', 'release:skip']);
    expect(result.existing).toEqual([]);
    expect(forge.createdLabels).toHaveLength(2);
  });

  it('should treat a 422 with already_exists error code as idempotent', async () => {
    // The forge resolves an already-existing label to 'exists' (the raw-422 'already_exists'
    // detection now lives in the GitHubForge adapter). Seed the existing label to reproduce it.
    const forge = createFakeForge({ labelNames: ['bump:minor'] });
    const defs: LabelDefinition[] = [
      { name: 'bump:minor', color: '0e8a16', description: 'x' },
      { name: 'release:skip', color: 'd93f0b', description: 'y' },
    ];

    const result = await syncLabels(forge, defs);

    expect(result.existing).toEqual(['bump:minor']);
    expect(result.created).toEqual(['release:skip']);
  });

  it('should rethrow 422 validation errors (e.g. label name too long) so the caller sees the real failure', async () => {
    const forge = createFakeForge();
    vi.spyOn(forge, 'createLabel').mockRejectedValueOnce(Object.assign(new Error('HTTP 422'), { status: 422 }));
    const defs: LabelDefinition[] = [
      { name: 'scope:very-long-feature-area-name-that-exceeds-the-limit', color: '5319e7', description: 'x' },
    ];

    await expect(syncLabels(forge, defs)).rejects.toThrow('HTTP 422');
  });

  it('should rethrow 422 errors without a structured body as a real failure', async () => {
    const forge = createFakeForge();
    vi.spyOn(forge, 'createLabel').mockRejectedValueOnce(Object.assign(new Error('HTTP 422'), { status: 422 }));
    const defs: LabelDefinition[] = [{ name: 'bump:minor', color: '0e8a16', description: 'x' }];

    await expect(syncLabels(forge, defs)).rejects.toThrow('HTTP 422');
  });

  it('should rethrow non-422 errors (e.g. auth/rate-limit)', async () => {
    const forge = createFakeForge();
    vi.spyOn(forge, 'createLabel').mockRejectedValueOnce(Object.assign(new Error('HTTP 403'), { status: 403 }));
    const defs: LabelDefinition[] = [{ name: 'bump:minor', color: '0e8a16', description: 'x' }];

    await expect(syncLabels(forge, defs)).rejects.toThrow('HTTP 403');
  });
});

describe('checkLabels', () => {
  it('should report all labels missing when the repo has none', async () => {
    const forge = createFakeForge({ labelNames: [] });
    const defs: LabelDefinition[] = [
      { name: 'bump:minor', color: '0e8a16', description: 'x' },
      { name: 'release:skip', color: 'd93f0b', description: 'y' },
    ];

    const { missing, present } = await checkLabels(forge, defs);

    expect(missing).toEqual(['bump:minor', 'release:skip']);
    expect(present).toEqual([]);
  });

  it('should report only the missing subset', async () => {
    const forge = createFakeForge({ labelNames: ['bump:minor'] });
    const defs: LabelDefinition[] = [
      { name: 'bump:minor', color: '0e8a16', description: 'x' },
      { name: 'release:skip', color: 'd93f0b', description: 'y' },
    ];

    const { missing, present } = await checkLabels(forge, defs);

    expect(missing).toEqual(['release:skip']);
    expect(present).toEqual(['bump:minor']);
  });

  it('should report nothing missing when the repo is fully provisioned', async () => {
    const forge = createFakeForge({ labelNames: ['bump:minor', 'release:skip'] });
    const defs: LabelDefinition[] = [
      { name: 'bump:minor', color: '0e8a16', description: 'x' },
      { name: 'release:skip', color: 'd93f0b', description: 'y' },
    ];

    const { missing } = await checkLabels(forge, defs);

    expect(missing).toEqual([]);
  });
});
