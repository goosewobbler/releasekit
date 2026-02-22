import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDefaultConfig } from '../../../src/config.js';
import { runGitCommitStage } from '../../../src/stages/git-commit.js';
import type { PipelineContext } from '../../../src/types.js';

vi.mock('../../../src/utils/exec.js', () => ({
  execCommand: vi.fn().mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 }),
}));

function createContext(overrides?: Partial<PipelineContext>): PipelineContext {
  return {
    input: {
      dryRun: false,
      updates: [{ packageName: 'foo', newVersion: '1.0.0', filePath: 'packages/foo/package.json' }],
      changelogs: [],
      commitMessage: 'chore: release foo@1.0.0',
      tags: ['foo@v1.0.0'],
    },
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
      git: { committed: false, tags: [], pushed: false },
      npm: [],
      cargo: [],
      verification: [],
      githubReleases: [],
    },
    ...overrides,
  };
}

describe('git-commit stage', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const { execCommand } = await import('../../../src/utils/exec.js');
    vi.mocked(execCommand).mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 });
  });

  it('should run git add, commit, and tag', async () => {
    const { execCommand } = await import('../../../src/utils/exec.js');
    const ctx = createContext();

    await runGitCommitStage(ctx);

    expect(execCommand).toHaveBeenCalledTimes(3); // add, commit, tag
    const calls = vi.mocked(execCommand).mock.calls;
    expect(calls[0]?.[0]).toBe('git');
    expect(calls[0]?.[1]).toContain('add');
    expect(calls[1]?.[0]).toBe('git');
    expect(calls[1]?.[1]).toEqual(expect.arrayContaining(['commit', '-m', 'chore: release foo@1.0.0']));
    expect(calls[2]?.[0]).toBe('git');
    expect(calls[2]?.[1]).toEqual(expect.arrayContaining(['tag', '-a', 'foo@v1.0.0']));

    expect(ctx.output.git.committed).toBe(true);
    expect(ctx.output.git.tags).toEqual(['foo@v1.0.0']);
  });

  it('should skip when no commit message', async () => {
    const { execCommand } = await import('../../../src/utils/exec.js');
    const ctx = createContext({ input: { dryRun: false, updates: [], changelogs: [], tags: [] } });

    await runGitCommitStage(ctx);

    expect(execCommand).not.toHaveBeenCalled();
    expect(ctx.output.git.committed).toBe(false);
  });

  it('should pass dryRun to execCommand', async () => {
    const { execCommand } = await import('../../../src/utils/exec.js');
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

    await runGitCommitStage(ctx);

    for (const call of vi.mocked(execCommand).mock.calls) {
      expect(call[2]).toMatchObject({ dryRun: true });
    }
  });

  it('should create multiple tags', async () => {
    const { execCommand } = await import('../../../src/utils/exec.js');
    const ctx = createContext({
      input: {
        dryRun: false,
        updates: [{ packageName: 'a', newVersion: '1.0.0', filePath: 'a/package.json' }],
        changelogs: [],
        commitMessage: 'release',
        tags: ['a@v1.0.0', 'b@v1.0.0'],
      },
    });

    await runGitCommitStage(ctx);

    // add + commit + 2 tags = 4 calls
    expect(execCommand).toHaveBeenCalledTimes(4);
    expect(ctx.output.git.tags).toEqual(['a@v1.0.0', 'b@v1.0.0']);
  });
});
