import type { CIConfig } from '@releasekit/config';
import { describe, expect, it, vi } from 'vitest';
import { checkLabels, deriveLabelDefinitions, type LabelDefinition, syncLabels } from '../../src/label-definitions.js';

// A fully-defaulted CIConfig.labels block (mirrors CILabelsConfigSchema defaults). Tests build
// on this so a rename only has to override the field under test.
const DEFAULT_LABELS_CONFIG = {
  stable: 'channel:stable',
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
    prPreview: true,
    autoRelease: false,
    skipPatterns: ['chore: release '],
    minChanges: 1,
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
        'channel:stable',
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
});

function mockOctokitForCreate(failures: Record<string, number> = {}) {
  const createLabel = vi.fn(async ({ name }: { name: string }) => {
    const status = failures[name];
    if (status) {
      const err = new Error(`HTTP ${status}`) as Error & { status: number };
      err.status = status;
      throw err;
    }
    return { data: {} };
  });
  return { rest: { issues: { createLabel } }, _createLabel: createLabel };
}

describe('syncLabels', () => {
  it('should create every definition that does not already exist', async () => {
    const octokit = mockOctokitForCreate();
    const defs: LabelDefinition[] = [
      { name: 'bump:minor', color: '0e8a16', description: 'x' },
      { name: 'release:skip', color: 'd93f0b', description: 'y' },
    ];

    const result = await syncLabels(octokit as never, 'owner', 'repo', defs);

    expect(result.created).toEqual(['bump:minor', 'release:skip']);
    expect(result.existing).toEqual([]);
    expect(octokit._createLabel).toHaveBeenCalledTimes(2);
  });

  it('should treat a 422 as already-existing and not as a failure (idempotent)', async () => {
    const octokit = mockOctokitForCreate({ 'bump:minor': 422 });
    const defs: LabelDefinition[] = [
      { name: 'bump:minor', color: '0e8a16', description: 'x' },
      { name: 'release:skip', color: 'd93f0b', description: 'y' },
    ];

    const result = await syncLabels(octokit as never, 'owner', 'repo', defs);

    expect(result.existing).toEqual(['bump:minor']);
    expect(result.created).toEqual(['release:skip']);
  });

  it('should rethrow non-422 errors (e.g. auth/rate-limit)', async () => {
    const octokit = mockOctokitForCreate({ 'bump:minor': 403 });
    const defs: LabelDefinition[] = [{ name: 'bump:minor', color: '0e8a16', description: 'x' }];

    await expect(syncLabels(octokit as never, 'owner', 'repo', defs)).rejects.toThrow('HTTP 403');
  });
});

function mockOctokitForList(existing: string[]) {
  const listLabelsForRepo = vi.fn();
  const iterator = vi.fn().mockReturnValue({
    async *[Symbol.asyncIterator]() {
      yield { data: existing.map((name) => ({ name })) };
    },
  });
  return { paginate: { iterator }, rest: { issues: { listLabelsForRepo } } };
}

describe('checkLabels', () => {
  it('should report all labels missing when the repo has none', async () => {
    const octokit = mockOctokitForList([]);
    const defs: LabelDefinition[] = [
      { name: 'bump:minor', color: '0e8a16', description: 'x' },
      { name: 'release:skip', color: 'd93f0b', description: 'y' },
    ];

    const { missing, present } = await checkLabels(octokit as never, 'owner', 'repo', defs);

    expect(missing).toEqual(['bump:minor', 'release:skip']);
    expect(present).toEqual([]);
  });

  it('should report only the missing subset', async () => {
    const octokit = mockOctokitForList(['bump:minor']);
    const defs: LabelDefinition[] = [
      { name: 'bump:minor', color: '0e8a16', description: 'x' },
      { name: 'release:skip', color: 'd93f0b', description: 'y' },
    ];

    const { missing, present } = await checkLabels(octokit as never, 'owner', 'repo', defs);

    expect(missing).toEqual(['release:skip']);
    expect(present).toEqual(['bump:minor']);
  });

  it('should report nothing missing when the repo is fully provisioned', async () => {
    const octokit = mockOctokitForList(['bump:minor', 'release:skip']);
    const defs: LabelDefinition[] = [
      { name: 'bump:minor', color: '0e8a16', description: 'x' },
      { name: 'release:skip', color: 'd93f0b', description: 'y' },
    ];

    const { missing } = await checkLabels(octokit as never, 'owner', 'repo', defs);

    expect(missing).toEqual([]);
  });
});
