/**
 * Runs the built CLI against temp git repos with no package.json, configured with the Rust and Dart quickstarts.
 * Requires `pnpm build` in @releasekit/version first.
 */
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { executeCliCommand, runVersionJson } from '../utils/cli.js';
import { createConventionalCommit, initGitRepo } from '../utils/git.js';
import { cleanupTempDir } from '../utils/tempFixture.js';

let tempDir: string;

function write(relativePath: string, content: string) {
  mkdirSync(dirname(join(tempDir, relativePath)), { recursive: true });
  writeFileSync(join(tempDir, relativePath), content);
}

function quickstartConfig(doc: string, heading: string): string {
  const markdown = readFileSync(resolve(__dirname, '../../../../docs', doc), 'utf-8');
  const section = markdown.slice(markdown.indexOf(`## ${heading}`));
  const block = /```json\n([\s\S]*?)```/.exec(section);
  if (!block) {
    throw new Error(`No JSON block under "${heading}" in ${doc}`);
  }
  return block[1];
}

function relativeFiles(files: string[] = []) {
  const root = realpathSync(tempDir);
  return files.map((file) => relative(root, resolve(root, file)));
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'rk-native-only-'));
});

afterEach(() => {
  cleanupTempDir(tempDir);
});

describe('Rust-only repo', () => {
  beforeEach(() => {
    write('releasekit.config.json', quickstartConfig('rust.md', 'Quickstart — Rust-only repo'));
  });

  it('should version every crate of a Cargo workspace', () => {
    write('Cargo.toml', '[workspace]\nmembers = ["crates/*"]\nresolver = "2"\n');
    write('crates/core/Cargo.toml', '[package]\nname = "rk-core"\nversion = "0.1.0"\nedition = "2021"\n');
    write('crates/cli/Cargo.toml', '[package]\nname = "rk-cli"\nversion = "0.1.0"\nedition = "2021"\n');
    initGitRepo(tempDir);
    createConventionalCommit(tempDir, 'feat', 'add feature');

    const output = runVersionJson(tempDir);

    expect(output.updates.map((u) => [u.packageName, u.newVersion, relativeFiles(u.files)])).toEqual([
      ['rk-cli', '0.2.0', ['crates/cli/Cargo.toml']],
      ['rk-core', '0.2.0', ['crates/core/Cargo.toml']],
    ]);
    expect(output.tags).toEqual(['v0.2.0']);
  });

  it('should version a single crate at the root', () => {
    write('Cargo.toml', '[package]\nname = "solo"\nversion = "1.0.0"\nedition = "2021"\n');
    initGitRepo(tempDir);
    createConventionalCommit(tempDir, 'fix', 'fix bug');

    const output = runVersionJson(tempDir);

    expect(output.updates.map((u) => [u.packageName, u.newVersion, relativeFiles(u.files)])).toEqual([
      ['solo', '1.0.1', ['Cargo.toml']],
    ]);
    expect(output.tags).toEqual(['v1.0.1']);
  });

  it('should fail naming a releasing crate that inherits its version from the workspace', () => {
    write('Cargo.toml', '[workspace]\nmembers = ["crates/*"]\n\n[workspace.package]\nversion = "0.3.0"\n');
    write('crates/literal/Cargo.toml', '[package]\nname = "literal"\nversion = "0.1.0"\n');
    write('crates/inheriting/Cargo.toml', '[package]\nname = "inheriting"\nversion.workspace = true\n');
    write('crates/internal/Cargo.toml', '[package]\nname = "internal"\nversion.workspace = true\npublish = false\n');
    initGitRepo(tempDir);
    createConventionalCommit(tempDir, 'feat', 'add feature');

    const result = executeCliCommand('--json', tempDir);

    expect(result.status).toBe(2);
    expect(JSON.parse(result.stdout).errors).toEqual([
      expect.objectContaining({
        code: 'CARGO_INHERITED_VERSION',
        message: "Workspace-inherited crate versions aren't supported yet: inheriting (crates/inheriting/Cargo.toml)",
      }),
    ]);
  });
});

describe('Dart-only repo', () => {
  it('should version a single Dart package at the root', () => {
    write('releasekit.config.json', quickstartConfig('dart.md', 'Quickstart — Dart-only repo'));
    write('pubspec.yaml', 'name: solo_dart\nversion: 1.2.0\nenvironment:\n  sdk: ^3.0.0\n');
    write('lib/solo_dart.dart', '// solo\n');
    initGitRepo(tempDir);
    createConventionalCommit(tempDir, 'feat', 'add feature');

    const output = runVersionJson(tempDir);

    expect(output.updates.map((u) => [u.packageName, u.newVersion, relativeFiles(u.files)])).toEqual([
      ['solo_dart', '1.3.0', ['pubspec.yaml']],
    ]);
    expect(output.tags).toEqual(['v1.3.0']);
  });
});
