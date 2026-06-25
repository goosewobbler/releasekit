import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createFakeGit, type FakeGit, type FakeGitSeed } from '@releasekit/git';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDefaultConfig } from '../../../src/config.js';
import { runCargoPublishStage } from '../../../src/stages/cargo-publish.js';
import type { PipelineContext } from '../../../src/types.js';

vi.mock('../../../src/utils/exec.js', async () => {
  const actual = await vi.importActual<typeof import('../../../src/utils/exec.js')>('../../../src/utils/exec.js');
  return {
    ...actual,
    execCommand: vi.fn().mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 }),
  };
});

// The cargo stage's working-dir dirty-check goes through `@releasekit/git`. Seed the fake per test;
// the default (empty status) reads as a clean tree.
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

vi.mock('../../../src/utils/auth.js', () => ({
  hasCargoAuth: vi.fn().mockReturnValue(true),
}));

function createContext(cwd: string, overrides?: Partial<PipelineContext>): PipelineContext {
  const config = getDefaultConfig();
  config.cargo.enabled = true;
  return {
    input: {
      dryRun: false,
      updates: [{ packageName: 'my-crate', newVersion: '0.5.0', filePath: 'crates/my-crate/Cargo.toml' }],
      changelogs: [],
      tags: [],
    },
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
    cwd,
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

describe('cargo-publish stage', () => {
  const tmpDirs: string[] = [];

  function createTmpDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'releasekit-cargo-test-'));
    tmpDirs.push(dir);
    return dir;
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    // Reset default mock return values after clearAllMocks
    const { execCommand } = await import('../../../src/utils/exec.js');
    const { hasCargoAuth } = await import('../../../src/utils/auth.js');
    vi.mocked(execCommand).mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 });
    vi.mocked(hasCargoAuth).mockReturnValue(true);
    seedGit(); // clean working tree by default
    // crates.io published-check defaults to "not published"
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 404 } as Response));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    for (const dir of tmpDirs) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    tmpDirs.length = 0;
  });

  it('should skip when cargo disabled', async () => {
    const { execCommand } = await import('../../../src/utils/exec.js');
    const dir = createTmpDir();
    const config = getDefaultConfig();
    // cargo.enabled defaults to false
    const ctx = createContext(dir, { config });

    await runCargoPublishStage(ctx);

    expect(execCommand).not.toHaveBeenCalled();
  });

  it('should publish a crate', async () => {
    const { execCommand } = await import('../../../src/utils/exec.js');
    const dir = createTmpDir();
    const crateDir = path.join(dir, 'crates', 'my-crate');
    fs.mkdirSync(crateDir, { recursive: true });
    fs.writeFileSync(path.join(crateDir, 'Cargo.toml'), '[package]\nname = "my-crate"\nversion = "0.5.0"\n');

    const ctx = createContext(dir);
    await runCargoPublishStage(ctx);

    // execCommand should have been called for cargo publish
    const publishCalls = vi
      .mocked(execCommand)
      .mock.calls.filter((c) => c[0] === 'cargo' && (c[1] as string[])[0] === 'publish');
    expect(publishCalls).toHaveLength(1);
    expect(publishCalls[0]?.[1]).toContain('--manifest-path');

    expect(ctx.output.cargo).toHaveLength(1);
    expect(ctx.output.cargo[0]?.success).toBe(true);
  });

  it('should skip already-published crates', async () => {
    const { execCommand } = await import('../../../src/utils/exec.js');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 200 } as Response));

    const dir = createTmpDir();
    const crateDir = path.join(dir, 'crates', 'my-crate');
    fs.mkdirSync(crateDir, { recursive: true });
    fs.writeFileSync(path.join(crateDir, 'Cargo.toml'), '[package]\nname = "my-crate"\nversion = "0.5.0"\n');

    const ctx = createContext(dir);
    await runCargoPublishStage(ctx);

    const publishCalls = vi
      .mocked(execCommand)
      .mock.calls.filter((c) => c[0] === 'cargo' && (c[1] as string[])[0] === 'publish');
    expect(publishCalls).toHaveLength(0);
    expect(ctx.output.cargo[0]?.alreadyPublished).toBe(true);
  });

  it('should treat "already exists on crates.io index" publish errors as already-published', async () => {
    const { execCommand } = await import('../../../src/utils/exec.js');
    // Pre-check returns 404 (API lag), but cargo publish then rejects.
    vi.mocked(execCommand).mockImplementation(async (cmd, args) => {
      if (cmd === 'cargo' && (args as string[])[0] === 'publish') {
        throw Object.assign(new Error('Command failed: cargo publish ...'), {
          stdout: '',
          stderr: 'error: crate my-crate@0.5.0 already exists on crates.io index',
          exitCode: 101,
        });
      }
      return { stdout: '', stderr: '', exitCode: 0 };
    });

    const dir = createTmpDir();
    const crateDir = path.join(dir, 'crates', 'my-crate');
    fs.mkdirSync(crateDir, { recursive: true });
    fs.writeFileSync(path.join(crateDir, 'Cargo.toml'), '[package]\nname = "my-crate"\nversion = "0.5.0"\n');

    const ctx = createContext(dir);
    await expect(runCargoPublishStage(ctx)).resolves.toBeUndefined();

    expect(ctx.output.cargo[0]?.alreadyPublished).toBe(true);
    expect(ctx.output.cargo[0]?.success).toBe(true);
    expect(ctx.output.cargo[0]?.skipped).toBe(true);
  });

  it('should still throw on unrelated cargo publish failures', async () => {
    const { execCommand } = await import('../../../src/utils/exec.js');
    vi.mocked(execCommand).mockImplementation(async (cmd, args) => {
      if (cmd === 'cargo' && (args as string[])[0] === 'publish') {
        throw Object.assign(new Error('Command failed: cargo publish ...'), {
          stdout: '',
          stderr: 'error: failed to verify package tarball',
          exitCode: 101,
        });
      }
      return { stdout: '', stderr: '', exitCode: 0 };
    });

    const dir = createTmpDir();
    const crateDir = path.join(dir, 'crates', 'my-crate');
    fs.mkdirSync(crateDir, { recursive: true });
    fs.writeFileSync(path.join(crateDir, 'Cargo.toml'), '[package]\nname = "my-crate"\nversion = "0.5.0"\n');

    const ctx = createContext(dir);
    await expect(runCargoPublishStage(ctx)).rejects.toThrow();
  });

  it('should fail fast (zero retries) on an unrelated cargo publish failure', async () => {
    const { execCommand } = await import('../../../src/utils/exec.js');
    let publishCalls = 0;
    vi.mocked(execCommand).mockImplementation(async (cmd, args) => {
      if (cmd === 'cargo' && (args as string[])[0] === 'publish') {
        publishCalls++;
        throw Object.assign(new Error('Command failed: cargo publish ...'), {
          stdout: '',
          stderr: 'error: failed to verify package tarball',
          exitCode: 101,
        });
      }
      return { stdout: '', stderr: '', exitCode: 0 };
    });

    const dir = createTmpDir();
    const crateDir = path.join(dir, 'crates', 'my-crate');
    fs.mkdirSync(crateDir, { recursive: true });
    fs.writeFileSync(path.join(crateDir, 'Cargo.toml'), '[package]\nname = "my-crate"\nversion = "0.5.0"\n');

    const ctx = createContext(dir);
    await expect(runCargoPublishStage(ctx)).rejects.toThrow();
    expect(publishCalls).toBe(1); // permanent error, no retries
  });

  it('should retry a transient cargo publish error and succeed, recording attempts', async () => {
    vi.useFakeTimers();
    try {
      const { execCommand } = await import('../../../src/utils/exec.js');
      let publishCalls = 0;
      vi.mocked(execCommand).mockImplementation(async (cmd, args) => {
        if (cmd === 'cargo' && (args as string[])[0] === 'publish') {
          publishCalls++;
          if (publishCalls === 1) {
            throw Object.assign(new Error('Command failed: cargo publish ...'), {
              stdout: '',
              stderr: 'error: failed to get a 200 OK response, got 503 Service Unavailable',
              exitCode: 101,
            });
          }
        }
        return { stdout: '', stderr: '', exitCode: 0 };
      });

      const dir = createTmpDir();
      const crateDir = path.join(dir, 'crates', 'my-crate');
      fs.mkdirSync(crateDir, { recursive: true });
      fs.writeFileSync(path.join(crateDir, 'Cargo.toml'), '[package]\nname = "my-crate"\nversion = "0.5.0"\n');

      const ctx = createContext(dir);
      const promise = runCargoPublishStage(ctx);
      await vi.runAllTimersAsync();
      await promise;

      expect(publishCalls).toBe(2);
      expect(ctx.output.cargo[0]?.success).toBe(true);
      expect(ctx.output.cargo[0]?.attempts).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('should resolve a retried cargo publish as already-published (no duplicate)', async () => {
    vi.useFakeTimers();
    try {
      const { execCommand } = await import('../../../src/utils/exec.js');
      let publishCalls = 0;
      vi.mocked(execCommand).mockImplementation(async (cmd, args) => {
        if (cmd === 'cargo' && (args as string[])[0] === 'publish') {
          publishCalls++;
          if (publishCalls === 1) {
            throw Object.assign(new Error('Command failed: cargo publish ...'), {
              stdout: '',
              stderr: 'error: failed to get a 200 OK response, got 503 Service Unavailable',
              exitCode: 101,
            });
          }
          throw Object.assign(new Error('Command failed: cargo publish ...'), {
            stdout: '',
            stderr: 'error: crate my-crate@0.5.0 already exists on crates.io index',
            exitCode: 101,
          });
        }
        return { stdout: '', stderr: '', exitCode: 0 };
      });

      const dir = createTmpDir();
      const crateDir = path.join(dir, 'crates', 'my-crate');
      fs.mkdirSync(crateDir, { recursive: true });
      fs.writeFileSync(path.join(crateDir, 'Cargo.toml'), '[package]\nname = "my-crate"\nversion = "0.5.0"\n');

      const ctx = createContext(dir);
      const promise = runCargoPublishStage(ctx);
      await vi.runAllTimersAsync();
      await expect(promise).resolves.toBeUndefined();

      expect(publishCalls).toBe(2); // already-exists is not retried further
      expect(ctx.output.cargo[0]?.alreadyPublished).toBe(true);
      expect(ctx.output.cargo[0]?.skipped).toBe(true);
      expect(ctx.output.cargo[0]?.success).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('should pass --no-verify when configured', async () => {
    const { execCommand } = await import('../../../src/utils/exec.js');
    const dir = createTmpDir();
    const crateDir = path.join(dir, 'crates', 'my-crate');
    fs.mkdirSync(crateDir, { recursive: true });
    fs.writeFileSync(path.join(crateDir, 'Cargo.toml'), '[package]\nname = "my-crate"\nversion = "0.5.0"\n');

    const config = getDefaultConfig();
    config.cargo.enabled = true;
    config.cargo.noVerify = true;
    const ctx = createContext(dir, { config });
    await runCargoPublishStage(ctx);

    const publishCalls = vi
      .mocked(execCommand)
      .mock.calls.filter((c) => c[0] === 'cargo' && (c[1] as string[])[0] === 'publish');
    expect(publishCalls[0]?.[1]).toContain('--no-verify');
  });

  it('should pass --allow-dirty when git working directory is dirty', async () => {
    const { execCommand } = await import('../../../src/utils/exec.js');
    const dir = createTmpDir();
    const crateDir = path.join(dir, 'crates', 'my-crate');
    fs.mkdirSync(crateDir, { recursive: true });
    fs.writeFileSync(path.join(crateDir, 'Cargo.toml'), '[package]\nname = "my-crate"\nversion = "0.5.0"\n');

    // Seed git status to report a dirty working directory
    seedGit({ status: 'M some-file.txt' });

    const ctx = createContext(dir);
    await runCargoPublishStage(ctx);

    const publishCalls = vi
      .mocked(execCommand)
      .mock.calls.filter((c) => c[0] === 'cargo' && (c[1] as string[])[0] === 'publish');
    expect(publishCalls[0]?.[1]).toContain('--allow-dirty');
  });

  it('should not pass --allow-dirty when git working directory is clean', async () => {
    const { execCommand } = await import('../../../src/utils/exec.js');
    const dir = createTmpDir();
    const crateDir = path.join(dir, 'crates', 'my-crate');
    fs.mkdirSync(crateDir, { recursive: true });
    fs.writeFileSync(path.join(crateDir, 'Cargo.toml'), '[package]\nname = "my-crate"\nversion = "0.5.0"\n');

    // Seed git status to report a clean working directory (default, but explicit here)
    seedGit({ status: '' });

    const ctx = createContext(dir);
    await runCargoPublishStage(ctx);

    const publishCalls = vi
      .mocked(execCommand)
      .mock.calls.filter((c) => c[0] === 'cargo' && (c[1] as string[])[0] === 'publish');
    expect(publishCalls[0]?.[1]).not.toContain('--allow-dirty');
  });

  it('should proceed to publish when crates.io published-check returns 403', async () => {
    const { execCommand } = await import('../../../src/utils/exec.js');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 403 } as Response));

    const dir = createTmpDir();
    const crateDir = path.join(dir, 'crates', 'my-crate');
    fs.mkdirSync(crateDir, { recursive: true });
    fs.writeFileSync(path.join(crateDir, 'Cargo.toml'), '[package]\nname = "my-crate"\nversion = "0.5.0"\n');

    const ctx = createContext(dir);
    await runCargoPublishStage(ctx);

    const publishCalls = vi
      .mocked(execCommand)
      .mock.calls.filter((c) => c[0] === 'cargo' && (c[1] as string[])[0] === 'publish');
    expect(publishCalls).toHaveLength(1);
    expect(ctx.output.cargo[0]?.alreadyPublished).toBeUndefined();
  });

  it('should send User-Agent header in crates.io published-check', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ status: 404 } as Response);
    vi.stubGlobal('fetch', fetchMock);

    const dir = createTmpDir();
    const crateDir = path.join(dir, 'crates', 'my-crate');
    fs.mkdirSync(crateDir, { recursive: true });
    fs.writeFileSync(path.join(crateDir, 'Cargo.toml'), '[package]\nname = "my-crate"\nversion = "0.5.0"\n');

    const ctx = createContext(dir);
    await runCargoPublishStage(ctx);

    expect(fetchMock).toHaveBeenCalledOnce();
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init?.headers as Record<string, string>)?.['User-Agent']).toMatch(/releasekit/);
  });

  it('should skip packages without Cargo.toml', async () => {
    const { execCommand } = await import('../../../src/utils/exec.js');
    const dir = createTmpDir();
    const pkgDir = path.join(dir, 'packages', 'js-only');
    fs.mkdirSync(pkgDir, { recursive: true });
    fs.writeFileSync(path.join(pkgDir, 'package.json'), '{"name":"js-only"}');

    const ctx = createContext(dir, {
      input: {
        dryRun: false,
        updates: [{ packageName: 'js-only', newVersion: '1.0.0', filePath: 'packages/js-only/package.json' }],
        changelogs: [],
        tags: [],
      },
    });
    await runCargoPublishStage(ctx);

    const publishCalls = vi
      .mocked(execCommand)
      .mock.calls.filter((c) => c[0] === 'cargo' && (c[1] as string[])[0] === 'publish');
    expect(publishCalls).toHaveLength(0);
    expect(ctx.output.cargo).toHaveLength(0);
  });
});
