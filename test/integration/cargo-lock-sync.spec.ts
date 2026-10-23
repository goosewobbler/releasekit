/**
 * Cargo.lock sync checked against real cargo: after the built `releasekit version` runs without cargo,
 * cargo must accept every synced lock under `--locked` unchanged, and the edit must match
 * `cargo update --workspace` byte for byte. Skipped where cargo isn't installed.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const VERSION_CLI = fileURLToPath(new URL('../../packages/version/dist/cli.js', import.meta.url));

function cargoAvailable(): boolean {
  try {
    execFileSync('cargo', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function writeCrate(dir: string, name: string, version: string, extra = ''): void {
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(
    join(dir, 'Cargo.toml'),
    `[package]\nname = "${name}"\nversion = "${version}"\nedition = "2021"\n${extra}`,
  );
  writeFileSync(join(dir, 'src', 'lib.rs'), '// test crate\n');
}

function git(cwd: string, ...args: string[]): void {
  execFileSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.com', ...args], { cwd, stdio: 'ignore' });
}

/** Versions of the sourceless (path or workspace) `[[package]]` entries named `name` in a lock. */
function pathEntryVersions(lockContent: string, name: string): string[] {
  return lockContent
    .split('[[package]]')
    .filter((entry) => entry.includes(`name = "${name}"\n`) && !/^source = /m.test(entry))
    .map((entry) => /^version = "([^"]+)"/m.exec(entry)?.[1] ?? '');
}

function crateVersion(manifest: string): string {
  return /^version = "([^"]+)"/m.exec(readFileSync(manifest, 'utf-8'))?.[1] ?? '';
}

