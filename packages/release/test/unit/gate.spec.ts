import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockLoadReleaseKitConfig = vi.fn();
const mockCreateOctokit = vi.fn();
const mockFindMergedPRsSinceLastRelease = vi.fn();
const mockFetchPRLabels = vi.fn();
const mockPostOrUpdateComment = vi.fn();

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

vi.mock('../../src/github.js', () => ({
  createOctokit: (...args: unknown[]) => mockCreateOctokit(...args),
  findMergedPRsSinceLastRelease: (...args: unknown[]) => mockFindMergedPRsSinceLastRelease(...args),
  fetchPRLabels: (...args: unknown[]) => mockFetchPRLabels(...args),
  postOrUpdateComment: (...args: unknown[]) => mockPostOrUpdateComment(...args),
}));

vi.mock('../../src/release.js', () => ({
  resolveScopeToTarget: (scopeName: string, scopeLabels: Record<string, string>) => {
    const prefixed = `scope:${scopeName}`;
    if (scopeLabels[prefixed]) return scopeLabels[prefixed];
    if (scopeLabels[scopeName]) return scopeLabels[scopeName];
    throw new Error(`Scope "${scopeName}" not found`);
  },
  runRelease: vi.fn(),
}));

vi.mock('../../src/git.js', () => ({
  getHeadCommitMessage: vi.fn().mockReturnValue('feat: some feature\n'),
  getGitHubContext: () => {
    const repo = process.env.GITHUB_REPOSITORY;
    const sha = process.env.GITHUB_SHA;
    const token = process.env.GITHUB_TOKEN;
    if (!repo) return null;
    const [owner, repoName] = repo.split('/');
    return { owner, repo: repoName ?? '', sha: sha ?? null, token: token ?? null };
  },
  matchesSkipPattern: (msg: string, patterns: string[]) => patterns.find((p) => msg.includes(p)),
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
    const { runGate: gateFn } = await import('../../src/gate/gate.js');
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

  it('should return shouldRelease: false and not notify when only release:skip label (label trigger mode)', async () => {
    mockFindMergedPRsSinceLastRelease.mockResolvedValue([123]);
    mockFetchPRLabels.mockResolvedValue(['release:skip']);

    const result = await runGate();

    expect(result.shouldRelease).toBe(false);
    expect(mockPostOrUpdateComment).not.toHaveBeenCalled();
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
    const { getHeadCommitMessage } = await import('../../src/git.js');
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

  it('should return only the winning PR labels (no cross-PR union)', async () => {
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
        scopeLabels: {
          'scope:electron': '@wdio/electron-*',
        },
      },
    });
    // Newer PR (123) has the bump label; older PR (456) has only an unrelated label.
    // git-log order is newest-first, so 123 should win and 456 must NOT contaminate.
    mockFindMergedPRsSinceLastRelease.mockResolvedValue([123, 456]);
    mockFetchPRLabels.mockResolvedValueOnce(['bump:minor', 'scope:electron']).mockResolvedValueOnce(['enhancement']);

    const result = await runGate();

    expect(result.shouldRelease).toBe(true);
    expect(result.labels).toContain('bump:minor');
    expect(result.labels).toContain('scope:electron');
    // Critical: labels from the non-winning PR must not appear in the winning verdict.
    expect(result.labels).not.toContain('enhancement');
  });

  describe('per-PR evaluation — wdio-desktop-mobile #225 + #224 regression', () => {
    // PR #225 merged with `release:prerelease` + `scope:tauri` (no bump:*) — gate must block.
    // PR #224 merged later with `bump:minor` + `scope:utils` — gate must release #224 alone.
    // Before this fix: gate unioned the labels and produced `preminor` for `@wdio/native-utils`.
    // After: per-PR evaluation, #225's labels are ignored, #224 wins cleanly with `minor`.
    const fullConfig = {
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
        scopeLabels: {
          'scope:utils': '@wdio/native-utils',
          'scope:tauri': '@wdio/tauri-*',
        },
      },
    };

    it('does not produce preminor when an older prerelease-only PR is in the window', async () => {
      mockLoadReleaseKitConfig.mockReturnValue(fullConfig);
      // git-log order is newest-first: #224 (winner) before #225 (insufficient).
      mockFindMergedPRsSinceLastRelease.mockResolvedValue([224, 225]);
      mockFetchPRLabels
        .mockResolvedValueOnce(['bump:minor', 'scope:utils']) // #224
        .mockResolvedValueOnce(['release:prerelease', 'scope:tauri']); // #225

      const result = await runGate({ notify: false });

      expect(result.shouldRelease).toBe(true);
      expect(result.bump).toBe('minor');
      expect(result.bump).not.toBe('preminor');
      expect(result.target).toBe('@wdio/native-utils');
      expect(result.scope).toBe('utils');
      // #225's prerelease label must not contaminate the verdict.
      expect(result.labels).not.toContain('release:prerelease');
      expect(result.labels).not.toContain('scope:tauri');
    });

    it('exposes per-PR evaluations for both PRs', async () => {
      mockLoadReleaseKitConfig.mockReturnValue(fullConfig);
      mockFindMergedPRsSinceLastRelease.mockResolvedValue([224, 225]);
      mockFetchPRLabels
        .mockResolvedValueOnce(['bump:minor', 'scope:utils'])
        .mockResolvedValueOnce(['release:prerelease', 'scope:tauri']);

      const result = await runGate({ notify: false });

      expect(result.evaluations).toHaveLength(2);
      const winning = result.evaluations?.find((e) => e.prNumber === 224);
      const skipped = result.evaluations?.find((e) => e.prNumber === 225);
      expect(winning?.shouldRelease).toBe(true);
      expect(skipped?.shouldRelease).toBe(false);
      expect(skipped?.reason).toContain('release:prerelease');
      expect(skipped?.hasReleaseIntent).toBe(true);
    });

    it('posts a notify comment on the prerelease-only PR but not the winner', async () => {
      mockLoadReleaseKitConfig.mockReturnValue(fullConfig);
      mockFindMergedPRsSinceLastRelease.mockResolvedValue([224, 225]);
      mockFetchPRLabels
        .mockResolvedValueOnce(['bump:minor', 'scope:utils'])
        .mockResolvedValueOnce(['release:prerelease', 'scope:tauri']);

      await runGate(); // notify defaults to true

      // Notify is only posted on PR #225 (insufficient labels with intent),
      // never on the winning PR #224.
      expect(mockPostOrUpdateComment).toHaveBeenCalledTimes(1);
      const [, owner, repo, prNumber, body, marker] = mockPostOrUpdateComment.mock.calls[0];
      expect(owner).toBe('owner');
      expect(repo).toBe('repo');
      expect(prNumber).toBe(225);
      expect(body).toContain('did not trigger a release');
      expect(body).toContain('release:prerelease');
      expect(marker).toBe('<!-- releasekit-gate-notify -->');
    });

    it('does not post notify when notify=false', async () => {
      mockLoadReleaseKitConfig.mockReturnValue(fullConfig);
      mockFindMergedPRsSinceLastRelease.mockResolvedValue([224, 225]);
      mockFetchPRLabels
        .mockResolvedValueOnce(['bump:minor', 'scope:utils'])
        .mockResolvedValueOnce(['release:prerelease', 'scope:tauri']);

      await runGate({ notify: false });

      expect(mockPostOrUpdateComment).not.toHaveBeenCalled();
    });
  });

  describe('notify — silence on PRs without release intent', () => {
    it('does not post notify when a PR has only unrelated labels', async () => {
      mockFindMergedPRsSinceLastRelease.mockResolvedValue([1, 2]);
      mockFetchPRLabels
        .mockResolvedValueOnce(['bump:minor']) // #1: winner
        .mockResolvedValueOnce(['enhancement', 'documentation']); // #2: no release intent

      await runGate();

      // PR #1 wins (no notify). PR #2 has no release-intent labels (no notify).
      expect(mockPostOrUpdateComment).not.toHaveBeenCalled();
    });

    it('posts notify on a single PR with conflicting bump labels', async () => {
      mockFindMergedPRsSinceLastRelease.mockResolvedValue([42]);
      mockFetchPRLabels.mockResolvedValueOnce(['bump:major', 'bump:minor']);

      const result = await runGate();

      expect(result.blocked).toBe(true);
      expect(mockPostOrUpdateComment).toHaveBeenCalledTimes(1);
      const [, , , prNumber, body] = mockPostOrUpdateComment.mock.calls[0];
      expect(prNumber).toBe(42);
      expect(body).toContain('conflicting');
      expect(body).toContain('bump:major');
      expect(body).toContain('bump:minor');
    });

    it('does not post notify on commit-mode release:skip (intentional skip, not user error)', async () => {
      mockLoadReleaseKitConfig.mockReturnValue({
        ci: {
          releaseTrigger: 'commit',
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
      mockFindMergedPRsSinceLastRelease.mockResolvedValue([1]);
      mockFetchPRLabels.mockResolvedValueOnce(['release:skip']);

      await runGate();

      expect(mockPostOrUpdateComment).not.toHaveBeenCalled();
    });
  });
});
