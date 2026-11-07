import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { packageCommitScope } from '../../../src/utils/commitScope.js';

let root: string;

function writeCrate(dir: string, name: string) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'Cargo.toml'), `[package]\nname = "${name}"\nversion = "1.0.0"\n`);
}

describe('packageCommitScope', () => {
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'rk-commit-scope-'));
    mkdirSync(join(root, 'packages', 'app'), { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("should scope to the package's own directory", () => {
    const pkgDir = join(root, 'packages', 'app');

    expect(packageCommitScope(pkgDir, {}, { repoRoot: root })).toEqual([pkgDir]);
  });

  it('should include crates the package versions through cargo.paths', () => {
    const pkgDir = join(root, 'packages', 'app');
    writeCrate(join(root, 'crates', 'app'), 'app');

    const scope = packageCommitScope(pkgDir, { cargo: { paths: ['../../crates/app'] } }, { repoRoot: root });

    expect(scope).toEqual([pkgDir, join(root, 'crates', 'app')]);
  });

  it('should keep a crate it versions that discovery also found as a package', () => {
    const pkgDir = join(root, 'packages', 'app');
    const crateDir = join(pkgDir, 'src-tauri');
    writeCrate(crateDir, 'app');

    const scope = packageCommitScope(
      pkgDir,
      { cargo: { paths: ['src-tauri'] } },
      { repoRoot: root, workspaceDirs: [pkgDir, crateDir] },
    );

    expect(scope).toEqual([pkgDir, crateDir]);
  });

  it('should leave out cargo.paths when ignorePaths is set', () => {
    const pkgDir = join(root, 'packages', 'app');
    writeCrate(join(root, 'crates', 'app'), 'app');

    const scope = packageCommitScope(
      pkgDir,
      { cargo: { paths: ['../../crates/app'] } },
      { repoRoot: root, ignorePaths: true },
    );

    expect(scope).toEqual([pkgDir]);
  });

  it('should exclude packages nested inside it', () => {
    const workspaceDirs = [root, join(root, 'packages', 'app'), join(root, 'packages', 'app', 'plugin')];

    expect(packageCommitScope(root, {}, { repoRoot: root, workspaceDirs })).toEqual([
      root,
      `:(exclude)${join(root, 'packages', 'app')}`,
      `:(exclude)${join(root, 'packages', 'app', 'plugin')}`,
    ]);
    expect(packageCommitScope(join(root, 'packages', 'app'), {}, { repoRoot: root, workspaceDirs })).toEqual([
      join(root, 'packages', 'app'),
      `:(exclude)${join(root, 'packages', 'app', 'plugin')}`,
    ]);
  });
});