describe.skipIf(!cargoAvailable())('Cargo.lock sync (real cargo)', () => {
  let dir: string;
  let emptyCargoHome: string;
  let warmCargoHome: string;

  const cargo = (cwd: string, cargoHome: string, ...args: string[]): void => {
    execFileSync('cargo', args, { cwd, stdio: 'pipe', env: { ...process.env, CARGO_HOME: cargoHome } });
  };

  /** Commit the repo, tag every crate at its current version, then land a `feat:` change in `changedCrate`. */
  function commitWithChange(repo: string, crates: string[], changedCrate: string): void {
    // Workspace discovery starts from a root package.json, as in a JS monorepo that ships crates.
    writeFileSync(join(repo, 'package.json'), '{ "name": "rk-fixture", "private": true }\n');
    git(repo, 'init', '-q');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-qm', 'chore: init');
    for (const name of crates) {
      git(repo, 'tag', `${name}@v0.1.0`);
    }
    writeFileSync(join(changedCrate, 'src', 'lib.rs'), '// a new feature\n');
    git(repo, 'commit', '-qam', 'feat: add a feature');
  }

  /** Run `releasekit version` the way a fresh CI runner would: git on PATH, no cargo, an empty CARGO_HOME. */
  function releasekitVersion(repo: string, versionConfig: Record<string, unknown>): string {
    writeFileSync(
      join(repo, 'releasekit.config.json'),
      JSON.stringify({
        version: {
          preset: 'angular',
          sync: false,
          versionPrefix: 'v',
          tagTemplate: '${packageName}@v${version}',
          packageSpecificTags: true,
          ...versionConfig,
        },
      }),
    );
    const bin = join(dir, 'bin');
    if (!existsSync(bin)) {
      mkdirSync(bin);
      const gitDir = (process.env.PATH ?? '').split(delimiter).find((entry) => existsSync(join(entry, 'git')));
      symlinkSync(join(gitDir as string, 'git'), join(bin, 'git'));
    }
    const result = spawnSync(process.execPath, [VERSION_CLI], {
      cwd: repo,
      encoding: 'utf-8',
      env: { ...process.env, PATH: bin, CARGO_HOME: emptyCargoHome },
    });
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    return result.stdout;
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'rk-cargo-lock-int-'));
    emptyCargoHome = join(dir, 'empty-cargo-home');
    mkdirSync(emptyCargoHome);
    warmCargoHome = join(dir, 'warm-cargo-home');
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it.each([
    [
      'version.groups',
      { groups: { rust: { packages: ['rk-core', 'rk-cli'], sync: 'fixed' } } },
      'Using version-groups strategy',
    ],
    ['the per-package processor', {}, 'Using async versioning strategy'],
    ['updateCargoFiles', { sync: true }, 'Using sync versioning strategy'],
  ])(
    'should leave every lock that records a crate bumped through %s accepted by cargo --locked',
    (_path, config, strategyLog) => {
      // A Cargo workspace with its own lock, plus a fixture app (its own workspace and lock) that uses
      // the workspace's crates by path, as webdriverio/desktop-mobile's Tauri and Dioxus apps do.
      const repo = join(dir, 'repo');
      mkdirSync(join(repo, 'crates'), { recursive: true });
      writeFileSync(join(repo, 'crates', 'Cargo.toml'), '[workspace]\nmembers = ["core", "cli"]\nresolver = "2"\n');
      writeCrate(join(repo, 'crates', 'core'), 'rk-core', '0.1.0');
      writeCrate(join(repo, 'crates', 'cli'), 'rk-cli', '0.1.0', '\n[dependencies]\nrk-core = { path = "../core" }\n');
      writeCrate(
        join(repo, 'fixtures', 'app'),
        'fixture-app',
        '0.1.0',
        'publish = false\n\n[workspace]\n\n[dependencies]\nrk-cli = { path = "../../crates/cli" }\n',
      );
      const manifests = [join(repo, 'crates', 'Cargo.toml'), join(repo, 'fixtures', 'app', 'Cargo.toml')];
      for (const manifest of manifests) {
        cargo(repo, emptyCargoHome, 'generate-lockfile', '--offline', '--manifest-path', manifest);
      }
      commitWithChange(repo, ['rk-core', 'rk-cli'], join(repo, 'crates', 'core'));

      expect(releasekitVersion(repo, config)).toContain(strategyLog);

      const bumped = ['core', 'cli']
        .map((crate) => ({ name: `rk-${crate}`, version: crateVersion(join(repo, 'crates', crate, 'Cargo.toml')) }))
        .filter(({ version }) => version !== '0.1.0');
      expect(bumped.map(({ name }) => name)).toContain('rk-core');
      for (const manifest of manifests) {
        const lockPath = join(manifest, '..', 'Cargo.lock');
        const lock = readFileSync(lockPath, 'utf-8');
        for (const { name, version } of bumped) {
          expect(pathEntryVersions(lock, name), `${name} in ${lockPath}`).toEqual([version]);
        }
        cargo(
          repo,
          emptyCargoHome,
          'metadata',
          '--locked',
          '--offline',
          '--format-version',
          '1',
          '--manifest-path',
          manifest,
        );
        expect(readFileSync(lockPath, 'utf-8')).toBe(lock);
      }
    },
  );

  it('should leave a same-named crate’s lock alone when another Tauri app is bumped', () => {
    // Two Tauri apps whose src-tauri crates both have the `tauri init` name and version, `app` 0.1.0.
    const repo = join(dir, 'repo');
    const manifest = (app: string): string => join(repo, 'apps', app, 'src-tauri', 'Cargo.toml');
    const lockOf = (app: string): string => join(repo, 'apps', app, 'src-tauri', 'Cargo.lock');
    for (const app of ['one', 'two']) {
      writeCrate(join(repo, 'apps', app, 'src-tauri'), 'app', '0.1.0');
      writeFileSync(join(repo, 'apps', app, 'package.json'), `{ "name": "${app}", "version": "0.1.0" }\n`);
      cargo(repo, emptyCargoHome, 'generate-lockfile', '--offline', '--manifest-path', manifest(app));
    }
    writeFileSync(join(repo, 'pnpm-workspace.yaml'), 'packages:\n  - "apps/*"\n');
    commitWithChange(repo, ['one', 'two'], join(repo, 'apps', 'one', 'src-tauri'));
    const untouched = readFileSync(lockOf('two'), 'utf-8');

    releasekitVersion(repo, { cargo: { enabled: true, paths: ['src-tauri'] } });

    expect(crateVersion(manifest('one'))).toBe('0.2.0');
    expect(pathEntryVersions(readFileSync(lockOf('one'), 'utf-8'), 'app')).toEqual(['0.2.0']);
    expect(readFileSync(lockOf('two'), 'utf-8')).toBe(untouched);
    for (const app of ['one', 'two']) {
      const lock = readFileSync(lockOf(app), 'utf-8');
      cargo(
        repo,
        emptyCargoHome,
        'metadata',
        '--locked',
        '--offline',
        '--format-version',
        '1',
        '--manifest-path',
        manifest(app),
      );
      expect(readFileSync(lockOf(app), 'utf-8')).toBe(lock);
    }
  });

  it('should leave another workspace’s lock alone when it uses its own crate of the same name and version', () => {
    const repo = join(dir, 'repo');
    mkdirSync(join(repo, 'crates'), { recursive: true });
    writeFileSync(join(repo, 'crates', 'Cargo.toml'), '[workspace]\nmembers = ["utils"]\nresolver = "2"\n');
    writeCrate(join(repo, 'crates', 'utils'), 'utils', '0.1.0');
    writeCrate(
      join(repo, 'fixtures', 'app'),
      'fixture-app',
      '0.1.0',
      'publish = false\n\n[workspace]\n\n[dependencies]\nutils = { path = "utils" }\n',
    );
    writeCrate(join(repo, 'fixtures', 'app', 'utils'), 'utils', '0.1.0', 'publish = false\n');
    const manifests = [join(repo, 'crates', 'Cargo.toml'), join(repo, 'fixtures', 'app', 'Cargo.toml')];
    for (const manifest of manifests) {
      cargo(repo, emptyCargoHome, 'generate-lockfile', '--offline', '--manifest-path', manifest);
    }
    commitWithChange(repo, ['utils'], join(repo, 'crates', 'utils'));
    const fixtureLock = join(repo, 'fixtures', 'app', 'Cargo.lock');
    const untouched = readFileSync(fixtureLock, 'utf-8');

    releasekitVersion(repo, {});

    expect(crateVersion(join(repo, 'crates', 'utils', 'Cargo.toml'))).toBe('0.2.0');
    expect(pathEntryVersions(readFileSync(join(repo, 'crates', 'Cargo.lock'), 'utf-8'), 'utils')).toEqual(['0.2.0']);
    expect(readFileSync(fixtureLock, 'utf-8')).toBe(untouched);
    for (const manifest of manifests) {
      const lockPath = join(manifest, '..', 'Cargo.lock');
      const lock = readFileSync(lockPath, 'utf-8');
      cargo(
        repo,
        emptyCargoHome,
        'metadata',
        '--locked',
        '--offline',
        '--format-version',
        '1',
        '--manifest-path',
        manifest,
      );
      expect(readFileSync(lockPath, 'utf-8')).toBe(lock);
    }
  });

  it('should write the same lock cargo writes, also when the bump passes other versions of the crate', () => {
    // Git crates also named `crate-b` make cargo spell out versions in its references. Bumping 0.1.0 to
    // 0.2.0 passes 0.1.5 in entry order (semver) and 0.10.0 in reference order (string), so both re-sort.
    const gitDeps = ['0.0.9', '0.1.5', '0.10.0'].map((version) => {
      const gitCrate = join(dir, `git-crate-b-${version}`);
      writeCrate(gitCrate, 'crate-b', version);
      git(gitCrate, 'init', '-q');
      git(gitCrate, 'add', '-A');
      git(gitCrate, 'commit', '-qm', 'init');
      return `b-${version.replaceAll('.', '-')} = { package = "crate-b", git = "file://${gitCrate}" }\n`;
    });

    const ws = join(dir, 'ws');
    mkdirSync(ws);
    writeFileSync(join(ws, 'Cargo.toml'), '[workspace]\nmembers = ["crate-a", "crate-b"]\nresolver = "2"\n');
    writeCrate(
      join(ws, 'crate-a'),
      'crate-a',
      '0.1.0',
      `\n[dependencies]\ncrate-b = { path = "../crate-b" }\n${gitDeps.join('')}`,
    );
    writeCrate(join(ws, 'crate-b'), 'crate-b', '0.1.0');
    cargo(ws, warmCargoHome, 'generate-lockfile');
    commitWithChange(ws, ['crate-a', 'crate-b'], join(ws, 'crate-b'));
    const expected = join(dir, 'expected');
    cpSync(ws, expected, { recursive: true });

    releasekitVersion(ws, {});

    expect(crateVersion(join(ws, 'crate-b', 'Cargo.toml'))).toBe('0.2.0');
    // Give cargo the same manifest versions releasekit wrote (it may bump dependents too).
    for (const member of ['crate-a', 'crate-b']) {
      const manifest = join(expected, member, 'Cargo.toml');
      const version = crateVersion(join(ws, member, 'Cargo.toml'));
      writeFileSync(manifest, readFileSync(manifest, 'utf-8').replace('version = "0.1.0"', `version = "${version}"`));
    }
    cargo(expected, warmCargoHome, 'update', '--workspace', '--offline');
    expect(readFileSync(join(ws, 'Cargo.lock'), 'utf-8')).toBe(readFileSync(join(expected, 'Cargo.lock'), 'utf-8'));
  });
});
