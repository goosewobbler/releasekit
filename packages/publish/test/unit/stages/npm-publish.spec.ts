import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDefaultConfig } from '../../../src/config.js';
import { runNpmPublishStage } from '../../../src/stages/npm-publish.js';
import type { PipelineContext } from '../../../src/types.js';

vi.mock('../../../src/utils/exec.js', () => ({
  execCommand: vi.fn().mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 }),
  execCommandSafe: vi.fn().mockResolvedValue({ stdout: '', stderr: '', exitCode: 1 }), // not published by default
}));

vi.mock('../../../src/utils/auth.js', () => ({
  detectNpmAuth: vi.fn().mockReturnValue('token'),
}));

function createContext(cwd: string, overrides?: Partial<PipelineContext>): PipelineContext {
  return {
    input: {
      dryRun: false,
      updates: [{ packageName: '@test/pkg', newVersion: '1.0.0', filePath: 'packages/pkg/package.json' }],
      changelogs: [],
      tags: [],
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

describe('npm-publish stage', () => {
  const tmpDirs: string[] = [];
  const originalEnv = { ...process.env };

  function createTmpDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'releasekit-npm-test-'));
    tmpDirs.push(dir);
    return dir;
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    // Reset default mock return values after clearAllMocks
    const { execCommand, execCommandSafe } = await import('../../../src/utils/exec.js');
    const { detectNpmAuth } = await import('../../../src/utils/auth.js');
    vi.mocked(execCommand).mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 });
    vi.mocked(execCommandSafe).mockResolvedValue({ stdout: '', stderr: '', exitCode: 1 }); // not published
    vi.mocked(detectNpmAuth).mockReturnValue('token');
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    for (const dir of tmpDirs) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    tmpDirs.length = 0;
  });

  it('should publish a public package', async () => {
    const { execCommand } = await import('../../../src/utils/exec.js');
    const dir = createTmpDir();
    const pkgDir = path.join(dir, 'packages', 'pkg');
    fs.mkdirSync(pkgDir, { recursive: true });
    fs.writeFileSync(path.join(pkgDir, 'package.json'), JSON.stringify({ name: '@test/pkg', version: '1.0.0' }));

    process.env.NPM_TOKEN = 'npm_test_token';
    const ctx = createContext(dir);
    await runNpmPublishStage(ctx);

    expect(execCommand).toHaveBeenCalledTimes(1);
    const call = vi.mocked(execCommand).mock.calls[0];
    expect(call?.[0]).toBe('pnpm');
    const args = call?.[1] as string[];
    expect(args).toContain('publish');
    expect(args).toEqual(expect.arrayContaining(['--filter', '@test/pkg']));
    expect(args).toEqual(expect.arrayContaining(['--access', 'public']));
    expect(args).toEqual(expect.arrayContaining(['--tag', 'latest']));

    const options = call?.[2];
    expect(options?.env?.NPM_CONFIG_USERCONFIG).toBeTruthy();
    expect(options?.env?.NODE_AUTH_TOKEN).toBe('npm_test_token');

    expect(ctx.output.npm).toHaveLength(1);
    expect(ctx.output.npm[0]?.success).toBe(true);
  });

  it('should skip private packages', async () => {
    const { execCommand } = await import('../../../src/utils/exec.js');
    const dir = createTmpDir();
    const pkgDir = path.join(dir, 'packages', 'pkg');
    fs.mkdirSync(pkgDir, { recursive: true });
    fs.writeFileSync(
      path.join(pkgDir, 'package.json'),
      JSON.stringify({ name: '@test/pkg', version: '1.0.0', private: true }),
    );

    const ctx = createContext(dir);
    await runNpmPublishStage(ctx);

    expect(execCommand).not.toHaveBeenCalled();
    expect(ctx.output.npm[0]?.skipped).toBe(true);
    expect(ctx.output.npm[0]?.reason).toContain('private');
  });

  it('should skip already-published packages', async () => {
    const { execCommand, execCommandSafe } = await import('../../../src/utils/exec.js');
    vi.mocked(execCommandSafe).mockResolvedValue({ stdout: '"1.0.0"', stderr: '', exitCode: 0 });

    const dir = createTmpDir();
    const pkgDir = path.join(dir, 'packages', 'pkg');
    fs.mkdirSync(pkgDir, { recursive: true });
    fs.writeFileSync(path.join(pkgDir, 'package.json'), JSON.stringify({ name: '@test/pkg', version: '1.0.0' }));

    const ctx = createContext(dir);
    await runNpmPublishStage(ctx);

    expect(execCommand).not.toHaveBeenCalled();
    expect(ctx.output.npm[0]?.alreadyPublished).toBe(true);
  });

  it('should use "next" dist-tag for pre-release versions', async () => {
    const { execCommand } = await import('../../../src/utils/exec.js');
    const dir = createTmpDir();
    const pkgDir = path.join(dir, 'packages', 'pkg');
    fs.mkdirSync(pkgDir, { recursive: true });
    fs.writeFileSync(path.join(pkgDir, 'package.json'), JSON.stringify({ name: '@test/pkg', version: '1.0.0-next.1' }));

    const ctx = createContext(dir, {
      input: {
        dryRun: false,
        updates: [{ packageName: '@test/pkg', newVersion: '1.0.0-next.1', filePath: 'packages/pkg/package.json' }],
        changelogs: [],
        tags: [],
      },
    });

    await runNpmPublishStage(ctx);

    const args = vi.mocked(execCommand).mock.calls[0]?.[1] as string[];
    expect(args).toEqual(expect.arrayContaining(['--tag', 'next']));
  });

  it('should add --provenance when OIDC auth', async () => {
    const { execCommand } = await import('../../../src/utils/exec.js');
    const { detectNpmAuth } = await import('../../../src/utils/auth.js');
    vi.mocked(detectNpmAuth).mockReturnValue('oidc');
    process.env.NODE_AUTH_TOKEN = 'should_be_ignored';

    const dir = createTmpDir();
    const pkgDir = path.join(dir, 'packages', 'pkg');
    fs.mkdirSync(pkgDir, { recursive: true });
    fs.writeFileSync(path.join(pkgDir, 'package.json'), JSON.stringify({ name: '@test/pkg', version: '1.0.0' }));

    const ctx = createContext(dir);
    await runNpmPublishStage(ctx);

    const args = vi.mocked(execCommand).mock.calls[0]?.[1] as string[];
    expect(args).toContain('--provenance');

    const options = vi.mocked(execCommand).mock.calls[0]?.[2];
    expect(options?.env?.NPM_CONFIG_USERCONFIG).toBeTruthy();
    expect(options?.env?.NODE_AUTH_TOKEN).toBeUndefined();
  });

  it('should not add --provenance when token auth', async () => {
    const { execCommand } = await import('../../../src/utils/exec.js');
    const { detectNpmAuth } = await import('../../../src/utils/auth.js');
    vi.mocked(detectNpmAuth).mockReturnValue('token');

    const dir = createTmpDir();
    const pkgDir = path.join(dir, 'packages', 'pkg');
    fs.mkdirSync(pkgDir, { recursive: true });
    fs.writeFileSync(path.join(pkgDir, 'package.json'), JSON.stringify({ name: '@test/pkg', version: '1.0.0' }));

    const ctx = createContext(dir);
    await runNpmPublishStage(ctx);

    const args = vi.mocked(execCommand).mock.calls[0]?.[1] as string[];
    expect(args).not.toContain('--provenance');
  });

  it('should skip when npm disabled', async () => {
    const { execCommand } = await import('../../../src/utils/exec.js');
    const config = getDefaultConfig();
    config.npm.enabled = false;

    const dir = createTmpDir();
    const ctx = createContext(dir, { config });
    await runNpmPublishStage(ctx);

    expect(execCommand).not.toHaveBeenCalled();
  });
});
