import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockLoadReleaseKitConfig = vi.fn();
const mockCreateOctokit = vi.fn();
const mockFindMergedPRsSinceLastRelease = vi.fn();
const mockFetchPRLabels = vi.fn();

vi.mock('@releasekit/config', () => ({
  loadConfig: (...args: unknown[]) => mockLoadReleaseKitConfig(...args),
  shouldProcessPackage: () => true,
  filterPackagesByConfig: () => [],
}));

vi.mock('@releasekit/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@releasekit/core')>();
  return {
    ...actual,
    shouldProcessPackage: () => true,
  };
});

vi.mock('node:child_process', () => ({
  execSync: vi.fn().mockReturnValue('feat: some feature\n'),
}));

vi.mock('../../src/preview-github.js', () => ({
  createOctokit: (...args: unknown[]) => mockCreateOctokit(...args),
  findMergedPRsSinceLastRelease: (...args: unknown[]) => mockFindMergedPRsSinceLastRelease(...args),
  fetchPRLabels: (...args: unknown[]) => mockFetchPRLabels(...args),
}));

vi.mock('../../src/release.js', () => ({
  resolveScopeToTarget: (scopeName: string, scopeLabels: Record<string, string>) => {
    const prefixed = `scope:${scopeName}`;
    if (scopeLabels[prefixed]) return scopeLabels[prefixed];
    if (scopeLabels[scopeName]) return scopeLabels[scopeName];
    throw new Error(`Scope "${scopeName}" not found`);
  },
  getHeadCommitMessage: vi.fn().mockReturnValue('feat: some feature\n'),
  getGitHubContext: () => {
    const repo = process.env.GITHUB_REPOSITORY;
    const sha = process.env.GITHUB_SHA;
    if (!repo || !sha) return null;
    const [owner, repoName] = repo.split('/');
    return { owner, repo: repoName ?? '', sha };
  },
  runRelease: vi.fn(),
}));

