import { createFakeGit, type FakeGit, type FakeGitSeed } from '@releasekit/git';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDefaultConfig } from '../../../src/config.js';
import { runGitCommitStage } from '../../../src/stages/git-commit.js';
import type { PipelineContext } from '../../../src/types.js';

// Drive the stage through a seeded FakeGit. `createGitCli()` resolves to the fake we seed per test,
// so we can assert on its recorders (`added`/`committed`/`tagged`) and seeded reads (`refExists`,
// `log`, `headSha`).
let fakeGit: FakeGit;
vi.mock('@releasekit/git', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@releasekit/git')>();
  return {
    ...actual,
    createGitCli: () => fakeGit,
  };
});

function seedGit(seed: FakeGitSeed = {}): void {
  fakeGit = createFakeGit(seed);
}

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
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: tag does not exist, so a fresh tag is created.
    seedGit();
  });

  it('should run git add, commit, and tag', async () => {
    const ctx = createContext();

    await runGitCommitStage(ctx);

    expect(fakeGit.added).toHaveLength(1);
    expect(fakeGit.committed).toEqual([
      expect.objectContaining({ message: 'chore: release foo@1.0.0', skipHooks: false }),
    ]);
    expect(fakeGit.tagged).toEqual([{ name: 'foo@v1.0.0', message: 'Release foo@v1.0.0' }]);

    expect(ctx.output.git.committed).toBe(true);
    expect(ctx.output.git.tags).toEqual(['foo@v1.0.0']);
  });

  it('should skip when no commit message', async () => {
    const ctx = createContext({ input: { dryRun: false, updates: [], changelogs: [], tags: [] } });

    await runGitCommitStage(ctx);

    expect(fakeGit.added).toHaveLength(0);
    expect(fakeGit.committed).toHaveLength(0);
    expect(fakeGit.tagged).toHaveLength(0);
    expect(ctx.output.git.committed).toBe(false);
  });

  it('should NOT execute any git write in dry-run, but still record the tag in output', async () => {
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

    // No write reached the seam — the dry-run guard short-circuits before the FakeGit op runs.
    expect(fakeGit.added).toHaveLength(0);
    expect(fakeGit.committed).toHaveLength(0);
    expect(fakeGit.tagged).toHaveLength(0);

    // But output is still populated as if the writes happened (roll-forward bookkeeping).
    expect(ctx.output.git.committed).toBe(true);
    expect(ctx.output.git.tags).toEqual(['foo@v1.0.0']);
  });

  it('should create multiple tags', async () => {
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

    expect(fakeGit.tagged.map((t) => t.name)).toEqual(['a@v1.0.0', 'b@v1.0.0']);
    expect(ctx.output.git.tags).toEqual(['a@v1.0.0', 'b@v1.0.0']);
  });

  it('should also create baseline tags when present on input', async () => {
    // Baseline tags live alongside consumer tags: both are created locally and pushed,
    // but the github-release stage only reads input.tags so baselines don't get a Release.
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

    expect(fakeGit.tagged.map((t) => t.name)).toEqual(['v1.0.0', 'release/v1.0.0']);
    expect(ctx.output.git.tags).toEqual(['v1.0.0', 'release/v1.0.0']);
  });

  it('should pass skipHooks to commit when skipHooks is true', async () => {
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

    expect(fakeGit.committed[0]?.skipHooks).toBe(true);
  });

  describe('tag pre-existence check', () => {
    it('should skip tag creation when tag already exists at same commit', async () => {
      // Tag exists, and resolving it (via log) yields the same SHA as HEAD.
      seedGit({
        existingRefs: ['refs/tags/foo@v1.0.0'],
        headSha: 'abc123',
        commits: { 'foo@v1.0.0': 'abc123\n' },
      });
      const ctx = createContext();

      await runGitCommitStage(ctx);

      // Should not create the tag.
      expect(fakeGit.tagged).toHaveLength(0);
      // But tag should still be tracked in output.
      expect(ctx.output.git.tags).toContain('foo@v1.0.0');
    });

    it('should throw when tag exists at a different commit', async () => {
      seedGit({
        existingRefs: ['refs/tags/foo@v1.0.0'],
        headSha: 'newsha',
        commits: { 'foo@v1.0.0': 'oldsha\n' },
      });
      const ctx = createContext();

      await expect(runGitCommitStage(ctx)).rejects.toThrow(/already exists at a different commit/);
    });

    it('should create tag when it does not exist', async () => {
      // Default seed: no existing refs.
      const ctx = createContext();

      await runGitCommitStage(ctx);

      expect(fakeGit.tagged).toHaveLength(1);
      expect(ctx.output.git.tags).toContain('foo@v1.0.0');
    });
  });

  describe('skipGitCommit', () => {
    it('should skip git add and commit when skipGitCommit is true', async () => {
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

      await runGitCommitStage(ctx);

      expect(fakeGit.added).toHaveLength(0);
      expect(fakeGit.committed).toHaveLength(0);
      expect(fakeGit.tagged).toHaveLength(1); // tags still created
      expect(ctx.output.git.committed).toBe(false);
      expect(ctx.output.git.tags).toContain('foo@v1.0.0');
    });
  });
});
