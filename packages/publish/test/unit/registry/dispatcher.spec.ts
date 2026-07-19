import { afterEach, describe, expect, it, vi } from 'vitest';
import { getDefaultConfig } from '../../../src/config.js';
import { PublishErrorCode } from '../../../src/errors/index.js';
import { cargoRegistry } from '../../../src/registry/cargo.js';
import { runPublishStage } from '../../../src/registry/dispatcher.js';
import type { Registry, RegistryTarget } from '../../../src/registry/types.js';
import type { PipelineContext } from '../../../src/types.js';

// The dispatcher owns the shared publish lifecycle for every registry — per-target results, the
// already-published idempotency handling, bounded retry, the fail-fast throw, and accumulation into
// ctx.output. Driving it through a tiny in-memory Registry lets that contract be tested once instead
// of re-proven in each of the npm/cargo/pub stage specs.

type FakeTarget = RegistryTarget;

function createContext(cliOverrides?: Partial<PipelineContext['cliOptions']>): PipelineContext {
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
      ...cliOverrides,
    },
    cwd: '/ws',
    packageManager: 'pnpm',
    output: {
      dryRun: false,
      git: { committed: false, tags: [], pushed: false },
      npm: [],
      cargo: [],
      pub: [],
      verification: [],
      githubReleases: [],
      publishSucceeded: false,
    },
  };
}

const target = (packageName: string, version = '1.0.0'): FakeTarget => ({ packageName, version });

/** An exec-style rejection: getExecErrorOutput joins message + stdout + stderr for pattern matching. */
function execError(stderr: string): Error {
  return Object.assign(new Error('Command failed'), { stdout: '', stderr, exitCode: 1 });
}

function makeRegistry(overrides: Partial<Registry<FakeTarget, unknown>> = {}): Registry<FakeTarget, unknown> {
  return {
    id: 'npm',
    displayName: 'fake',
    alreadyPublishedNote: ' on fake',
    disabledLog: { level: 'debug', message: 'fake publishing disabled in config' },
    publishErrorCode: PublishErrorCode.NPM_PUBLISH_ERROR,
    alreadyPublishedPattern: /ALREADY-THERE/i,
    isEnabled: () => true,
    authCheck: async () => ({}),
    discover: async () => [],
    isPublished: async () => false,
    publish: async () => {},
    ...overrides,
  };
}

