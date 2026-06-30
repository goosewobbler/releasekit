import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { findCargoLockfile } from '../../src/cargo.js';

describe('findCargoLockfile', () => {
  const tmpDirs: string[] = [];

  function tmp(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rk-cargo-lock-'));
    tmpDirs.push(dir);
    return fs.realpathSync(dir);
  }

  afterEach(() => {
    for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true });
    tmpDirs.length = 0;
  });

  it('should return the lock in the start dir when present', () => {
    const dir = tmp();
    const lock = path.join(dir, 'Cargo.lock');
    fs.writeFileSync(lock, '');
    expect(findCargoLockfile(dir)).toBe(lock);
  });

  it('should walk up to the nearest ancestor lock for a workspace member', () => {
    const root = tmp();
    const lock = path.join(root, 'Cargo.lock');
    fs.writeFileSync(lock, '');
    const member = path.join(root, 'crates', 'foo');
    fs.mkdirSync(member, { recursive: true });
    expect(findCargoLockfile(member)).toBe(lock);
  });

  it('should return the nearest lock when both a member and an ancestor have one', () => {
    const root = tmp();
    fs.writeFileSync(path.join(root, 'Cargo.lock'), '');
    const member = path.join(root, 'crates', 'foo');
    fs.mkdirSync(member, { recursive: true });
    const memberLock = path.join(member, 'Cargo.lock');
    fs.writeFileSync(memberLock, '');
    expect(findCargoLockfile(member)).toBe(memberLock);
  });

  it('should return undefined when no lock exists above the start dir', () => {
    const dir = tmp();
    const member = path.join(dir, 'crates', 'foo');
    fs.mkdirSync(member, { recursive: true });
    expect(findCargoLockfile(member)).toBeUndefined();
  });

  it('should target the workspace-root lock, not a member’s own stray lock', () => {
    const root = tmp();
    fs.writeFileSync(path.join(root, 'Cargo.toml'), '[workspace]\nmembers = ["crates/foo"]\n');
    const rootLock = path.join(root, 'Cargo.lock');
    fs.writeFileSync(rootLock, '');
    const member = path.join(root, 'crates', 'foo');
    fs.mkdirSync(member, { recursive: true });
    fs.writeFileSync(path.join(member, 'Cargo.toml'), '[package]\nname = "foo"\nversion = "1.0.0"\n');
    // A stray lock in the member dir is ignored by cargo — the workspace-root lock is the one that moves.
    fs.writeFileSync(path.join(member, 'Cargo.lock'), '');
    expect(findCargoLockfile(member)).toBe(rootLock);
  });

  it('should return undefined when the workspace root has no committed lock', () => {
    const root = tmp();
    fs.writeFileSync(path.join(root, 'Cargo.toml'), '[workspace]\nmembers = ["crates/foo"]\n');
    const member = path.join(root, 'crates', 'foo');
    fs.mkdirSync(member, { recursive: true });
    fs.writeFileSync(path.join(member, 'Cargo.toml'), '[package]\nname = "foo"\nversion = "1.0.0"\n');
    // No lock at the workspace root → nothing to sync (don't fall back to a stray member lock).
    fs.writeFileSync(path.join(member, 'Cargo.lock'), '');
    expect(findCargoLockfile(member)).toBeUndefined();
  });
});
