import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveCommitScope } from '../../../src/utils/commitScope.js';

let root: string;

function writeCrate(dir: string, name: string) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'Cargo.toml'), `[package]\nname = "${name}"\nversion = "1.0.0"\n`);
}

describe('resolveCommitScope', () => {
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'rk-commit-scope-'));
    mkdirSync(join(root, 'packages', 'app'), { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("should scope to the package's own directory", () => {
    const pkgDir = join(root, 'packages', 'app');

    expect(resolveCommitScope(pkgDir, {}, { repoRoot: root }).scope).toEqual([pkgDir]);
  });

  it('should include crates the package versions through cargo.paths', () => {
    const pkgDir = join(root, 'packages', 'app');
    writeCrate(join(root, 'crates', 'app'), 'app');

    const scope = resolveCommitScope(pkgDir, { cargo: { paths: ['../../crates/app'] } }, { repoRoot: root }).scope;

    expect(scope).toEqual([pkgDir, join(root, 'crates', 'app')]);
  });

  it('should keep a crate it versions that discovery also found as a package', () => {
    const pkgDir = join(root, 'packages', 'app');
    const crateDir = join(pkgDir, 'src-tauri');
    writeCrate(crateDir, 'app');

    const scope = resolveCommitScope(
      pkgDir,
      { cargo: { paths: ['src-tauri'] } },
      { repoRoot: root, releasableDirs: [pkgDir, crateDir] },
    ).scope;

    expect(scope).toEqual([pkgDir, crateDir]);
  });

  it('should leave out cargo.paths when ignorePaths is set', () => {
    const pkgDir = join(root, 'packages', 'app');
    writeCrate(join(root, 'crates', 'app'), 'app');

    const scope = resolveCommitScope(
      pkgDir,
      { cargo: { paths: ['../../crates/app'] } },
      { repoRoot: root, ignorePaths: true },
    ).scope;

    expect(scope).toEqual([pkgDir]);
  });

  it('should exclude nested packages from config.releasablePackageDirs by default', () => {
    const pkgDir = join(root, 'packages', 'app');
    const plugin = join(pkgDir, 'plugin');
    const config = { releasablePackageDirs: [pkgDir, plugin] };

    expect(resolveCommitScope(pkgDir, config, { repoRoot: root }).scope).toEqual([pkgDir, `:(exclude)${plugin}`]);
    expect(resolveCommitScope(pkgDir, config, { repoRoot: root, releasableDirs: [] }).scope).toEqual([pkgDir]);
  });

  it('should exclude packages nested inside it', () => {
    const releasableDirs = [root, join(root, 'packages', 'app'), join(root, 'packages', 'app', 'plugin')];

    expect(resolveCommitScope(root, {}, { repoRoot: root, releasableDirs }).scope).toEqual([
      root,
      `:(exclude)${join(root, 'packages', 'app')}`,
      `:(exclude)${join(root, 'packages', 'app', 'plugin')}`,
    ]);
    expect(resolveCommitScope(join(root, 'packages', 'app'), {}, { repoRoot: root, releasableDirs }).scope).toEqual([
      join(root, 'packages', 'app'),
      `:(exclude)${join(root, 'packages', 'app', 'plugin')}`,
    ]);
  });

  it('should keep the paths entries that resolve when another leaves the repository', () => {
    const pkgDir = join(root, 'packages', 'app');
    writeCrate(join(root, 'crates', 'app'), 'app');

    const { scope, pathsError } = resolveCommitScope(
      pkgDir,
      { cargo: { paths: ['../../crates/app', '../../..'] } },
      { repoRoot: root },
    );

    expect(scope).toEqual([pkgDir, join(root, 'crates', 'app')]);
    expect(pathsError?.message).toContain('outside the repository');
  });

  it('should return a malformed manifest as pathsError rather than throw', () => {
    const pkgDir = join(root, 'packages', 'app');
    writeFileSync(join(pkgDir, 'Cargo.toml'), '[package\n');

    const { scope, pathsError } = resolveCommitScope(pkgDir, {}, { repoRoot: root });

    expect(scope).toEqual([pkgDir]);
    expect(pathsError?.message).toContain('Cannot parse');
  });
});