describe('runPublishStage dispatcher', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('should do nothing and never authenticate when the registry is disabled', async () => {
    const authCheck = vi.fn(async () => ({}));
    const ctx = createContext();
    await runPublishStage(makeRegistry({ isEnabled: () => false, authCheck }), ctx);

    expect(authCheck).not.toHaveBeenCalled();
    expect(ctx.output.npm).toHaveLength(0);
  });

  it('should not authenticate when enabled but no targets are discovered', async () => {
    // Enabled + zero targets must no-op without authenticating: discovery runs before authCheck, so a
    // stage with nothing to publish can't fail on credentials it never needs (e.g. no crates, no token).
    const authCheck = vi.fn(async () => {
      throw new Error('missing registry token');
    });
    const ctx = createContext();

    await expect(
      runPublishStage(makeRegistry({ isEnabled: () => true, discover: async () => [], authCheck }), ctx),
    ).resolves.toBeUndefined();

    expect(authCheck).not.toHaveBeenCalled();
    expect(ctx.output.npm).toHaveLength(0);
  });

  it('should no-op the real cargo registry for a crateless repo without demanding a token', async () => {
    // A dry run can't cover this: cargo's authCheck is dry-run-exempt, so the enabled-but-crateless
    // no-op is only exercised by a real (non-dry-run) run with no token.
    const savedToken = process.env.CARGO_REGISTRY_TOKEN;
    delete process.env.CARGO_REGISTRY_TOKEN;
    try {
      const ctx = createContext();
      ctx.config.cargo.enabled = true;
      ctx.input.updates = [{ packageName: '@smoke/pkg', newVersion: '1.1.0', filePath: 'package.json' }];

      await expect(runPublishStage(cargoRegistry, ctx)).resolves.toBeUndefined();
      expect(ctx.output.cargo).toHaveLength(0);
    } finally {
      if (savedToken === undefined) delete process.env.CARGO_REGISTRY_TOKEN;
      else process.env.CARGO_REGISTRY_TOKEN = savedToken;
    }
  });

  it('should record a precheckSkip as a non-publishing skip', async () => {
    const publish = vi.fn(async () => {});
    const ctx = createContext();
    await runPublishStage(
      makeRegistry({
        discover: async () => [target('a')],
        precheckSkip: () => ({ reason: 'Not a fake package' }),
        publish,
      }),
      ctx,
    );

    expect(publish).not.toHaveBeenCalled();
    expect(ctx.output.npm[0]).toMatchObject({ skipped: true, success: true, reason: 'Not a fake package' });
    expect(ctx.output.npm[0]?.alreadyPublished).toBeUndefined();
  });

  it('should skip an already-published target without publishing (idempotency)', async () => {
    const publish = vi.fn(async () => {});
    const ctx = createContext();
    await runPublishStage(
      makeRegistry({ discover: async () => [target('a')], isPublished: async () => true, publish }),
      ctx,
    );

    expect(publish).not.toHaveBeenCalled();
    expect(ctx.output.npm[0]).toMatchObject({
      alreadyPublished: true,
      skipped: true,
      success: true,
      reason: 'Already published on fake',
    });
  });

  it('should publish and record success for a fresh target', async () => {
    const publish = vi.fn(async () => {});
    const ctx = createContext();
    await runPublishStage(makeRegistry({ discover: async () => [target('a')], publish }), ctx);

    expect(publish).toHaveBeenCalledTimes(1);
    expect(ctx.output.npm[0]).toMatchObject({ packageName: 'a', success: true, skipped: false });
  });

  it('should resolve a surfaced already-published conflict as an idempotent skip without retrying', async () => {
    const publish = vi.fn(async () => {
      throw execError('error: ALREADY-THERE in the registry');
    });
    const ctx = createContext();

    await expect(
      runPublishStage(makeRegistry({ discover: async () => [target('a')], publish }), ctx),
    ).resolves.toBeUndefined();

    expect(publish).toHaveBeenCalledTimes(1); // an already-published conflict is never retried
    expect(ctx.output.npm[0]).toMatchObject({
      alreadyPublished: true,
      skipped: true,
      success: true,
      reason: 'Already published on fake (detected from publish error)',
    });
  });

  it('should retry a transient failure and record the attempt count', async () => {
    vi.useFakeTimers();
    let calls = 0;
    const publish = vi.fn(async () => {
      calls += 1;
      if (calls === 1) throw execError('503 Service Unavailable');
    });
    const ctx = createContext();

    const promise = runPublishStage(makeRegistry({ discover: async () => [target('a')], publish }), ctx);
    await vi.runAllTimersAsync();
    await promise;

    expect(publish).toHaveBeenCalledTimes(2);
    expect(ctx.output.npm[0]).toMatchObject({ success: true, attempts: 2 });
  });

  it('should fail fast on a permanent failure, throwing the configured error code', async () => {
    const publish = vi.fn(async () => {
      throw execError('npm ERR! code ENEEDAUTH\nnpm ERR! 401 Unauthorized');
    });
    const ctx = createContext();

    await expect(
      runPublishStage(makeRegistry({ discover: async () => [target('a')], publish }), ctx),
    ).rejects.toMatchObject({ code: PublishErrorCode.NPM_PUBLISH_ERROR });

    expect(publish).toHaveBeenCalledTimes(1); // permanent error, no retries
    expect(ctx.output.npm[0]).toMatchObject({ success: false });
  });

  it('should dispose the session even when a publish throws', async () => {
    const dispose = vi.fn();
    const publish = vi.fn(async () => {
      throw execError('npm ERR! 401 Unauthorized');
    });
    const ctx = createContext();

    await expect(
      runPublishStage(makeRegistry({ discover: async () => [target('a')], publish, dispose }), ctx),
    ).rejects.toBeDefined();

    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('should run prepare once when there are targets and skip it when there are none', async () => {
    const prepareWith = vi.fn(async () => {});
    await runPublishStage(makeRegistry({ discover: async () => [target('a')], prepare: prepareWith }), createContext());
    expect(prepareWith).toHaveBeenCalledTimes(1);

    const prepareEmpty = vi.fn(async () => {});
    await runPublishStage(makeRegistry({ discover: async () => [], prepare: prepareEmpty }), createContext());
    expect(prepareEmpty).not.toHaveBeenCalled();
  });

  it('should process targets in discovery order and skip the success log under dry-run', async () => {
    const published: string[] = [];
    const publish = vi.fn(async (t: FakeTarget) => {
      published.push(t.packageName);
    });
    const ctx = createContext({ dryRun: true });

    await runPublishStage(
      makeRegistry({ discover: async () => [target('a'), target('b'), target('c')], publish }),
      ctx,
    );

    expect(published).toEqual(['a', 'b', 'c']);
    expect(ctx.output.npm.map((r) => r.packageName)).toEqual(['a', 'b', 'c']);
    expect(ctx.output.npm.every((r) => r.success)).toBe(true);
  });
});
