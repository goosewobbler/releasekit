import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDefaultConfig } from '../../../src/config.js';
import { PublishError } from '../../../src/errors/index.js';
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
  const savedGithubToken = process.env.GITHUB_TOKEN;

  beforeEach(async () => {
    vi.clearAllMocks();
    const { execCommand } = await import('../../../src/utils/exec.js');
    const { detectGitPushMethod } = await import('../../../src/utils/auth.js');
    vi.mocked(execCommand).mockImplementation(async (_file, args) => {
      if (Array.isArray(args) && args[0] === 'rev-parse') {
        return { stdout: 'main\n', stderr: '', exitCode: 0 };
      }
      return { stdout: '', stderr: '', exitCode: 0 };
    });
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
    const { execCommand } = await import('../../../src/utils/exec.js');
    const ctx = createContext();

    await runGitPushStage(ctx);

    expect(execCommand).toHaveBeenCalledTimes(3); // rev-parse + push branch + push tags
    const calls = vi.mocked(execCommand).mock.calls;
    expect(calls[0]?.[1]).toEqual(['rev-parse', '--abbrev-ref', 'HEAD']);
    expect(calls[1]?.[0]).toBe('git');
    expect(calls[1]?.[1]).toEqual(['push', 'origin', 'main']);
    expect(calls[2]?.[0]).toBe('git');
    expect(calls[2]?.[1]).toEqual(['push', 'origin', '--tags']);
    expect(ctx.output.git.pushed).toBe(true);
  });

  it('should push using authed GitHub URL when httpsTokenEnv is configured', async () => {
    const { execCommand } = await import('../../../src/utils/exec.js');
    process.env.GITHUB_TOKEN = 'gh_test_token';

    vi.mocked(execCommand).mockImplementation(async (file, args) => {
      if (Array.isArray(args) && args[0] === 'rev-parse') {
        return { stdout: 'main\n', stderr: '', exitCode: 0 };
      }
      if (file === 'git' && Array.isArray(args) && args[0] === 'remote' && args[1] === 'get-url') {
        return { stdout: 'https://github.com/org/repo.git\n', stderr: '', exitCode: 0 };
      }
      return { stdout: '', stderr: '', exitCode: 0 };
    });

    const config = getDefaultConfig();
    config.git.httpsTokenEnv = 'GITHUB_TOKEN';
    const ctx = createContext({ config });
    await runGitPushStage(ctx);

    const calls = vi.mocked(execCommand).mock.calls;
    // Call order: remote get-url, rev-parse (branch detection deferred to commit block), push branch (authed), push tags (authed)
    expect(calls[0]?.[1]).toEqual(['remote', 'get-url', 'origin']);
    expect(calls[1]?.[1]).toEqual(['rev-parse', '--abbrev-ref', 'HEAD']);
    expect(calls[2]?.[1]?.[0]).toBe('push');
    expect((calls[2]?.[1] as string[])[1]).toContain('https://x-access-token:gh_test_token@github.com/org/repo.git');
    expect((calls[3]?.[1] as string[])[1]).toContain('https://x-access-token:gh_test_token@github.com/org/repo.git');
  });

  it('should not attempt token auth when httpsTokenEnv is not configured', async () => {
    const { execCommand } = await import('../../../src/utils/exec.js');
    process.env.GITHUB_TOKEN = 'gh_test_token';

    const ctx = createContext(); // default config has httpsTokenEnv: undefined
    await runGitPushStage(ctx);

    const calls = vi.mocked(execCommand).mock.calls;
    // Should push directly to remote name, no get-url call
    expect(calls).toHaveLength(3); // rev-parse + push branch + push tags
    expect(calls[0]?.[1]).toEqual(['rev-parse', '--abbrev-ref', 'HEAD']);
    expect(calls[1]?.[1]).toEqual(['push', 'origin', 'main']);
    expect(calls[2]?.[1]).toEqual(['push', 'origin', '--tags']);
  });

  it('should fall back to plain remote for non-GitHub HTTPS URLs', async () => {
    const { execCommand } = await import('../../../src/utils/exec.js');
    process.env.MY_TOKEN = 'some_token';

    vi.mocked(execCommand).mockImplementation(async (file, args) => {
      if (Array.isArray(args) && args[0] === 'rev-parse') {
        return { stdout: 'main\n', stderr: '', exitCode: 0 };
      }
      if (file === 'git' && Array.isArray(args) && args[0] === 'remote' && args[1] === 'get-url') {
        return { stdout: 'https://gitlab.example.com/org/repo.git\n', stderr: '', exitCode: 0 };
      }
      return { stdout: '', stderr: '', exitCode: 0 };
    });

    const config = getDefaultConfig();
    config.git.httpsTokenEnv = 'MY_TOKEN';
    const ctx = createContext({ config });
    await runGitPushStage(ctx);

    const calls = vi.mocked(execCommand).mock.calls;
    // Call order: get-url, rev-parse (branch detection deferred to commit block), push branch, push tags
    expect(calls[0]?.[1]).toEqual(['remote', 'get-url', 'origin']);
    expect(calls[1]?.[1]).toEqual(['rev-parse', '--abbrev-ref', 'HEAD']);
    expect(calls[2]?.[1]).toEqual(['push', 'origin', 'main']);
    expect(calls[3]?.[1]).toEqual(['push', 'origin', '--tags']);

    delete process.env.MY_TOKEN;
  });

  it('should detect current branch when config.git.branch is not set', async () => {
    const { execCommand } = await import('../../../src/utils/exec.js');
    vi.mocked(execCommand).mockImplementation(async (_file, args) => {
      if (Array.isArray(args) && args[0] === 'rev-parse') {
        return { stdout: 'feature/my-branch\n', stderr: '', exitCode: 0 };
      }
      return { stdout: '', stderr: '', exitCode: 0 };
    });

    const ctx = createContext();
    await runGitPushStage(ctx);

    const calls = vi.mocked(execCommand).mock.calls;
    expect(calls[0]?.[1]).toEqual(['rev-parse', '--abbrev-ref', 'HEAD']);
    expect(calls[1]?.[1]).toEqual(['push', 'origin', 'feature/my-branch']);
  });

  it('should throw a clear error when in detached HEAD state', async () => {
    const { execCommand } = await import('../../../src/utils/exec.js');
    vi.mocked(execCommand).mockImplementation(async (_file, args) => {
      if (Array.isArray(args) && args[0] === 'rev-parse') {
        return { stdout: 'HEAD\n', stderr: '', exitCode: 0 };
      }
      return { stdout: '', stderr: '', exitCode: 0 };
    });

    const ctx = createContext();

    await expect(runGitPushStage(ctx)).rejects.toThrow(/detached HEAD/);
  });

  it('should propagate a detached-HEAD PublishError without re-wrapping it', async () => {
    const { execCommand } = await import('../../../src/utils/exec.js');
    vi.mocked(execCommand).mockImplementation(async (_file, args) => {
      if (Array.isArray(args) && args[0] === 'rev-parse') {
        return { stdout: 'HEAD\n', stderr: '', exitCode: 0 };
      }
      return { stdout: '', stderr: '', exitCode: 0 };
    });

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

  it('should use explicit branch from config without calling rev-parse', async () => {
    const { execCommand } = await import('../../../src/utils/exec.js');
    const config = getDefaultConfig();
    config.git.branch = 'release/v2';
    const ctx = createContext({ config });

    await runGitPushStage(ctx);

    const calls = vi.mocked(execCommand).mock.calls;
    expect(calls[0]?.[1]).toEqual(['push', 'origin', 'release/v2']);
    expect(calls.every((c) => !(c[1] as string[]).includes('rev-parse'))).toBe(true);
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

    // Branch resolution (rev-parse) must NOT run — branch is only needed when pushing commits
    expect(execCommand).toHaveBeenCalledTimes(1); // push tags only
    expect(vi.mocked(execCommand).mock.calls[0]?.[1]).toContain('--tags');
    expect(vi.mocked(execCommand).mock.calls.every((c) => !(c[1] as string[]).includes('rev-parse'))).toBe(true);
  });

  it('should not throw when in detached HEAD state and there are only tags to push', async () => {
    const { execCommand } = await import('../../../src/utils/exec.js');
    vi.mocked(execCommand).mockImplementation(async (_file, args) => {
      if (Array.isArray(args) && args[0] === 'rev-parse') {
        return { stdout: 'HEAD\n', stderr: '', exitCode: 0 };
      }
      return { stdout: '', stderr: '', exitCode: 0 };
    });

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
});
