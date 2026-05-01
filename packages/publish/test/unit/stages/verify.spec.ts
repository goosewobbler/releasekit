import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

function cargoOutput(overrides?: object) {
  return {
    dryRun: false,
    git: { committed: false, tags: [], pushed: false },
    npm: [],
    cargo: [
      {
        packageName: 'my-crate',
        version: '0.5.0',
        registry: 'cargo' as const,
        success: true,
        skipped: false,
        ...overrides,
      },
    ],
    verification: [],
    githubReleases: [],
  };
}

describe('verify stage', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const { execCommandSafe } = await import('../../../src/utils/exec.js');
    vi.mocked(execCommandSafe).mockResolvedValue({ stdout: '"1.0.0"', stderr: '', exitCode: 0 });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
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

  describe('cargo verification', () => {
    it('should verify a published crate when crates.io returns 200', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 200, ok: true } as Response));
      const ctx = createContext({ output: cargoOutput() });

      await runVerifyStage(ctx);

      expect(ctx.output.verification).toHaveLength(1);
      expect(ctx.output.verification[0]?.verified).toBe(true);
      expect(ctx.output.verification[0]?.registry).toBe('cargo');
    });

    it('should retry when crates.io returns 404 then succeed on 200', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce({ status: 404, ok: false } as Response)
        .mockResolvedValue({ status: 200, ok: true } as Response);
      vi.stubGlobal('fetch', fetchMock);
      const ctx = createContext({ output: cargoOutput() });

      await runVerifyStage(ctx);

      expect(ctx.output.verification[0]?.verified).toBe(true);
      expect(ctx.output.verification[0]?.attempts).toBeGreaterThan(1);
    });

    it('should fail fast on 403 without exhausting retries', async () => {
      const fetchMock = vi.fn().mockResolvedValue({ status: 403, ok: false } as Response);
      vi.stubGlobal('fetch', fetchMock);
      const ctx = createContext({ output: cargoOutput() });

      await runVerifyStage(ctx);

      expect(ctx.output.verification[0]?.verified).toBe(false);
      // Should stop after the first attempt, not use all maxAttempts (2)
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('should send User-Agent header in crates.io verification request', async () => {
      const fetchMock = vi.fn().mockResolvedValue({ status: 200, ok: true } as Response);
      vi.stubGlobal('fetch', fetchMock);
      const ctx = createContext({ output: cargoOutput() });

      await runVerifyStage(ctx);

      expect(fetchMock).toHaveBeenCalledOnce();
      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect((init?.headers as Record<string, string>)?.['User-Agent']).toMatch(/releasekit/);
    });

    it('should skip verification for skipped cargo packages', async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);
      const ctx = createContext({ output: cargoOutput({ skipped: true }) });

      await runVerifyStage(ctx);

      expect(fetchMock).not.toHaveBeenCalled();
      expect(ctx.output.verification).toHaveLength(0);
    });
  });
});
