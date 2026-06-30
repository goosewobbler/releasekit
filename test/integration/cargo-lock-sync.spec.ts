/**
 * Integration test: Cargo.lock self-version sync (#496) against REAL cargo.
 *
 * Unit tests mock cargo, so they can't prove the load-bearing claim — that
 * `cargo update --workspace --offline` syncs a workspace member's self-version in the lock WITHOUT
 * re-resolving other members/dependencies. This runs real cargo on a real workspace to verify exactly
 * that. Skipped automatically where cargo isn't on PATH (CI installs a Rust toolchain for this job).
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

/** The version on a crate's `[[package]]` entry in a Cargo.lock. */
function lockVersion(lockContent: string, crate: string): string | undefined {
  const block = lockContent.split('[[package]]').find((b) => new RegExp(`^\\s*name = "${crate}"\\s*$`, 'm').test(b));
  return block?.match(/^\s*version = "([^"]+)"/m)?.[1];
}

describe.skipIf(!cargoAvailable())('syncCargoLockfile (real cargo)', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'rk-cargo-lock-int-'));
    // Two-member workspace: crate-a depends on crate-b by path. Bumping crate-a must move only its
    // own lock entry — crate-b and the a→b dependency edge stay put (no dependency re-resolution).
    writeFileSync(join(dir, 'Cargo.toml'), '[workspace]\nmembers = ["crate-a", "crate-b"]\nresolver = "2"\n');
    for (const [name, deps] of [
      ['crate-a', '\n[dependencies]\ncrate-b = { path = "../crate-b", version = "0.1.0" }\n'],
      ['crate-b', ''],
    ] as const) {
      const crateDir = join(dir, name);
      mkdirSync(join(crateDir, 'src'), { recursive: true });
      writeFileSync(join(crateDir, 'Cargo.toml'), `[package]\nname = "${name}"\nversion = "0.1.0"\nedition = "2021"\n${deps}`);
      writeFileSync(join(crateDir, 'src', 'lib.rs'), '// test crate\n');
    }
    // Generate a real, valid committed lock at the stale versions (offline — only path deps).
    execFileSync('cargo', ['generate-lockfile', '--offline'], { cwd: dir, stdio: 'ignore' });
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('should sync the bumped crate’s self-version in the workspace-root lock, leaving others untouched', () => {
    // Bump crate-a's manifest (what the version step does before calling the sync).
    writeFileSync(
      join(dir, 'crate-a', 'Cargo.toml'),
      '[package]\nname = "crate-a"\nversion = "0.2.0"\nedition = "2021"\n\n[dependencies]\ncrate-b = { path = "../crate-b", version = "0.1.0" }\n',
    );

    const lockPath = syncCargoLockfile(join(dir, 'crate-a', 'Cargo.toml'));

    expect(lockPath).toBe(join(dir, 'Cargo.lock'));
    const lock = readFileSync(join(dir, 'Cargo.lock'), 'utf-8');
    expect(lockVersion(lock, 'crate-a')).toBe('0.2.0'); // self-version synced
    expect(lockVersion(lock, 'crate-b')).toBe('0.1.0'); // other member untouched
    expect(lock).toContain('crate-b'); // a→b dependency edge preserved (no re-resolution)
  });

  it('should not create a lock when none is committed', () => {
    rmSync(join(dir, 'Cargo.lock'));
    const lockPath = syncCargoLockfile(join(dir, 'crate-a', 'Cargo.toml'));
    expect(lockPath).toBeUndefined();
    expect(() => readFileSync(join(dir, 'Cargo.lock'))).toThrow();
  });
});
