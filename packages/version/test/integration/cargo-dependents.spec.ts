/**
 * Runs the built CLI against a temp git repo of two crates, where `driver` depends on `bridge` by path.
 * Requires `pnpm build` in @releasekit/version first.
 */
import { execSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as TOML from 'smol-toml';
import { afterEach, describe, expect, it } from 'vitest';
import { executeCliCommand } from '../utils/cli.js';
import { createConventionalCommit, initGitRepo } from '../utils/git.js';
import { cleanupTempDir, symlinkNodeModules } from '../utils/tempFixture.js';

let tempDir: string;

function writeCrate(name: string, extra = '') {
  mkdirSync(join(tempDir, 'crates', name, 'src'), { recursive: true });
  writeFileSync(
    join(tempDir, 'crates', name, 'Cargo.toml'),
    `[package]\nname = "${name}"\nversion = "1.0.0"\n${extra}`,
  );
  writeFileSync(join(tempDir, 'crates', name, 'src', 'lib.rs'), '');
}

function createRepo() {
  tempDir = mkdtempSync(join(tmpdir(), 'rk-cargo-dependents-'));
  writeFileSync(join(tempDir, 'package.json'), JSON.stringify({ name: 'monorepo', version: '1.0.0', private: true }));
  writeFileSync(join(tempDir, 'Cargo.toml'), '[workspace]\nmembers = ["crates/bridge", "crates/driver"]\n');
  writeCrate('bridge');
  writeCrate('driver', '\n[dependencies]\nbridge = { path = "../bridge", version = "1.0.0" }\n');
  writeFileSync(
    join(tempDir, 'releasekit.config.json'),
    JSON.stringify({
      version: {
        preset: 'conventionalcommits',
        sync: false,
        versionPrefix: 'v',
        packageSpecificTags: true,
        tagTemplate: '${packageName}@v${version}',
      },
    }),
  );
  symlinkNodeModules(tempDir);
  initGitRepo(tempDir);
  execSync('git tag bridge@v1.0.0 && git tag driver@v1.0.0', { cwd: tempDir });
}

function commitTo(crate: string, type: string, message: string, breaking = false) {
  writeFileSync(join(tempDir, 'crates', crate, 'src', 'lib.rs'), `// ${message}\n`);
  createConventionalCommit(tempDir, type, message, crate, breaking, [`crates/${crate}`]);
}

function driverManifest(): { package: { version: string }; dependencies: { bridge: { version: string } } } {
  return TOML.parse(readFileSync(join(tempDir, 'crates/driver/Cargo.toml'), 'utf-8')) as never;
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
});