describe('Gate', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();

    mockLoadReleaseKitConfig.mockReturnValue({
      ci: {
        releaseTrigger: 'label',
        labels: {
          major: 'bump:major',
          minor: 'bump:minor',
          patch: 'bump:patch',
          stable: 'release:stable',
          prerelease: 'release:prerelease',
          skip: 'release:skip',
        },
      },
    });

    process.env.GITHUB_REPOSITORY = 'owner/repo';
    process.env.GITHUB_SHA = 'abc123';
    process.env.GITHUB_TOKEN = 'test-token';
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  async function runGate(opts: Record<string, unknown> = {}) {
    const { runGate: gateFn } = await import('../../src/gate.js');
    return gateFn({
      projectDir: '/test',
      ...opts,
    });
  }

  it('should return shouldRelease: true when bump:minor label present (label trigger mode)', async () => {
    mockFindMergedPRsSinceLastRelease.mockResolvedValue([123]);
    mockFetchPRLabels.mockResolvedValue(['bump:minor']);

    const result = await runGate();

    expect(result.shouldRelease).toBe(true);
    expect(result.bump).toBe('minor');
    expect(result.prNumbers).toEqual([123]);
    expect(result.labels).toContain('bump:minor');
  });

  it('should return shouldRelease: true when no release labels present (commit trigger mode)', async () => {
    mockLoadReleaseKitConfig.mockReturnValue({
      ci: {
        releaseTrigger: 'commit',
        labels: {
          major: 'bump:major',
          minor: 'bump:minor',
          patch: 'bump:patch',
          skip: 'release:skip',
        },
      },
    });
    mockFindMergedPRsSinceLastRelease.mockResolvedValue([123]);
    mockFetchPRLabels.mockResolvedValue(['feat: something']);

    const result = await runGate();

    expect(result.shouldRelease).toBe(true);
  });

  it('should return shouldRelease: false when no bump/release labels present (label trigger mode)', async () => {
    mockFindMergedPRsSinceLastRelease.mockResolvedValue([123]);
    mockFetchPRLabels.mockResolvedValue(['enhancement']);

    const result = await runGate();

    expect(result.shouldRelease).toBe(false);
    expect(result.reason).toContain('No release labels found');
  });

  it('should return shouldRelease: false when release:skip label present (commit trigger mode)', async () => {
    mockLoadReleaseKitConfig.mockReturnValue({
      ci: {
        releaseTrigger: 'commit',
        labels: {
          major: 'bump:major',
          minor: 'bump:minor',
          patch: 'bump:patch',
          skip: 'release:skip',
        },
      },
    });
    mockFindMergedPRsSinceLastRelease.mockResolvedValue([123]);
    mockFetchPRLabels.mockResolvedValue(['release:skip']);

    const result = await runGate();

    expect(result.shouldRelease).toBe(false);
    expect(result.reason).toContain('release:skip');
  });

  it('should return blocked: true when bump:major + bump:minor conflict', async () => {
    mockFindMergedPRsSinceLastRelease.mockResolvedValue([123]);
    mockFetchPRLabels.mockResolvedValue(['bump:major', 'bump:minor']);

    const result = await runGate();

    expect(result.blocked).toBe(true);
    expect(result.shouldRelease).toBe(false);
  });

  it('should return blocked: true when release:prerelease + release:stable conflict', async () => {
    mockFindMergedPRsSinceLastRelease.mockResolvedValue([123]);
    mockFetchPRLabels.mockResolvedValue(['release:prerelease', 'release:stable']);

    const result = await runGate();

    expect(result.blocked).toBe(true);
    expect(result.shouldRelease).toBe(false);
  });

  it('should resolve bump from bump:major label', async () => {
    mockFindMergedPRsSinceLastRelease.mockResolvedValue([123]);
    mockFetchPRLabels.mockResolvedValue(['bump:major']);

    const result = await runGate();

    expect(result.bump).toBe('major');
  });

  it('should resolve bump from bump:patch label', async () => {
    mockFindMergedPRsSinceLastRelease.mockResolvedValue([123]);
    mockFetchPRLabels.mockResolvedValue(['bump:patch']);

    const result = await runGate();

    expect(result.bump).toBe('patch');
  });

  it('should return bump undefined when only release:stable label', async () => {
    mockFindMergedPRsSinceLastRelease.mockResolvedValue([123]);
    mockFetchPRLabels.mockResolvedValue(['release:stable']);

    const result = await runGate();

    expect(result.shouldRelease).toBe(true);
    expect(result.bump).toBeUndefined();
    expect(result.stable).toBe(true);
  });

  it('should return stable: false when only bump:patch label', async () => {
    mockFindMergedPRsSinceLastRelease.mockResolvedValue([123]);
    mockFetchPRLabels.mockResolvedValue(['bump:patch']);

    const result = await runGate();

    expect(result.shouldRelease).toBe(true);
    expect(result.bump).toBe('patch');
    expect(result.stable).toBe(false);
  });

  it('should return stable: true when bump:patch and release:stable labels present (stable takes precedence over bump)', async () => {
    mockFindMergedPRsSinceLastRelease.mockResolvedValue([123]);
    mockFetchPRLabels.mockResolvedValue(['bump:patch', 'release:stable']);

    const result = await runGate();

    expect(result.shouldRelease).toBe(true);
    // release:stable causes detectBumpFromLabels to return undefined (auto-detect from commits)
    expect(result.bump).toBeUndefined();
    expect(result.stable).toBe(true);
  });

  it('should return stable: false when release:stable and release:prerelease conflict', async () => {
    mockFindMergedPRsSinceLastRelease.mockResolvedValue([123]);
    mockFetchPRLabels.mockResolvedValue(['release:stable', 'release:prerelease']);

    const result = await runGate();

    expect(result.blocked).toBe(true);
    expect(result.stable).toBe(false);
  });

  it('should resolve scope via --scope flag', async () => {
    mockLoadReleaseKitConfig.mockReturnValue({
      ci: {
        releaseTrigger: 'label',
        labels: {
          major: 'bump:major',
          minor: 'bump:minor',
          patch: 'bump:patch',
        },
        scopeLabels: {
          'scope:electron': '@wdio/electron-*',
          'scope:tauri': '@wdio/tauri-*',
        },
      },
    });
    mockFindMergedPRsSinceLastRelease.mockResolvedValue([123]);
    mockFetchPRLabels.mockResolvedValue(['bump:minor']);

    const result = await runGate({ scope: 'electron' });

    expect(result.scope).toBe('electron');
    expect(result.target).toBe('@wdio/electron-*');
  });

  it('should resolve scope from PR scope labels when no --scope flag', async () => {
    mockLoadReleaseKitConfig.mockReturnValue({
      ci: {
        releaseTrigger: 'label',
        labels: {
          major: 'bump:major',
          minor: 'bump:minor',
          patch: 'bump:patch',
        },
        scopeLabels: {
          'scope:electron': '@wdio/electron-*',
        },
      },
    });
    mockFindMergedPRsSinceLastRelease.mockResolvedValue([123]);
    mockFetchPRLabels.mockResolvedValue(['bump:minor', 'scope:electron']);

    const result = await runGate();

    expect(result.scope).toBe('electron');
    expect(result.target).toBe('@wdio/electron-*');
  });

  it('should return shouldRelease: false when HEAD commit matches skipPatterns', async () => {
    const { getHeadCommitMessage } = await import('../../src/release.js');
    vi.mocked(getHeadCommitMessage).mockReturnValue('chore: release v1.0.0 [skip ci]\n');
    mockLoadReleaseKitConfig.mockReturnValue({
      ci: {
        releaseTrigger: 'label',
        labels: {
          major: 'bump:major',
          minor: 'bump:minor',
          patch: 'bump:patch',
        },
      },
      release: {
        ci: {
          skipPatterns: ['chore: release', '[skip ci]'],
        },
      },
    });
    mockFindMergedPRsSinceLastRelease.mockResolvedValue([123]);
    mockFetchPRLabels.mockResolvedValue(['bump:minor']);

    const result = await runGate();

    expect(result.shouldRelease).toBe(false);
    expect(result.reason).toContain('skip pattern');
  });

  it('should throw with clear error when releaseStrategy is standing-pr', async () => {
    mockLoadReleaseKitConfig.mockReturnValue({
      ci: { releaseStrategy: 'standing-pr' },
    });

    await expect(runGate()).rejects.toThrow('standing-pr');
  });

  it('should throw with clear error when releaseStrategy is scheduled', async () => {
    mockLoadReleaseKitConfig.mockReturnValue({
      ci: { releaseStrategy: 'scheduled' },
    });

    await expect(runGate()).rejects.toThrow('scheduled');
  });

  it('should return shouldRelease: false with reason when no GitHub context', async () => {
    delete process.env.GITHUB_REPOSITORY;
    delete process.env.GITHUB_SHA;

    const result = await runGate();

    expect(result.shouldRelease).toBe(false);
    expect(result.reason).toContain('No GitHub context');
  });

  it('should return shouldRelease: false with reason when no GITHUB_TOKEN', async () => {
    delete process.env.GITHUB_TOKEN;

    const result = await runGate();

    expect(result.shouldRelease).toBe(false);
    expect(result.reason).toContain('No GITHUB_TOKEN');
  });

  it('should populate prNumbers from merged PRs', async () => {
    mockFindMergedPRsSinceLastRelease.mockResolvedValue([123, 456]);
    mockFetchPRLabels.mockResolvedValue(['bump:minor']);

    const result = await runGate();

    expect(result.prNumbers).toEqual([123, 456]);
  });

  it('should aggregate labels across multiple merged PRs', async () => {
    mockFindMergedPRsSinceLastRelease.mockResolvedValue([123, 456]);
    mockFetchPRLabels.mockResolvedValueOnce(['bump:minor', 'scope:electron']).mockResolvedValueOnce(['enhancement']);

    const result = await runGate();

    expect(result.labels).toContain('bump:minor');
    expect(result.labels).toContain('scope:electron');
    expect(result.labels).toContain('enhancement');
  });
});
