import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDefaultConfig } from '../../../src/config.js';
import { runGithubReleaseStage } from '../../../src/stages/github-release.js';
import type { PipelineContext } from '../../../src/types.js';

vi.mock('../../../src/utils/exec.js', () => ({
  execCommand: vi
    .fn()
    .mockResolvedValue({ stdout: 'https://github.com/owner/repo/releases/tag/v1.0.0', stderr: '', exitCode: 0 }),
}));

function createContext(overrides?: Partial<PipelineContext>): PipelineContext {
  return {
    input: { dryRun: false, updates: [], changelogs: [], tags: ['v1.0.0'] },
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
    cwd: '/test',
    packageManager: 'pnpm',
    output: {
      dryRun: false,
      git: { committed: true, tags: ['v1.0.0'], pushed: true },
      npm: [],
      cargo: [],
      verification: [],
      githubReleases: [],
    },
    ...overrides,
  };
}

describe('github-release stage', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const { execCommand } = await import('../../../src/utils/exec.js');
    vi.mocked(execCommand).mockResolvedValue({
      stdout: 'https://github.com/owner/repo/releases/tag/v1.0.0',
      stderr: '',
      exitCode: 0,
    });
  });

  it('should create a draft GitHub release', async () => {
    const { execCommand } = await import('../../../src/utils/exec.js');
    const ctx = createContext();

    await runGithubReleaseStage(ctx);

    expect(execCommand).toHaveBeenCalledTimes(1);
    const call = vi.mocked(execCommand).mock.calls[0];
    expect(call?.[0]).toBe('gh');
    const args = call?.[1] as string[];
    expect(args).toEqual(expect.arrayContaining(['release', 'create', 'v1.0.0']));
    expect(args).toContain('--draft');
    expect(args).toContain('--generate-notes');

    expect(ctx.output.githubReleases).toHaveLength(1);
    expect(ctx.output.githubReleases[0]?.success).toBe(true);
    expect(ctx.output.githubReleases[0]?.draft).toBe(true);
  });

  it('should create per-package releases when configured', async () => {
    const { execCommand } = await import('../../../src/utils/exec.js');
    const config = getDefaultConfig();
    config.githubRelease.perPackage = true;

    const ctx = createContext({
      config,
      output: {
        dryRun: false,
        git: { committed: true, tags: ['pkg-a@v1.0.0', 'pkg-b@v1.0.0'], pushed: true },
        npm: [],
        cargo: [],
        verification: [],
        githubReleases: [],
      },
    });

    await runGithubReleaseStage(ctx);

    expect(execCommand).toHaveBeenCalledTimes(2);
    expect(ctx.output.githubReleases).toHaveLength(2);
  });

  it('should create single release for consolidated mode', async () => {
    const { execCommand } = await import('../../../src/utils/exec.js');
    const ctx = createContext({
      output: {
        dryRun: false,
        git: { committed: true, tags: ['pkg-a@v1.0.0', 'pkg-b@v1.0.0'], pushed: true },
        npm: [],
        cargo: [],
        verification: [],
        githubReleases: [],
      },
    });

    await runGithubReleaseStage(ctx);

    expect(execCommand).toHaveBeenCalledTimes(1);
    expect(ctx.output.githubReleases).toHaveLength(1);
  });

  it('should add --prerelease for pre-release versions', async () => {
    const { execCommand } = await import('../../../src/utils/exec.js');
    const ctx = createContext({
      output: {
        dryRun: false,
        git: { committed: true, tags: ['v1.0.0-next.1'], pushed: true },
        npm: [],
        cargo: [],
        verification: [],
        githubReleases: [],
      },
    });

    await runGithubReleaseStage(ctx);

    const args = vi.mocked(execCommand).mock.calls[0]?.[1] as string[];
    expect(args).toContain('--prerelease');
  });

  it('should skip when disabled in config', async () => {
    const { execCommand } = await import('../../../src/utils/exec.js');
    const config = getDefaultConfig();
    config.githubRelease.enabled = false;
    const ctx = createContext({ config });

    await runGithubReleaseStage(ctx);

    expect(execCommand).not.toHaveBeenCalled();
  });

  it('should skip when no tags available', async () => {
    const { execCommand } = await import('../../../src/utils/exec.js');
    const ctx = createContext({
      input: { dryRun: false, updates: [], changelogs: [], tags: [] },
      output: {
        dryRun: false,
        git: { committed: true, tags: [], pushed: true },
        npm: [],
        cargo: [],
        verification: [],
        githubReleases: [],
      },
    });

    await runGithubReleaseStage(ctx);

    expect(execCommand).not.toHaveBeenCalled();
  });
});
