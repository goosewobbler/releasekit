import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDefaultConfig } from '../../../src/config.js';
import { runPrepareStage } from '../../../src/stages/prepare.js';
import type { PipelineContext } from '../../../src/types.js';

/** A committed lock listing the path crate `foo` at `version`. */
const fooLock = (version: string): string => `version = 4\n\n[[package]]\nname = "foo"\nversion = "${version}"\n`;

/** A fixture app's manifest and committed lock: the app uses `foo` (at `version`) by path. */
const appManifestUsingFoo =
  '[package]\nname = "app"\nversion = "0.1.0"\n\n[workspace]\n\n[dependencies]\nfoo = { path = "../../crates/foo" }\n';
const appLockUsingFoo = (version: string): string =>
  `${fooLock(version)}\n[[package]]\nname = "app"\nversion = "0.1.0"\ndependencies = [\n "foo",\n]\n`;

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

  it('should sync and stage the workspace Cargo.lock alongside a bumped crate', async () => {
    const dir = createTmpDir();
    fs.writeFileSync(path.join(dir, 'Cargo.toml'), '[workspace]\nmembers = ["crates/foo"]\n');
    const crateDir = path.join(dir, 'crates', 'foo');
    fs.mkdirSync(crateDir, { recursive: true });
    fs.writeFileSync(path.join(crateDir, 'Cargo.toml'), '[package]\nname = "foo"\nversion = "1.0.0"\n');
    const lockPath = path.join(dir, 'Cargo.lock');
    fs.writeFileSync(lockPath, fooLock('1.0.0'));

    const config = getDefaultConfig();
    config.cargo.enabled = true;
    const ctx = createContext({
      cwd: dir,
      config,
      input: {
        dryRun: false,
        updates: [{ packageName: 'foo', newVersion: '1.1.0', filePath: 'crates/foo/Cargo.toml' }],
        changelogs: [],
        tags: [],
      },
    });

    await runPrepareStage(ctx);

    expect(fs.readFileSync(lockPath, 'utf-8')).toBe(fooLock('1.1.0'));
    expect(ctx.additionalFiles).toContain(lockPath);
  });

  it('should sync and stage a committed fixture-app lock that uses the crate by path', async () => {
    const dir = createTmpDir();
    const crateDir = path.join(dir, 'crates', 'foo');
    fs.mkdirSync(crateDir, { recursive: true });
    fs.writeFileSync(path.join(crateDir, 'Cargo.toml'), '[package]\nname = "foo"\nversion = "1.0.0"\n');
    const ownLock = path.join(crateDir, 'Cargo.lock');
    fs.writeFileSync(ownLock, fooLock('1.0.0'));
    const appLock = path.join(dir, 'fixtures', 'app', 'Cargo.lock');
    fs.mkdirSync(path.dirname(appLock), { recursive: true });
    fs.writeFileSync(path.join(path.dirname(appLock), 'Cargo.toml'), appManifestUsingFoo);
    fs.writeFileSync(appLock, appLockUsingFoo('1.0.0'));
    execFileSync('git', ['init', '-q'], { cwd: dir });
    execFileSync('git', ['add', '-A'], { cwd: dir });

    const config = getDefaultConfig();
    config.cargo.enabled = true;
    const ctx = createContext({
      cwd: dir,
      config,
      input: {
        dryRun: false,
        updates: [{ packageName: 'foo', newVersion: '1.1.0', filePath: 'crates/foo/Cargo.toml' }],
        changelogs: [],
        tags: [],
      },
    });

    await runPrepareStage(ctx);

    expect(fs.readFileSync(ownLock, 'utf-8')).toBe(fooLock('1.1.0'));
    expect(fs.readFileSync(appLock, 'utf-8')).toBe(appLockUsingFoo('1.1.0'));
    expect(ctx.additionalFiles).toEqual(expect.arrayContaining([ownLock, appLock]));
  });

  it('should not fail the publish when a lock cannot be synced', async () => {
    const dir = createTmpDir();
    const crateDir = path.join(dir, 'crates', 'foo');
    fs.mkdirSync(crateDir, { recursive: true });
    fs.writeFileSync(path.join(crateDir, 'Cargo.toml'), '[package]\nname = "foo"\nversion = "1.0.0"\n');
    const lockPath = path.join(crateDir, 'Cargo.lock');
    const ambiguous = `${fooLock('1.0.0')}\n[[package]]\nname = "foo"\nversion = "1.1.0"\nsource = "registry+https://github.com/rust-lang/crates.io-index"\n`;
    fs.writeFileSync(lockPath, ambiguous);

    const config = getDefaultConfig();
    config.cargo.enabled = true;
    const ctx = createContext({
      cwd: dir,
      config,
      input: {
        dryRun: false,
        updates: [{ packageName: 'foo', newVersion: '1.1.0', filePath: 'crates/foo/Cargo.toml' }],
        changelogs: [],
        tags: [],
      },
    });

    await runPrepareStage(ctx);

    expect(fs.readFileSync(path.join(crateDir, 'Cargo.toml'), 'utf-8')).toContain('version = "1.1.0"');
    expect(fs.readFileSync(lockPath, 'utf-8')).toBe(ambiguous);
    expect(ctx.additionalFiles ?? []).not.toContain(lockPath);
  });

  it('should still stage the Cargo.lock files the version step already synced', async () => {
    const dir = createTmpDir();
    const crateDir = path.join(dir, 'crates', 'foo');
    fs.mkdirSync(crateDir, { recursive: true });
    fs.writeFileSync(path.join(crateDir, 'Cargo.toml'), '[package]\nname = "foo"\nversion = "1.1.0"\n');
    const lockPath = path.join(crateDir, 'Cargo.lock');
    fs.writeFileSync(lockPath, fooLock('1.1.0'));
    const appLock = path.join(dir, 'fixtures', 'app', 'Cargo.lock');
    fs.mkdirSync(path.dirname(appLock), { recursive: true });
    fs.writeFileSync(path.join(path.dirname(appLock), 'Cargo.toml'), appManifestUsingFoo);
    fs.writeFileSync(appLock, appLockUsingFoo('1.1.0'));
    execFileSync('git', ['init', '-q'], { cwd: dir });
    execFileSync('git', ['add', '-A'], { cwd: dir });

    const config = getDefaultConfig();
    config.cargo.enabled = true;
    const ctx = createContext({
      cwd: dir,
      config,
      input: {
        dryRun: false,
        updates: [{ packageName: 'foo', newVersion: '1.1.0', filePath: 'crates/foo/Cargo.toml' }],
        changelogs: [],
        tags: [],
      },
    });

    await runPrepareStage(ctx);

    expect(ctx.additionalFiles).toEqual(expect.arrayContaining([lockPath, appLock]));
  });

  it('should neither sync nor stage a crate’s own Cargo.lock that git ignores', async () => {
    // `git add` refuses an ignored path, which would fail the direct-commit release.
    const dir = createTmpDir();
    const crateDir = path.join(dir, 'crates', 'foo');
    fs.mkdirSync(crateDir, { recursive: true });
    fs.writeFileSync(path.join(crateDir, 'Cargo.toml'), '[package]\nname = "foo"\nversion = "1.0.0"\n');
    const lockPath = path.join(crateDir, 'Cargo.lock');
    fs.writeFileSync(lockPath, fooLock('1.0.0'));
    fs.writeFileSync(path.join(dir, '.gitignore'), 'Cargo.lock\n');
    execFileSync('git', ['init', '-q'], { cwd: dir });
    execFileSync('git', ['add', '-A'], { cwd: dir });

    const config = getDefaultConfig();
    config.cargo.enabled = true;
    const ctx = createContext({
      cwd: dir,
      config,
      input: {
        dryRun: false,
        updates: [{ packageName: 'foo', newVersion: '1.1.0', filePath: 'crates/foo/Cargo.toml' }],
        changelogs: [],
        tags: [],
      },
    });

    await runPrepareStage(ctx);

    expect(fs.readFileSync(lockPath, 'utf-8')).toBe(fooLock('1.0.0'));
    expect(ctx.additionalFiles ?? []).not.toContain(lockPath);
  });

  it("should stage a hybrid package's Cargo.toml", async () => {
    const dir = createTmpDir();
    const pkgDir = path.join(dir, 'packages', 'foo');
    fs.mkdirSync(pkgDir, { recursive: true });
    fs.writeFileSync(path.join(pkgDir, 'package.json'), '{ "name": "foo", "version": "1.1.0" }\n');
    const cargoPath = path.join(pkgDir, 'Cargo.toml');
    fs.writeFileSync(cargoPath, '[package]\nname = "foo"\nversion = "1.0.0"\n');

    const config = getDefaultConfig();
    config.cargo.enabled = true;
    const ctx = createContext({
      cwd: dir,
      config,
      additionalFiles: ['CHANGELOG.md'],
      input: {
        dryRun: false,
        updates: [{ packageName: 'foo', newVersion: '1.1.0', filePath: 'packages/foo/package.json' }],
        changelogs: [],
        tags: [],
      },
    });

    await runPrepareStage(ctx);

    expect(fs.readFileSync(cargoPath, 'utf-8')).toContain('version = "1.1.0"');
    expect(ctx.additionalFiles).toEqual(['CHANGELOG.md', cargoPath]);
  });

  it('should not stage a Cargo.lock in dry-run mode', async () => {
    const dir = createTmpDir();
    const crateDir = path.join(dir, 'crates', 'foo');
    fs.mkdirSync(crateDir, { recursive: true });
    fs.writeFileSync(path.join(crateDir, 'Cargo.toml'), '[package]\nname = "foo"\nversion = "1.0.0"\n');
    fs.writeFileSync(path.join(dir, 'Cargo.toml'), '[workspace]\nmembers = ["crates/foo"]\n');
    fs.writeFileSync(path.join(dir, 'Cargo.lock'), fooLock('1.0.0'));

    const config = getDefaultConfig();
    config.cargo.enabled = true;
    const ctx = createContext({
      cwd: dir,
      config,
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
        dryRun: true,
        updates: [{ packageName: 'foo', newVersion: '1.1.0', filePath: 'crates/foo/Cargo.toml' }],
        changelogs: [],
        tags: [],
      },
    });

    await runPrepareStage(ctx);

    expect(fs.readFileSync(path.join(dir, 'Cargo.lock'), 'utf-8')).toBe(fooLock('1.0.0'));
    expect(ctx.additionalFiles ?? []).not.toContain(path.join(dir, 'Cargo.lock'));
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

  it('should reject a copyFiles entry that escapes the repository root', async () => {
    const dir = createTmpDir();
    const pkgDir = path.join(dir, 'packages', 'foo');
    fs.mkdirSync(pkgDir, { recursive: true });
    fs.writeFileSync(path.join(pkgDir, 'package.json'), '{"name":"foo","version":"1.0.0"}');

    const config = getDefaultConfig();
    config.npm.enabled = true;
    config.npm.copyFiles = ['../../escape.txt'];

    const ctx = createContext({
      cwd: dir,
      config,
      input: {
        dryRun: false,
        updates: [{ packageName: 'foo', newVersion: '1.1.0', filePath: 'packages/foo/package.json' }],
        changelogs: [],
        tags: [],
      },
    });

    await expect(runPrepareStage(ctx)).rejects.toThrow(/outside the repository root/);
  });
});
