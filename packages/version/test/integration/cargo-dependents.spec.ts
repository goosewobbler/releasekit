/**
 * Runs the built CLI against a temp git repo of two crates, where `driver` depends on `bridge` by path.
 * Requires `pnpm build` in @releasekit/version first.
 */
import { execSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import * as TOML from 'smol-toml';
import { afterEach, describe, expect, it } from 'vitest';
import { executeCliCommand } from '../utils/cli.js';
import { createConventionalCommit, initGitRepo } from '../utils/git.js';
import { cleanupTempDir, symlinkNodeModules } from '../utils/tempFixture.js';

let tempDir: string;

const PATH_DEPENDENCY = '\n[dependencies]\nbridge = { path = "../bridge", version = "1.0.0" }\n';

function write(relativePath: string, content: string) {
  mkdirSync(dirname(join(tempDir, relativePath)), { recursive: true });
  writeFileSync(join(tempDir, relativePath), content);
}

function writeCrate(name: string, packageFields: string, extra = '') {
  write(`crates/${name}/Cargo.toml`, `[package]\nname = "${name}"\n${packageFields}${extra}`);
  write(`crates/${name}/src/lib.rs`, '');
}

interface RepoOptions {
  /** Appended to the root Cargo.toml, after `[workspace]`. */
  root?: string;
  /** `driver`'s `[package]` fields after its name. */
  driverPackage?: string;
  /** Appended to `driver`'s Cargo.toml. */
  driver?: string;
  config?: Record<string, unknown>;
  files?: Record<string, string>;
}

function createRepo({
  root = '',
  driverPackage = 'version = "1.0.0"\n',
  driver = PATH_DEPENDENCY,
  config = {},
  files = {},
}: RepoOptions = {}) {
  tempDir = mkdtempSync(join(tmpdir(), 'rk-cargo-dependents-'));
  write('package.json', JSON.stringify({ name: 'monorepo', version: '1.0.0', private: true }));
  write('Cargo.toml', `[workspace]\nmembers = ["crates/bridge", "crates/driver"]\n${root}`);
  writeCrate('bridge', 'version = "1.0.0"\n');
  writeCrate('driver', driverPackage, driver);
  for (const [file, content] of Object.entries(files)) {
    write(file, content);
  }
  write(
    'releasekit.config.json',
    JSON.stringify({
      version: {
        preset: 'conventionalcommits',
        sync: false,
        versionPrefix: 'v',
        packageSpecificTags: true,
        tagTemplate: '${packageName}@v${version}',
        ...config,
      },
    }),
  );
  symlinkNodeModules(tempDir);
  initGitRepo(tempDir);
  execSync('git tag bridge@v1.0.0 && git tag driver@v1.0.0', { cwd: tempDir });
}

function commitTo(crate: string, type: string, message: string, breaking = false) {
  write(`crates/${crate}/src/lib.rs`, `// ${message}\n`);
  createConventionalCommit(tempDir, type, message, crate, breaking, [`crates/${crate}`]);
}

function manifest(relativePath: string): Record<string, any> {
  return TOML.parse(readFileSync(join(tempDir, relativePath), 'utf-8'));
}

function driverManifest(): Record<string, any> {
  return manifest('crates/driver/Cargo.toml');
}

describe('internal Cargo dependents', () => {
  afterEach(() => {
    cleanupTempDir(tempDir);
  });

  it("should raise a dependent's requirement when the release breaks it, even if the dependent isn't releasing", () => {
    createRepo();
    commitTo('bridge', 'feat', 'replace the IPC API', true);

    const result = executeCliCommand('--json', tempDir, false);

    expect(result.status).toBe(0);
    expect(driverManifest().dependencies.bridge.version).toBe('2.0.0');
    expect(driverManifest().package.version).toBe('1.0.0');
  });

  it("should raise a releasing dependent's requirement to the release it's built with", () => {
    createRepo();
    commitTo('bridge', 'feat', 'add an IPC call');
    commitTo('driver', 'fix', 'use the new IPC call');

    const result = executeCliCommand('--json', tempDir, false);

    expect(result.status).toBe(0);
    expect(driverManifest().dependencies.bridge.version).toBe('1.1.0');
  });

  it.each([
    ['publish = false', 'version = "1.0.0"\npublish = false\n'],
    ['an inherited version', 'version.workspace = true\n'],
  ])('should raise a dependent with %s, which releases never discover', (_, driverPackage) => {
    createRepo({ root: '\n[workspace.package]\nversion = "1.0.0"\n', driverPackage });
    commitTo('bridge', 'feat', 'replace the IPC API', true);

    const result = executeCliCommand('--json', tempDir, false);

    expect(result.status).toBe(0);
    expect(driverManifest().dependencies.bridge.version).toBe('2.0.0');
  });

  it('should raise a dependent in group mode, which bumps each crate in place and ignores cargo.paths', () => {
    createRepo({
      config: {
        cargo: { paths: ['src-tauri'] },
        groups: { rust: { packages: ['bridge', 'driver'], sync: 'independent' } },
      },
    });
    commitTo('bridge', 'feat', 'replace the IPC API', true);

    const result = executeCliCommand('--json', tempDir, false);

    expect(result.status).toBe(0);
    expect(manifest('crates/bridge/Cargo.toml').package.version).toBe('2.0.0');
    expect(driverManifest().dependencies.bridge.version).toBe('2.0.0');
  });

  describe('with the requirement in [workspace.dependencies]', () => {
    const inherited = {
      root: '\n[workspace.dependencies]\nbridge = { path = "crates/bridge", version = "1.0.0" }\n',
      driver: '\n[dependencies]\nbridge.workspace = true\n',
    };

    it("should raise it when the release breaks an inheriting crate that isn't releasing", () => {
      createRepo(inherited);
      commitTo('bridge', 'feat', 'replace the IPC API', true);

      const result = executeCliCommand('--json', tempDir, false);

      expect(result.status).toBe(0);
      expect(manifest('Cargo.toml').workspace.dependencies.bridge.version).toBe('2.0.0');
      expect(driverManifest().dependencies.bridge).toEqual({ workspace: true });
    });

    it('should raise it to the release when an inheriting crate releases too', () => {
      createRepo(inherited);
      commitTo('bridge', 'feat', 'add an IPC call');
      commitTo('driver', 'fix', 'use the new IPC call');

      const result = executeCliCommand('--json', tempDir, false);

      expect(result.status).toBe(0);
      expect(manifest('Cargo.toml').workspace.dependencies.bridge.version).toBe('1.1.0');
    });
  });

  it("should skip a tracked Cargo.toml it can't parse and still raise the others", () => {
    createRepo({ files: { 'templates/app/Cargo.toml': '[package]\nname = {{project-name}}\n' } });
    commitTo('bridge', 'feat', 'replace the IPC API', true);

    const result = executeCliCommand('--json', tempDir, false);

    expect(result.status).toBe(0);
    expect(driverManifest().dependencies.bridge.version).toBe('2.0.0');
  });
});
