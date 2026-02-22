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
