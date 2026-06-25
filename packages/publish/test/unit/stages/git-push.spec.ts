import { createFakeGit, type FakeGit, type FakeGitSeed } from '@releasekit/git';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDefaultConfig } from '../../../src/config.js';
import { PublishError } from '../../../src/errors/index.js';
import { pushPackageTag, runGitPushStage } from '../../../src/stages/git-push.js';
import type { PipelineContext } from '../../../src/types.js';

// Drive the stage through a seeded FakeGit. `createGitCli()` resolves to the fake we seed per test,
// so we can assert on its `pushed` recorder and seeded reads (`remoteUrl`, `currentBranch`).
let fakeGit: FakeGit;
vi.mock('@releasekit/git', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@releasekit/git')>();
  return {
    ...actual,
    createGitCli: () => fakeGit,
  };
});

vi.mock('../../../src/utils/auth.js', () => ({
  detectGitPushMethod: vi.fn().mockResolvedValue('https'),
}));

function seedGit(seed: FakeGitSeed = {}): void {
  fakeGit = createFakeGit({ currentBranch: 'main', ...seed });
}

function createContext(overrides?: Partial<PipelineContext>): PipelineContext {
  return {
    input: { dryRun: false, updates: [], changelogs: [], tags: [] },
    config: getDefaultConfig(),
    cliOptions: {
      registry: 'all',
      npmAuth: 'auto',
      dryRun: false,
      skipGit: false,
      skipPublish: false,
      skipGithubRelease: false,
      skipVerification: false,

      json: false,
      verbose: false,
    },
    cwd: '/test/project',
    packageManager: 'pnpm',
    output: {
      dryRun: false,
      git: { committed: true, tags: ['v1.0.0'], pushed: false },
      npm: [],
      cargo: [],
      verification: [],
      githubReleases: [],
    },
    ...overrides,
  };
}

