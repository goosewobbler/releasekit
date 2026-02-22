import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDefaultConfig } from '../../../src/config.js';
import { runVerifyStage } from '../../../src/stages/verify.js';
import type { PipelineContext } from '../../../src/types.js';

vi.mock('../../../src/utils/exec.js', () => ({
  execCommandSafe: vi.fn().mockResolvedValue({ stdout: '"1.0.0"', stderr: '', exitCode: 0 }),
}));

function createContext(overrides?: Partial<PipelineContext>): PipelineContext {
  const config = getDefaultConfig();
  // Use minimal delays for tests
  config.verify.npm.initialDelay = 1;
  config.verify.npm.maxAttempts = 2;
  config.verify.cargo.initialDelay = 1;
  config.verify.cargo.maxAttempts = 2;

  return {
    input: { dryRun: false, updates: [], changelogs: [], tags: [] },
    config,
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
    cwd: '/test',
    packageManager: 'pnpm',
    output: {
      dryRun: false,
      git: { committed: false, tags: [], pushed: false },
      npm: [{ packageName: '@test/pkg', version: '1.0.0', registry: 'npm', success: true, skipped: false }],
      cargo: [],
      verification: [],
      githubReleases: [],
    },
    ...overrides,
  };
}

describe('verify stage', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const { execCommandSafe } = await import('../../../src/utils/exec.js');
    vi.mocked(execCommandSafe).mockResolvedValue({ stdout: '"1.0.0"', stderr: '', exitCode: 0 });
  });

  it('should verify published npm packages', async () => {
    const ctx = createContext();
    await runVerifyStage(ctx);

    expect(ctx.output.verification).toHaveLength(1);
    expect(ctx.output.verification[0]?.verified).toBe(true);
    expect(ctx.output.verification[0]?.registry).toBe('npm');
  });

  it('should skip verification for skipped packages', async () => {
    const ctx = createContext({
      output: {
        dryRun: false,
        git: { committed: false, tags: [], pushed: false },
        npm: [
          {
            packageName: '@test/pkg',
            version: '1.0.0',
            registry: 'npm',
            success: true,
            skipped: true,
            reason: 'private',
          },
        ],
        cargo: [],
        verification: [],
        githubReleases: [],
      },
    });

    await runVerifyStage(ctx);

    expect(ctx.output.verification).toHaveLength(0);
  });

  it('should skip verification for already-published packages', async () => {
    const ctx = createContext({
      output: {
        dryRun: false,
        git: { committed: false, tags: [], pushed: false },
        npm: [
          {
            packageName: '@test/pkg',
            version: '1.0.0',
            registry: 'npm',
            success: true,
            skipped: false,
            alreadyPublished: true,
          },
        ],
        cargo: [],
        verification: [],
        githubReleases: [],
      },
    });

    await runVerifyStage(ctx);

    expect(ctx.output.verification).toHaveLength(0);
  });

  it('should handle verification failure gracefully', async () => {
    const { execCommandSafe } = await import('../../../src/utils/exec.js');
    vi.mocked(execCommandSafe).mockResolvedValue({ stdout: '', stderr: '', exitCode: 1 });

    const ctx = createContext();
    await runVerifyStage(ctx);

    expect(ctx.output.verification).toHaveLength(1);
    expect(ctx.output.verification[0]?.verified).toBe(false);
  });

  it('should skip all verification in dry-run mode', async () => {
    const { execCommandSafe } = await import('../../../src/utils/exec.js');
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

    await runVerifyStage(ctx);

    expect(execCommandSafe).not.toHaveBeenCalled();
    expect(ctx.output.verification[0]?.verified).toBe(true);
  });
});
