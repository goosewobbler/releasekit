import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDefaultConfig } from '../../../src/config.js';
import { runGitCommitStage } from '../../../src/stages/git-commit.js';
import type { PipelineContext } from '../../../src/types.js';

vi.mock('../../../src/utils/exec.js', () => ({
  execCommand: vi.fn().mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 }),
  execCommandSafe: vi.fn().mockResolvedValue({ stdout: '', stderr: '', exitCode: 1 }),
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
    const { execCommand, execCommandSafe } = await import('../../../src/utils/exec.js');
    vi.mocked(execCommand).mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 });
    // Default: tag does not exist (exit code 1 = not found)
    vi.mocked(execCommandSafe).mockResolvedValue({ stdout: '', stderr: '', exitCode: 1 });
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

  it('should also create baseline tags when present on input', async () => {
    // Baseline tags live alongside consumer tags: both are created locally and pushed,
    // but the github-release stage only reads input.tags so baselines don't get a Release.
    const { execCommand } = await import('../../../src/utils/exec.js');
    const ctx = createContext({
      input: {
        dryRun: false,
        updates: [{ packageName: 'a', newVersion: '1.0.0', filePath: 'a/package.json' }],
        changelogs: [],
        commitMessage: 'release',
        tags: ['v1.0.0'],
        baselineTags: ['release/v1.0.0'],
      },
    });

    await runGitCommitStage(ctx);

    // add + commit + 1 consumer tag + 1 baseline tag = 4 calls
    expect(execCommand).toHaveBeenCalledTimes(4);
    expect(ctx.output.git.tags).toEqual(['v1.0.0', 'release/v1.0.0']);
  });

  it('should pass --no-verify when skipHooks is true', async () => {
    const { execCommand } = await import('../../../src/utils/exec.js');
    const ctx = createContext({
      config: {
        ...getDefaultConfig(),
        git: {
          ...getDefaultConfig().git,
          skipHooks: true,
        },
      },
    });

    await runGitCommitStage(ctx);

    const calls = vi.mocked(execCommand).mock.calls;
    const commitCall = calls[1];
    expect(commitCall?.[1]).toContain('--no-verify');
  });

  describe('tag pre-existence check', () => {
    it('should skip tag creation when tag already exists at same commit', async () => {
      const { execCommand, execCommandSafe } = await import('../../../src/utils/exec.js');
      const ctx = createContext();

      // Tag exists (exitCode 0), points to same SHA as HEAD
      vi.mocked(execCommandSafe)
        .mockResolvedValueOnce({ stdout: 'abc123\n', stderr: '', exitCode: 0 }) // rev-parse verify
        .mockResolvedValueOnce({ stdout: 'abc123\n', stderr: '', exitCode: 0 }) // rev-parse tag^{}
        .mockResolvedValueOnce({ stdout: 'abc123\n', stderr: '', exitCode: 0 }); // rev-parse HEAD

      await runGitCommitStage(ctx);

      // Should not call git tag
      const tagCalls = vi.mocked(execCommand).mock.calls.filter((c) => c[1]?.includes('tag'));
      expect(tagCalls).toHaveLength(0);
      // But tag should still be tracked in output
      expect(ctx.output.git.tags).toContain('foo@v1.0.0');
    });

    it('should throw when tag exists at a different commit', async () => {
      const { execCommandSafe } = await import('../../../src/utils/exec.js');
      const ctx = createContext();

      vi.mocked(execCommandSafe)
        .mockResolvedValueOnce({ stdout: 'oldsha\n', stderr: '', exitCode: 0 }) // rev-parse verify
        .mockResolvedValueOnce({ stdout: 'oldsha\n', stderr: '', exitCode: 0 }) // rev-parse tag^{}
        .mockResolvedValueOnce({ stdout: 'newsha\n', stderr: '', exitCode: 0 }); // rev-parse HEAD

      await expect(runGitCommitStage(ctx)).rejects.toThrow(/already exists at a different commit/);
    });

    it('should create tag when it does not exist', async () => {
      const { execCommand, execCommandSafe } = await import('../../../src/utils/exec.js');
      const ctx = createContext();

      // Tag does not exist (exitCode 1)
      vi.mocked(execCommandSafe).mockResolvedValue({ stdout: '', stderr: '', exitCode: 1 });

      await runGitCommitStage(ctx);

      const tagCalls = vi.mocked(execCommand).mock.calls.filter((c) => c[1]?.includes('tag'));
      expect(tagCalls).toHaveLength(1);
      expect(ctx.output.git.tags).toContain('foo@v1.0.0');
    });
  });

  describe('skipGitCommit', () => {
    it('should skip git add and commit when skipGitCommit is true', async () => {
      const { execCommand, execCommandSafe } = await import('../../../src/utils/exec.js');
      const ctx = createContext({
        cliOptions: {
          registry: 'all',
          npmAuth: 'auto',
          dryRun: false,
          skipGit: false,
          skipGitCommit: true,
          skipPublish: false,
          skipGithubRelease: false,
          skipVerification: false,
          json: false,
          verbose: false,
        },
      });

      vi.mocked(execCommandSafe).mockResolvedValue({ stdout: '', stderr: '', exitCode: 1 }); // tag doesn't exist

      await runGitCommitStage(ctx);

      const calls = vi.mocked(execCommand).mock.calls;
      const addCalls = calls.filter((c) => c[1]?.includes('add'));
      const commitCalls = calls.filter((c) => c[1]?.includes('commit'));
      const tagCalls = calls.filter((c) => c[1]?.includes('tag'));

      expect(addCalls).toHaveLength(0);
      expect(commitCalls).toHaveLength(0);
      expect(tagCalls).toHaveLength(1); // tags still created
      expect(ctx.output.git.committed).toBe(false);
      expect(ctx.output.git.tags).toContain('foo@v1.0.0');
    });
  });
});