describe('git-push stage', () => {
  const savedGithubToken = process.env.GITHUB_TOKEN;

  beforeEach(async () => {
    vi.clearAllMocks();
    seedGit();
    const { detectGitPushMethod } = await import('../../../src/utils/auth.js');
    vi.mocked(detectGitPushMethod).mockResolvedValue('https');
    delete process.env.GITHUB_TOKEN;
  });

  afterEach(() => {
    if (savedGithubToken !== undefined) {
      process.env.GITHUB_TOKEN = savedGithubToken;
    } else {
      delete process.env.GITHUB_TOKEN;
    }
  });

  it('should push commits and tags', async () => {
    const ctx = createContext();

    await runGitPushStage(ctx);

    // branch push then tags push, both to the plain remote name.
    expect(fakeGit.pushed).toEqual([
      expect.objectContaining({ remote: 'origin', ref: 'main' }),
      expect.objectContaining({ remote: 'origin', tags: true }),
    ]);
    expect(ctx.output.git.pushed).toBe(true);
  });

  it('should push using authed GitHub URL when httpsTokenEnv is configured', async () => {
    process.env.GITHUB_TOKEN = 'gh_test_token';
    seedGit({ remoteUrls: { origin: 'https://github.com/org/repo.git' } });

    const config = getDefaultConfig();
    config.git.httpsTokenEnv = 'GITHUB_TOKEN';
    const ctx = createContext({ config });
    await runGitPushStage(ctx);

    const authedUrl = 'https://x-access-token:gh_test_token@github.com/org/repo.git';
    // Both pushes target the authed URL as the remote.
    expect(fakeGit.pushed[0]).toEqual(expect.objectContaining({ remote: authedUrl, ref: 'main' }));
    expect(fakeGit.pushed[1]).toEqual(expect.objectContaining({ remote: authedUrl, tags: true }));
  });

  it('should not attempt token auth when httpsTokenEnv is not configured', async () => {
    process.env.GITHUB_TOKEN = 'gh_test_token';

    const ctx = createContext(); // default config has httpsTokenEnv: undefined
    await runGitPushStage(ctx);

    // No remoteUrl read happened (no authed rewrite); pushes target the plain remote name.
    expect(fakeGit.pushed).toEqual([
      expect.objectContaining({ remote: 'origin', ref: 'main' }),
      expect.objectContaining({ remote: 'origin', tags: true }),
    ]);
  });

  it('should fall back to plain remote for non-GitHub HTTPS URLs', async () => {
    process.env.MY_TOKEN = 'some_token';
    seedGit({ remoteUrls: { origin: 'https://gitlab.example.com/org/repo.git' } });

    const config = getDefaultConfig();
    config.git.httpsTokenEnv = 'MY_TOKEN';
    const ctx = createContext({ config });
    await runGitPushStage(ctx);

    expect(fakeGit.pushed).toEqual([
      expect.objectContaining({ remote: 'origin', ref: 'main' }),
      expect.objectContaining({ remote: 'origin', tags: true }),
    ]);

    delete process.env.MY_TOKEN;
  });

  it('should detect current branch when config.git.branch is not set', async () => {
    seedGit({ currentBranch: 'feature/my-branch' });
    const ctx = createContext();
    await runGitPushStage(ctx);

    expect(fakeGit.pushed[0]).toEqual(expect.objectContaining({ remote: 'origin', ref: 'feature/my-branch' }));
  });

  it('should throw a clear error when in detached HEAD state', async () => {
    seedGit({ currentBranch: 'HEAD' });
    const ctx = createContext();

    await expect(runGitPushStage(ctx)).rejects.toThrow(/detached HEAD/);
  });

  it('should propagate a detached-HEAD PublishError without re-wrapping it', async () => {
    seedGit({ currentBranch: 'HEAD' });
    const ctx = createContext();

    let thrown: unknown;
    try {
      await runGitPushStage(ctx);
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(PublishError);
    // Message must not be double-wrapped (e.g. "Failed to push to remote: ... detached HEAD ...")
    expect((thrown as PublishError).message).toMatch(/detached HEAD/);
    expect((thrown as PublishError).message).not.toMatch(/Failed to push to remote.*Failed to push to remote/);
  });

  it('should use explicit branch from config without resolving the current branch', async () => {
    const config = getDefaultConfig();
    config.git.branch = 'release/v2';
    const ctx = createContext({ config });

    // Make currentBranch throw so we prove it is never consulted.
    const currentBranchSpy = vi.spyOn(fakeGit, 'currentBranch').mockRejectedValue(new Error('should not be called'));

    await runGitPushStage(ctx);

    expect(fakeGit.pushed[0]).toEqual(expect.objectContaining({ remote: 'origin', ref: 'release/v2' }));
    expect(currentBranchSpy).not.toHaveBeenCalled();
  });

  it('should skip when push disabled in config', async () => {
    const config = getDefaultConfig();
    config.git.push = false;
    const ctx = createContext({ config });

    await runGitPushStage(ctx);

    expect(fakeGit.pushed).toHaveLength(0);
    expect(ctx.output.git.pushed).toBe(false);
  });

  it('should skip when nothing to push', async () => {
    const ctx = createContext({
      output: {
        dryRun: false,
        git: { committed: false, tags: [], pushed: false },
        npm: [],
        cargo: [],
        verification: [],
        githubReleases: [],
      },
    });

    await runGitPushStage(ctx);

    expect(fakeGit.pushed).toHaveLength(0);
  });

  it('should only push tags when no commit', async () => {
    const ctx = createContext({
      output: {
        dryRun: false,
        git: { committed: false, tags: ['v1.0.0'], pushed: false },
        npm: [],
        cargo: [],
        verification: [],
        githubReleases: [],
      },
    });

    // Branch resolution (currentBranch) must NOT run — branch is only needed when pushing commits.
    const currentBranchSpy = vi.spyOn(fakeGit, 'currentBranch');

    await runGitPushStage(ctx);

    expect(fakeGit.pushed).toEqual([expect.objectContaining({ remote: 'origin', tags: true })]);
    expect(currentBranchSpy).not.toHaveBeenCalled();
  });

  it('should not throw when in detached HEAD state and there are only tags to push', async () => {
    seedGit({ currentBranch: 'HEAD' });
    const ctx = createContext({
      output: {
        dryRun: false,
        git: { committed: false, tags: ['v1.0.0'], pushed: false },
        npm: [],
        cargo: [],
        verification: [],
        githubReleases: [],
      },
    });

    await expect(runGitPushStage(ctx)).resolves.not.toThrow();
    expect(ctx.output.git.pushed).toBe(true);
  });

  it('should NOT execute any git push in dry-run, but still mark output pushed', async () => {
    const ctx = createContext({
      cliOptions: {
        registry: 'all',
        npmAuth: 'auto',
        dryRun: true,
        skipGit: false,
        skipPublish: false,
        skipGithubRelease: false,
        skipVerification: false,

        json: false,
        verbose: false,
      },
    });

    await runGitPushStage(ctx);

    // The dry-run guard short-circuits before the FakeGit push op runs.
    expect(fakeGit.pushed).toHaveLength(0);
    expect(ctx.output.git.pushed).toBe(true);
  });
});

describe('pushPackageTag', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    seedGit();
    const { detectGitPushMethod } = await import('../../../src/utils/auth.js');
    vi.mocked(detectGitPushMethod).mockResolvedValue('https');
  });

  it('should push the specific tag ref and then the branch', async () => {
    const ctx = createContext();

    await pushPackageTag('pkg-a@v1.0.0', ctx);

    // tag push first, then branch push.
    expect(fakeGit.pushed).toEqual([
      expect.objectContaining({ remote: 'origin', ref: 'refs/tags/pkg-a@v1.0.0' }),
      expect.objectContaining({ remote: 'origin', ref: 'main' }),
    ]);
    expect(ctx.output.git.tags).toContain('pkg-a@v1.0.0');
    expect(ctx.output.git.pushed).toBe(true);
  });

  it('should wrap a branch-push failure as GIT_PUSH_ERROR, not unknown (#429)', async () => {
    // The branch push is rejected by a branch ruleset — a raw seam failure.
    vi.spyOn(fakeGit, 'push').mockImplementation(async (opts) => {
      if (opts.ref === 'main') {
        throw new Error('Command failed: git push origin main\nremote: error: GH013: rule violations');
      }
    });

    let thrown: unknown;
    try {
      await pushPackageTag('@scope/pkg@v1.0.0', createContext());
    } catch (err) {
      thrown = err;
    }

    // Must be a GIT_PUSH_ERROR so inferStageName labels the report `git-push` (not `unknown`),
    // and the remote's message is preserved.
    expect(thrown).toBeInstanceOf(PublishError);
    expect((thrown as PublishError).code).toBe('GIT_PUSH_ERROR');
    expect((thrown as PublishError).message).toContain('git push origin main');
  });

  it('should skip branch push when not committed', async () => {
    const ctx = createContext({
      output: {
        dryRun: false,
        git: { committed: false, tags: [], pushed: false },
        npm: [],
        cargo: [],
        verification: [],
        githubReleases: [],
      },
    });

    await pushPackageTag('pkg-a@v1.0.0', ctx);

    expect(fakeGit.pushed).toEqual([expect.objectContaining({ remote: 'origin', ref: 'refs/tags/pkg-a@v1.0.0' })]);
    expect(ctx.output.git.pushed).toBe(true);
  });

  it('should accumulate pushed tags on ctx.output.git.tags', async () => {
    const ctx = createContext({
      output: {
        dryRun: false,
        git: { committed: false, tags: [], pushed: false },
        npm: [],
        cargo: [],
        verification: [],
        githubReleases: [],
      },
    });

    await pushPackageTag('pkg-a@v1.0.0', ctx);
    await pushPackageTag('pkg-b@v1.0.0', ctx);

    expect(ctx.output.git.tags).toEqual(['pkg-a@v1.0.0', 'pkg-b@v1.0.0']);
  });

  it('should be a no-op when config.git.push is false', async () => {
    const config = getDefaultConfig();
    config.git.push = false;
    const ctx = createContext({ config });

    await pushPackageTag('pkg-a@v1.0.0', ctx);

    expect(fakeGit.pushed).toHaveLength(0);
    expect(ctx.output.git.pushed).toBe(false);
  });

  it('should throw on detached HEAD when committed is true', async () => {
    seedGit({ currentBranch: 'HEAD' });
    const ctx = createContext();
    await expect(pushPackageTag('pkg-a@v1.0.0', ctx)).rejects.toThrow(/detached HEAD/);
  });

  it('should NOT execute any git push in dry-run', async () => {
    const ctx = createContext({
      cliOptions: {
        registry: 'all',
        npmAuth: 'auto',
        dryRun: true,
        skipGit: false,
        skipPublish: false,
        skipGithubRelease: false,
        skipVerification: false,

        json: false,
        verbose: false,
      },
    });

    await pushPackageTag('pkg-a@v1.0.0', ctx);

    expect(fakeGit.pushed).toHaveLength(0);
    expect(ctx.output.git.pushed).toBe(true);
  });
});
