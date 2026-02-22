import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDefaultConfig } from '../../../src/config.js';
import { runPrepareStage } from '../../../src/stages/prepare.js';
import type { PipelineContext } from '../../../src/types.js';

function createContext(overrides?: Partial<PipelineContext>): PipelineContext {
  return {
    input: {
      dryRun: false,
      updates: [],
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
    cwd: process.cwd(),
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

describe('prepare stage', () => {
  const tmpDirs: string[] = [];

  function createTmpDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'releasekit-prepare-test-'));
    tmpDirs.push(dir);
    return dir;
  }

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    for (const dir of tmpDirs) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    tmpDirs.length = 0;
  });

  it('should copy LICENSE to package directories', async () => {
    const dir = createTmpDir();
    const pkgDir = path.join(dir, 'packages', 'foo');
    fs.mkdirSync(pkgDir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'LICENSE'), 'MIT License');
    fs.writeFileSync(path.join(pkgDir, 'package.json'), '{"name":"foo","version":"1.0.0"}');

    const ctx = createContext({
      cwd: dir,
      input: {
        dryRun: false,
        updates: [{ packageName: 'foo', newVersion: '1.1.0', filePath: 'packages/foo/package.json' }],
        changelogs: [],
        tags: [],
      },
    });

    await runPrepareStage(ctx);

    expect(fs.existsSync(path.join(pkgDir, 'LICENSE'))).toBe(true);
    expect(fs.readFileSync(path.join(pkgDir, 'LICENSE'), 'utf-8')).toBe('MIT License');
  });

  it('should skip copy if source file does not exist', async () => {
    const dir = createTmpDir();
    const pkgDir = path.join(dir, 'packages', 'foo');
    fs.mkdirSync(pkgDir, { recursive: true });
    fs.writeFileSync(path.join(pkgDir, 'package.json'), '{"name":"foo","version":"1.0.0"}');

    const ctx = createContext({
      cwd: dir,
      input: {
        dryRun: false,
        updates: [{ packageName: 'foo', newVersion: '1.1.0', filePath: 'packages/foo/package.json' }],
        changelogs: [],
        tags: [],
      },
    });

    // Should not throw
    await runPrepareStage(ctx);
    expect(fs.existsSync(path.join(pkgDir, 'LICENSE'))).toBe(false);
  });

  it('should not copy files in dry-run mode', async () => {
    const dir = createTmpDir();
    const pkgDir = path.join(dir, 'packages', 'foo');
    fs.mkdirSync(pkgDir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'LICENSE'), 'MIT License');
    fs.writeFileSync(path.join(pkgDir, 'package.json'), '{"name":"foo","version":"1.0.0"}');

    const ctx = createContext({
      cwd: dir,
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
      input: {
        dryRun: false,
        updates: [{ packageName: 'foo', newVersion: '1.1.0', filePath: 'packages/foo/package.json' }],
        changelogs: [],
        tags: [],
      },
    });

    await runPrepareStage(ctx);
    expect(fs.existsSync(path.join(pkgDir, 'LICENSE'))).toBe(false);
  });

  it('should skip copy when source and destination are the same directory', async () => {
    const dir = createTmpDir();
    fs.writeFileSync(path.join(dir, 'LICENSE'), 'MIT License');
    fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"root","version":"1.0.0"}');

    const ctx = createContext({
      cwd: dir,
      input: {
        dryRun: false,
        updates: [{ packageName: 'root', newVersion: '1.1.0', filePath: 'package.json' }],
        changelogs: [],
        tags: [],
      },
    });

    // Should not throw or overwrite — LICENSE should remain unchanged
    await runPrepareStage(ctx);
    expect(fs.readFileSync(path.join(dir, 'LICENSE'), 'utf-8')).toBe('MIT License');
  });
});
