import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDefaultConfig } from '../../../src/config.js';
import { runGitPushStage } from '../../../src/stages/git-push.js';
import type { PipelineContext } from '../../../src/types.js';

vi.mock('../../../src/utils/exec.js', () => ({
  execCommand: vi.fn().mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 }),
}));

vi.mock('../../../src/utils/auth.js', () => ({
  detectGitPushMethod: vi.fn().mockResolvedValue('https'),
}));

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
  beforeEach(async () => {
    vi.clearAllMocks();
    const { execCommand } = await import('../../../src/utils/exec.js');
    const { detectGitPushMethod } = await import('../../../src/utils/auth.js');
    vi.mocked(execCommand).mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 });
    vi.mocked(detectGitPushMethod).mockResolvedValue('https');
    delete process.env.GITHUB_TOKEN;
  });

  it('should push commits and tags', async () => {
    const { execCommand } = await import('../../../src/utils/exec.js');
    const ctx = createContext();

    await runGitPushStage(ctx);

    expect(execCommand).toHaveBeenCalledTimes(2);
    const calls = vi.mocked(execCommand).mock.calls;
    expect(calls[0]?.[0]).toBe('git');
    expect(calls[0]?.[1]).toEqual(['push', 'origin', 'main']);
    expect(calls[1]?.[0]).toBe('git');
    expect(calls[1]?.[1]).toEqual(['push', 'origin', '--tags']);
    expect(ctx.output.git.pushed).toBe(true);
  });

  it('should push using authed GitHub URL when https token is available', async () => {
    const { execCommand } = await import('../../../src/utils/exec.js');
    process.env.GITHUB_TOKEN = 'gh_test_token';

    vi.mocked(execCommand).mockImplementation(async (file, args) => {
      if (file === 'git' && Array.isArray(args) && args[0] === 'remote' && args[1] === 'get-url') {
        return { stdout: 'https://github.com/org/repo.git\n', stderr: '', exitCode: 0 };
      }
      return { stdout: '', stderr: '', exitCode: 0 };
    });

    const ctx = createContext();
    await runGitPushStage(ctx);

    const calls = vi.mocked(execCommand).mock.calls;
    // First call should be remote get-url, then push branch, then push tags.
    expect(calls[0]?.[1]).toEqual(['remote', 'get-url', 'origin']);
    expect(calls[1]?.[1]?.[0]).toBe('push');
    expect((calls[1]?.[1] as string[])[1]).toContain('https://x-access-token:gh_test_token@github.com/org/repo.git');
    expect((calls[2]?.[1] as string[])[1]).toContain('https://x-access-token:gh_test_token@github.com/org/repo.git');
  });

  it('should skip when push disabled in config', async () => {
    const { execCommand } = await import('../../../src/utils/exec.js');
    const config = getDefaultConfig();
    config.git.push = false;
    const ctx = createContext({ config });

    await runGitPushStage(ctx);

    expect(execCommand).not.toHaveBeenCalled();
    expect(ctx.output.git.pushed).toBe(false);
  });

  it('should skip when nothing to push', async () => {
    const { execCommand } = await import('../../../src/utils/exec.js');
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

    expect(execCommand).not.toHaveBeenCalled();
  });

  it('should only push tags when no commit', async () => {
    const { execCommand } = await import('../../../src/utils/exec.js');
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

    await runGitPushStage(ctx);

    expect(execCommand).toHaveBeenCalledTimes(1);
    expect(vi.mocked(execCommand).mock.calls[0]?.[0]).toBe('git');
    expect(vi.mocked(execCommand).mock.calls[0]?.[1]).toContain('--tags');
  });
});
