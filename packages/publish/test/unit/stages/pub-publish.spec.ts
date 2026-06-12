import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDefaultConfig } from '../../../src/config.js';
import { runPubPublishStage } from '../../../src/stages/pub-publish.js';
import type { PipelineContext } from '../../../src/types.js';

vi.mock('../../../src/utils/exec.js', async () => {
  const actual = await vi.importActual<typeof import('../../../src/utils/exec.js')>('../../../src/utils/exec.js');
  return {
    ...actual,
    execCommand: vi.fn().mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 }),
  };
});

vi.mock('../../../src/utils/auth.js', () => ({
  hasCargoAuth: vi.fn().mockReturnValue(true),
  hasPubTokenAuth: vi.fn().mockReturnValue(false),
}));

function createContext(cwd: string, overrides?: Partial<PipelineContext>): PipelineContext {
  const config = getDefaultConfig();
  config.pub.enabled = true;
  return {
    input: {
      dryRun: false,
      updates: [{ packageName: 'my_package', newVersion: '0.5.0', filePath: 'packages/my_package/pubspec.yaml' }],
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
      pub: [],
      verification: [],
      githubReleases: [],
      publishSucceeded: false,
    },
    ...overrides,
  };
}

function writePubspec(dir: string, name: string, version = '0.5.0', extraFields = '') {
  fs.writeFileSync(
    path.join(dir, 'pubspec.yaml'),
    `name: ${name}\nversion: ${version}\nenvironment:\n  sdk: ">=3.0.0 <4.0.0"\n${extraFields}`,
  );
}

