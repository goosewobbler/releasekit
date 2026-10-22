/**
 * Integration test: Cargo.lock self-version sync (#496, #650) checked against REAL cargo.
 *
 * The version step edits the lock text directly instead of running cargo, so the load-bearing claim is
 * that the edit is exactly the one cargo makes. This bumps a workspace member, syncs the lock with
 * releasekit, and compares it byte-for-byte with what `cargo update --workspace` writes for the same
 * bump. Skipped automatically where cargo isn't on PATH (CI installs a Rust toolchain for this job).
 */
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { syncCargoLockfile } from '@releasekit/version';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

function cargoAvailable(): boolean {
  try {
    execFileSync('cargo', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function writeCrate(dir: string, name: string, version: string, deps = ''): void {
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(
    join(dir, 'Cargo.toml'),
    `[package]\nname = "${name}"\nversion = "${version}"\nedition = "2021"\n${deps}`,
  );
  writeFileSync(join(dir, 'src', 'lib.rs'), '// test crate\n');
}

describe.skipIf(!cargoAvailable())('syncCargoLockfile (real cargo)', () => {
  let dir: string;
  let ws: string;

  // A private CARGO_HOME keeps the test hermetic: everything resolves from path and local git sources.
  const cargo = (cwd: string, ...args: string[]): void => {
    execFileSync('cargo', args, { cwd, stdio: 'pipe', env: { ...process.env, CARGO_HOME: join(dir, 'cargo-home') } });
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'rk-cargo-lock-int-'));

    // A git crate with the same name as a workspace member puts two versions of `crate-b` in the lock,
    // so cargo spells out versions in references to it ("crate-b 0.1.0") — the encoding a bump must edit.
    const gitCrate = join(dir, 'git-crate-b');
    writeCrate(gitCrate, 'crate-b', '0.0.9');
    const git = (...args: string[]) => execFileSync('git', args, { cwd: gitCrate, stdio: 'ignore' });
    git('init', '-q');
    git('add', '-A');
    git('-c', 'user.name=test', '-c', 'user.email=test@example.com', 'commit', '-qm', 'init');

    ws = join(dir, 'ws');
    mkdirSync(ws);
    writeFileSync(join(ws, 'Cargo.toml'), '[workspace]\nmembers = ["crate-a", "crate-b"]\nresolver = "2"\n');
    writeCrate(
      join(ws, 'crate-a'),
      'crate-a',
      '0.1.0',
      `\n[dependencies]\ncrate-b = { path = "../crate-b" }\nold-b = { package = "crate-b", git = "file://${gitCrate}" }\n`,
    );
    writeCrate(join(ws, 'crate-b'), 'crate-b', '0.1.0');
    cargo(ws, 'generate-lockfile');
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it.each(['crate-a', 'crate-b'])('should write the same lock cargo writes when %s is bumped', (crate) => {
    const expected = join(dir, 'expected');
    cpSync(ws, expected, { recursive: true });
    for (const root of [ws, expected]) {
      const manifest = join(root, crate, 'Cargo.toml');
      writeFileSync(manifest, readFileSync(manifest, 'utf-8').replace('version = "0.1.0"', 'version = "0.2.0"'));
    }
    cargo(expected, 'update', '--workspace', '--offline');

    const lockPath = syncCargoLockfile(join(ws, crate, 'Cargo.toml'));

    expect(lockPath).toBe(join(ws, 'Cargo.lock'));
    expect(readFileSync(lockPath as string, 'utf-8')).toBe(readFileSync(join(expected, 'Cargo.lock'), 'utf-8'));
  });

  it('should not create a lock when none is committed', () => {
    rmSync(join(ws, 'Cargo.lock'));
    const lockPath = syncCargoLockfile(join(ws, 'crate-a', 'Cargo.toml'));
    expect(lockPath).toBeUndefined();
    expect(() => readFileSync(join(ws, 'Cargo.lock'))).toThrow();
  });
});