describe('pub-publish stage', () => {
  const tmpDirs: string[] = [];

  function createTmpDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'releasekit-pub-test-'));
    tmpDirs.push(dir);
    return dir;
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    const { execCommand } = await import('../../../src/utils/exec.js');
    const { hasPubTokenAuth } = await import('../../../src/utils/auth.js');
    vi.mocked(execCommand).mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 });
    vi.mocked(hasPubTokenAuth).mockReturnValue(false);
    // pub.dev published-check defaults to "not published"
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 404 } as Response));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    for (const dir of tmpDirs) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    tmpDirs.length = 0;
  });

  it('should skip when pub disabled', async () => {
    const { execCommand } = await import('../../../src/utils/exec.js');
    const dir = createTmpDir();
    const config = getDefaultConfig();
    // pub.enabled defaults to false
    const ctx = createContext(dir, { config });

    await runPubPublishStage(ctx);

    expect(execCommand).not.toHaveBeenCalled();
  });

  it('should publish a dart package', async () => {
    const { execCommand } = await import('../../../src/utils/exec.js');
    const dir = createTmpDir();
    const pkgDir = path.join(dir, 'packages', 'my_package');
    fs.mkdirSync(pkgDir, { recursive: true });
    writePubspec(pkgDir, 'my_package');

    const ctx = createContext(dir);
    await runPubPublishStage(ctx);

    const publishCalls = vi.mocked(execCommand).mock.calls.filter((c) => (c[1] as string[]).includes('publish'));
    expect(publishCalls).toHaveLength(1);
    expect(publishCalls[0]?.[0]).toBe('dart');
    expect(publishCalls[0]?.[1]).toContain('--force');

    expect(ctx.output.pub).toHaveLength(1);
    expect(ctx.output.pub[0]?.success).toBe(true);
    expect(ctx.output.pub[0]?.registry).toBe('pub');
  });

  it('should use flutter command when pubspec has flutter environment key', async () => {
    const { execCommand } = await import('../../../src/utils/exec.js');
    const dir = createTmpDir();
    const pkgDir = path.join(dir, 'packages', 'my_package');
    fs.mkdirSync(pkgDir, { recursive: true });
    writePubspec(pkgDir, 'my_package', '0.5.0', '  flutter: ">=3.0.0"\n');

    const ctx = createContext(dir);
    await runPubPublishStage(ctx);

    const publishCalls = vi.mocked(execCommand).mock.calls.filter((c) => (c[1] as string[]).includes('publish'));
    expect(publishCalls[0]?.[0]).toBe('flutter');
  });

  it('should skip packages already published on pub.dev', async () => {
    const { execCommand } = await import('../../../src/utils/exec.js');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 200 } as Response));

    const dir = createTmpDir();
    const pkgDir = path.join(dir, 'packages', 'my_package');
    fs.mkdirSync(pkgDir, { recursive: true });
    writePubspec(pkgDir, 'my_package');

    const ctx = createContext(dir);
    await runPubPublishStage(ctx);

    const publishCalls = vi.mocked(execCommand).mock.calls.filter((c) => (c[1] as string[]).includes('publish'));
    expect(publishCalls).toHaveLength(0);
    expect(ctx.output.pub[0]?.alreadyPublished).toBe(true);
    expect(ctx.output.pub[0]?.skipped).toBe(true);
    expect(ctx.output.pub[0]?.success).toBe(true);
  });

  it('should publish a package only once when multiple updates share the same dir', async () => {
    const { execCommand } = await import('../../../src/utils/exec.js');
    const dir = createTmpDir();
    const pkgDir = path.join(dir, 'packages', 'my_package');
    fs.mkdirSync(pkgDir, { recursive: true });
    writePubspec(pkgDir, 'my_package');
    fs.writeFileSync(path.join(pkgDir, 'package.json'), '{"name":"my_package"}');

    const ctx = createContext(dir, {
      input: {
        dryRun: false,
        updates: [
          { packageName: 'my_package', newVersion: '0.5.0', filePath: 'packages/my_package/package.json' },
          { packageName: 'my_package', newVersion: '0.5.0', filePath: 'packages/my_package/pubspec.yaml' },
        ],
        changelogs: [],
        tags: [],
      },
    });
    await runPubPublishStage(ctx);

    const publishCalls = vi.mocked(execCommand).mock.calls.filter((c) => (c[1] as string[]).includes('publish'));
    expect(publishCalls).toHaveLength(1);
    expect(ctx.output.pub).toHaveLength(1);
  });

  it('should skip the pub.dev published-check for a custom publish_to but still publish', async () => {
    const { execCommand } = await import('../../../src/utils/exec.js');
    const fetchMock = vi.fn().mockResolvedValue({ status: 404 } as Response);
    vi.stubGlobal('fetch', fetchMock);

    const dir = createTmpDir();
    const pkgDir = path.join(dir, 'packages', 'my_package');
    fs.mkdirSync(pkgDir, { recursive: true });
    writePubspec(pkgDir, 'my_package', '0.5.0', 'publish_to: https://my-registry.example.com\n');

    const ctx = createContext(dir);
    await runPubPublishStage(ctx);

    // pub.dev API must not be queried for a custom registry
    expect(fetchMock).not.toHaveBeenCalled();

    const publishCalls = vi.mocked(execCommand).mock.calls.filter((c) => (c[1] as string[]).includes('publish'));
    expect(publishCalls).toHaveLength(1);
    expect(ctx.output.pub[0]?.success).toBe(true);
  });

  it('should skip packages without pubspec.yaml', async () => {
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
    await runPubPublishStage(ctx);

    const publishCalls = vi.mocked(execCommand).mock.calls.filter((c) => (c[1] as string[]).includes('publish'));
    expect(publishCalls).toHaveLength(0);
    expect(ctx.output.pub).toHaveLength(0);
  });

  it('should configure PUB_TOKEN when hasPubTokenAuth returns true', async () => {
    const { execCommand, hasPubTokenAuth } = await Promise.all([
      import('../../../src/utils/exec.js'),
      import('../../../src/utils/auth.js'),
    ]).then(([exec, auth]) => ({ execCommand: exec.execCommand, hasPubTokenAuth: auth.hasPubTokenAuth }));

    vi.mocked(hasPubTokenAuth).mockReturnValue(true);

    const dir = createTmpDir();
    const pkgDir = path.join(dir, 'packages', 'my_package');
    fs.mkdirSync(pkgDir, { recursive: true });
    writePubspec(pkgDir, 'my_package');

    const ctx = createContext(dir);
    await runPubPublishStage(ctx);

    const tokenCalls = vi
      .mocked(execCommand)
      .mock.calls.filter((c) => c[0] === 'dart' && (c[1] as string[]).includes('token'));
    expect(tokenCalls).toHaveLength(1);
    expect(tokenCalls[0]?.[1]).toContain('https://pub.dev');
    expect(tokenCalls[0]?.[1]).toContain('PUB_TOKEN');
  });

  it('should not configure token when hasPubTokenAuth returns false', async () => {
    const { execCommand } = await import('../../../src/utils/exec.js');
    const dir = createTmpDir();
    const pkgDir = path.join(dir, 'packages', 'my_package');
    fs.mkdirSync(pkgDir, { recursive: true });
    writePubspec(pkgDir, 'my_package');

    const ctx = createContext(dir);
    await runPubPublishStage(ctx);

    const tokenCalls = vi
      .mocked(execCommand)
      .mock.calls.filter((c) => c[0] === 'dart' && (c[1] as string[]).includes('token'));
    expect(tokenCalls).toHaveLength(0);
  });

  it('should respect publishOrder config', async () => {
    const { execCommand } = await import('../../../src/utils/exec.js');
    const dir = createTmpDir();

    const pkgADir = path.join(dir, 'packages', 'pkg_a');
    const pkgBDir = path.join(dir, 'packages', 'pkg_b');
    fs.mkdirSync(pkgADir, { recursive: true });
    fs.mkdirSync(pkgBDir, { recursive: true });
    writePubspec(pkgADir, 'pkg_a');
    writePubspec(pkgBDir, 'pkg_b');

    const config = getDefaultConfig();
    config.pub.enabled = true;
    config.pub.publishOrder = ['pkg_b', 'pkg_a'];

    const ctx = createContext(dir, {
      config,
      input: {
        dryRun: false,
        updates: [
          { packageName: 'pkg_a', newVersion: '1.0.0', filePath: 'packages/pkg_a/pubspec.yaml' },
          { packageName: 'pkg_b', newVersion: '1.0.0', filePath: 'packages/pkg_b/pubspec.yaml' },
        ],
        changelogs: [],
        tags: [],
      },
    });

    await runPubPublishStage(ctx);

    const publishCalls = vi.mocked(execCommand).mock.calls.filter((c) => (c[1] as string[]).includes('publish'));
    expect(publishCalls).toHaveLength(2);
    // pkg_b should come before pkg_a
    const cwds = publishCalls.map((c) => (c[2] as { cwd?: string })?.cwd ?? '');
    expect(cwds[0]).toContain('pkg_b');
    expect(cwds[1]).toContain('pkg_a');
  });

  it('should wrap dart pub token add failures as PUB_AUTH_ERROR', async () => {
    const { execCommand, hasPubTokenAuth } = await Promise.all([
      import('../../../src/utils/exec.js'),
      import('../../../src/utils/auth.js'),
    ]).then(([exec, auth]) => ({ execCommand: exec.execCommand, hasPubTokenAuth: auth.hasPubTokenAuth }));

    vi.mocked(hasPubTokenAuth).mockReturnValue(true);
    vi.mocked(execCommand).mockImplementation((cmd, args) => {
      if (cmd === 'dart' && (args as string[]).includes('token')) {
        return Promise.reject(new Error('dart: command not found'));
      }
      return Promise.resolve({ stdout: '', stderr: '', exitCode: 0 });
    });

    const dir = createTmpDir();
    const pkgDir = path.join(dir, 'packages', 'my_package');
    fs.mkdirSync(pkgDir, { recursive: true });
    writePubspec(pkgDir, 'my_package');

    const ctx = createContext(dir);

    await expect(runPubPublishStage(ctx)).rejects.toMatchObject({ code: 'PUB_AUTH_ERROR' });

    const publishCalls = vi.mocked(execCommand).mock.calls.filter((c) => (c[1] as string[]).includes('publish'));
    expect(publishCalls).toHaveLength(0);
  });

  it('should throw and record failure result when publish fails', async () => {
    const { execCommand } = await import('../../../src/utils/exec.js');
    vi.mocked(execCommand).mockRejectedValue(new Error('publish failed: connection timeout'));

    const dir = createTmpDir();
    const pkgDir = path.join(dir, 'packages', 'my_package');
    fs.mkdirSync(pkgDir, { recursive: true });
    writePubspec(pkgDir, 'my_package');

    const ctx = createContext(dir);

    await expect(runPubPublishStage(ctx)).rejects.toThrow();
    expect(ctx.output.pub[0]?.success).toBe(false);
  });

  it('should send User-Agent header in pub.dev published-check', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ status: 404 } as Response);
    vi.stubGlobal('fetch', fetchMock);

    const dir = createTmpDir();
    const pkgDir = path.join(dir, 'packages', 'my_package');
    fs.mkdirSync(pkgDir, { recursive: true });
    writePubspec(pkgDir, 'my_package');

    const ctx = createContext(dir);
    await runPubPublishStage(ctx);

    expect(fetchMock).toHaveBeenCalledOnce();
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init?.headers as Record<string, string>)?.['User-Agent']).toMatch(/releasekit/);
  });
});
