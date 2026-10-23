import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { findCargoLockfile, planCargoLockUpdates, setCargoLockVersion } from '../../src/cargo.js';

describe('findCargoLockfile', () => {
  const tmpDirs: string[] = [];

  function tmp(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rk-cargo-lock-'));
    tmpDirs.push(dir);
    return fs.realpathSync(dir);
  }

  afterEach(() => {
    for (const dir of tmpDirs) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    tmpDirs.length = 0;
  });

  it('should return the lock in the start dir when present', () => {
    const dir = tmp();
    const lock = path.join(dir, 'Cargo.lock');
    fs.writeFileSync(lock, '');
    expect(findCargoLockfile(dir)).toBe(lock);
  });

  it('should walk up to the workspace root’s lock for a member', () => {
    const root = tmp();
    fs.writeFileSync(path.join(root, 'Cargo.toml'), '[workspace]\nmembers = ["crates/*"]\n');
    const lock = path.join(root, 'Cargo.lock');
    fs.writeFileSync(lock, '');
    const member = path.join(root, 'crates', 'foo');
    fs.mkdirSync(member, { recursive: true });
    expect(findCargoLockfile(member)).toBe(lock);
  });

  it('should ignore a lock in an ancestor directory that is not a workspace root', () => {
    const root = tmp();
    fs.writeFileSync(path.join(root, 'Cargo.toml'), '[package]\nname = "outer"\nversion = "1.0.0"\n');
    fs.writeFileSync(path.join(root, 'Cargo.lock'), '');
    const crate = path.join(root, 'crates', 'foo');
    fs.mkdirSync(crate, { recursive: true });
    expect(findCargoLockfile(crate)).toBeUndefined();
    fs.writeFileSync(path.join(crate, 'Cargo.lock'), '');
    expect(findCargoLockfile(crate)).toBe(path.join(crate, 'Cargo.lock'));
  });

  it('should follow a member’s package.workspace pointer to a root outside its directory', () => {
    const root = tmp();
    const workspace = path.join(root, 'workspace');
    const member = path.join(root, 'member');
    fs.mkdirSync(workspace);
    fs.mkdirSync(member);
    fs.writeFileSync(path.join(workspace, 'Cargo.toml'), '[workspace]\nmembers = ["../member"]\n');
    fs.writeFileSync(path.join(workspace, 'Cargo.lock'), '');
    fs.writeFileSync(
      path.join(member, 'Cargo.toml'),
      '[package]\nname = "member"\nversion = "0.1.0"\nworkspace = "../workspace"\n',
    );

    expect(findCargoLockfile(member)).toBe(path.join(workspace, 'Cargo.lock'));
  });

  it.each([
    ['an ancestor workspace excludes it', '[workspace]\nmembers = ["crates/*"]\nexclude = ["apps/x"]\n', 'own'],
    ['an ancestor workspace excludes a directory above it', '[workspace]\nexclude = ["./apps/"]\n', 'own'],
    ['a literal member entry overrides an exclude', '[workspace]\nmembers = ["apps/x"]\nexclude = ["apps"]\n', 'root'],
    ['an exclude is a glob, which cargo doesn’t expand', '[workspace]\nexclude = ["apps/*"]\n', 'root'],
    ['an exclude only shares a prefix with its directory name', '[workspace]\nexclude = ["app"]\n', 'root'],
  ])('should follow cargo’s workspace-root rule when %s', (_label, rootManifest, expected) => {
    const root = tmp();
    fs.writeFileSync(path.join(root, 'Cargo.toml'), rootManifest);
    fs.writeFileSync(path.join(root, 'Cargo.lock'), '');
    const crate = path.join(root, 'apps', 'x');
    fs.mkdirSync(crate, { recursive: true });
    fs.writeFileSync(path.join(crate, 'Cargo.toml'), '[package]\nname = "x"\nversion = "0.1.0"\n');
    fs.writeFileSync(path.join(crate, 'Cargo.lock'), '');

    expect(findCargoLockfile(crate)).toBe(path.join(expected === 'own' ? crate : root, 'Cargo.lock'));
  });

  it('should skip a workspace that excludes the crate for an outer one that has it as a member', () => {
    const root = tmp();
    fs.writeFileSync(path.join(root, 'Cargo.toml'), '[workspace]\nmembers = ["inner/app"]\n');
    fs.writeFileSync(path.join(root, 'Cargo.lock'), '');
    fs.mkdirSync(path.join(root, 'inner', 'app'), { recursive: true });
    fs.writeFileSync(path.join(root, 'inner', 'Cargo.toml'), '[workspace]\nexclude = ["app"]\n');
    fs.writeFileSync(path.join(root, 'inner', 'Cargo.lock'), '');

    expect(findCargoLockfile(path.join(root, 'inner', 'app'))).toBe(path.join(root, 'Cargo.lock'));
  });

  it('should treat a crate whose manifest declares a workspace as its own root', () => {
    const root = tmp();
    fs.writeFileSync(path.join(root, 'Cargo.toml'), '[workspace]\nmembers = ["crates/*"]\n');
    fs.writeFileSync(path.join(root, 'Cargo.lock'), '');
    const app = path.join(root, 'fixtures', 'app');
    fs.mkdirSync(app, { recursive: true });
    fs.writeFileSync(path.join(app, 'Cargo.toml'), '[package]\nname = "app"\nversion = "0.1.0"\n\n[workspace]\n');
    fs.writeFileSync(path.join(app, 'Cargo.lock'), '');

    expect(findCargoLockfile(app)).toBe(path.join(app, 'Cargo.lock'));
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
    // Cargo ignores a stray lock in a member dir.
    fs.writeFileSync(path.join(member, 'Cargo.lock'), '');
    expect(findCargoLockfile(member)).toBe(rootLock);
  });

  it('should return undefined when the workspace root has no committed lock', () => {
    const root = tmp();
    fs.writeFileSync(path.join(root, 'Cargo.toml'), '[workspace]\nmembers = ["crates/foo"]\n');
    const member = path.join(root, 'crates', 'foo');
    fs.mkdirSync(member, { recursive: true });
    fs.writeFileSync(path.join(member, 'Cargo.toml'), '[package]\nname = "foo"\nversion = "1.0.0"\n');
    // A stray member lock must not be used as a fallback.
    fs.writeFileSync(path.join(member, 'Cargo.lock'), '');
    expect(findCargoLockfile(member)).toBeUndefined();
  });
});

const REGISTRY = 'registry+https://github.com/rust-lang/crates.io-index';
const GIT = 'git+https://github.com/example/dupe#9a1327a6d3f8bc80a0f02fe01325c7828d587668';

const lock = (...lines: string[]): string => `${lines.join('\n')}\n`;

describe('setCargoLockVersion', () => {
  it.each([3, 4])('should bump only the crate’s own entry in a v%i lock', (format) => {
    const before = lock(
      '# This file is automatically @generated by Cargo.',
      '# It is not intended for manual editing.',
      `version = ${format}`,
      '',
      '[[package]]',
      'name = "app"',
      'version = "0.1.0"',
      'dependencies = [',
      ' "core",',
      ']',
      '',
      '[[package]]',
      'name = "core"',
      'version = "1.4.0"',
    );

    expect(setCargoLockVersion(before, 'core', '1.5.0')).toBe(before.replace('version = "1.4.0"', 'version = "1.5.0"'));
  });

  it('should rewrite versioned references when the lock holds two versions of the name', () => {
    // Byte-for-byte what `cargo update --workspace` writes after bumping the path crate `dupe`.
    const before = lock(
      'version = 4',
      '',
      '[[package]]',
      'name = "app"',
      'version = "0.1.0"',
      'dependencies = [',
      ' "dupe 0.9.0",',
      ' "dupe 1.0.0",',
      ']',
      '',
      '[[package]]',
      'name = "dupe"',
      'version = "0.9.0"',
      `source = "${GIT}"`,
      '',
      '[[package]]',
      'name = "dupe"',
      'version = "1.0.0"',
    );
    const after = lock(
      'version = 4',
      '',
      '[[package]]',
      'name = "app"',
      'version = "0.1.0"',
      'dependencies = [',
      ' "dupe 0.9.0",',
      ' "dupe 1.1.0",',
      ']',
      '',
      '[[package]]',
      'name = "dupe"',
      'version = "0.9.0"',
      `source = "${GIT}"`,
      '',
      '[[package]]',
      'name = "dupe"',
      'version = "1.1.0"',
    );

    expect(setCargoLockVersion(before, 'dupe', '1.1.0')).toBe(after);
  });

  it('should keep cargo’s order when the new version passes same-named entries from other sources', () => {
    // Byte-for-byte what `cargo update --workspace` writes after bumping `dupe` from 1.0.0 to 3.0.0.
    const source = (repo: string) =>
      `source = "git+https://example.com/${repo}#9a1327a6d3f8bc80a0f02fe01325c7828d587668"`;
    const entry = (version: string, ...rest: string[]) => [
      '',
      '[[package]]',
      'name = "dupe"',
      `version = "${version}"`,
      ...rest,
    ];
    const app = (...references: string[]) => [
      '[[package]]',
      'name = "app"',
      'version = "0.1.0"',
      'dependencies = [',
      ...references.map((reference) => ` "dupe ${reference}",`),
      ']',
    ];
    const before = lock(
      'version = 4',
      '',
      ...app('1.0.0', '1.0.0-beta.1', '10.0.0', '2.0.0'),
      ...entry('1.0.0-beta.1', source('pre')),
      ...entry('1.0.0'),
      ...entry('2.0.0', source('two')),
      ...entry('10.0.0', source('ten')),
    );
    const after = lock(
      'version = 4',
      '',
      ...app('1.0.0-beta.1', '10.0.0', '2.0.0', '3.0.0'),
      ...entry('1.0.0-beta.1', source('pre')),
      ...entry('2.0.0', source('two')),
      ...entry('3.0.0'),
      ...entry('10.0.0', source('ten')),
    );

    expect(setCargoLockVersion(before, 'dupe', '3.0.0')).toBe(after);
  });

  it('should order pre-release identifiers numerically when the new version passes other entries', () => {
    // Byte-for-byte what `cargo update --workspace` writes after bumping `dupe` from 1.0.0-beta.2 to 1.0.0-beta.11.
    const entry = (version: string, ...rest: string[]) => [
      '',
      '[[package]]',
      'name = "dupe"',
      `version = "${version}"`,
      ...rest,
    ];
    const app = (...versions: string[]) => [
      '[[package]]',
      'name = "app"',
      'version = "0.1.0"',
      'dependencies = [',
      ...versions.map((version) => ` "dupe 1.0.0-beta.${version}",`),
      ']',
    ];
    const before = lock(
      'version = 4',
      '',
      ...app('10', '2', '9'),
      ...entry('1.0.0-beta.2'),
      ...entry('1.0.0-beta.9', `source = "${GIT}"`),
      ...entry('1.0.0-beta.10', `source = "${GIT}"`),
    );
    const after = lock(
      'version = 4',
      '',
      ...app('10', '11', '9'),
      ...entry('1.0.0-beta.9', `source = "${GIT}"`),
      ...entry('1.0.0-beta.10', `source = "${GIT}"`),
      ...entry('1.0.0-beta.11'),
    );

    expect(setCargoLockVersion(before, 'dupe', '1.0.0-beta.11')).toBe(after);
  });

  it('should rewrite path references in a v1 lock without touching registry references or checksums', () => {
    // v1 locks always spell out the version, and add the source for registry packages.
    const before = lock(
      '[[package]]',
      'name = "app"',
      'version = "0.1.0"',
      'dependencies = [',
      ' "core 1.4.0",',
      ` "serde 1.0.200 (${REGISTRY})",`,
      ']',
      '',
      '[[package]]',
      'name = "core"',
      'version = "1.4.0"',
      '',
      '[[package]]',
      'name = "serde"',
      'version = "1.0.200"',
      `source = "${REGISTRY}"`,
      '',
      '[metadata]',
      `"checksum serde 1.0.200 (${REGISTRY})" = "ddc6f9cc94d67c0e21aaf7eda3a010fd3af78ebf6e096aa6e2e13c79749cce4f"`,
    );

    expect(setCargoLockVersion(before, 'core', '2.0.0')).toBe(
      before.replace('"core 1.4.0"', '"core 2.0.0"').replace('version = "1.4.0"', 'version = "2.0.0"'),
    );
  });

  it('should return undefined when the crate is only in the lock as a registry package', () => {
    const before = lock(
      'version = 3',
      '',
      '[[package]]',
      'name = "serde"',
      'version = "1.0.200"',
      `source = "${REGISTRY}"`,
    );

    expect(setCargoLockVersion(before, 'serde', '1.0.201')).toBeUndefined();
  });

  it('should return the content unchanged when the entry is already at the version', () => {
    const before = lock('version = 3', '', '[[package]]', 'name = "core"', 'version = "1.5.0"');

    expect(setCargoLockVersion(before, 'core', '1.5.0')).toBe(before);
  });

  it('should keep CRLF line endings', () => {
    const before = 'version = 3\r\n\r\n[[package]]\r\nname = "core"\r\nversion = "1.4.0"\r\n';

    expect(setCargoLockVersion(before, 'core', '1.5.0')).toBe(before.replace('1.4.0', '1.5.0'));
  });

  it.each([
    ['the new version', '2.0.0'],
    ['the old version', '1.4.0'],
  ])('should throw when another source holds the name at %s', (_label, otherVersion) => {
    const before = lock(
      'version = 4',
      '',
      '[[package]]',
      'name = "core"',
      'version = "1.4.0"',
      '',
      '[[package]]',
      'name = "core"',
      `version = "${otherVersion}"`,
      `source = "${REGISTRY}"`,
    );

    expect(() => setCargoLockVersion(before, 'core', '2.0.0')).toThrow(/from another source/);
  });

  it('should throw when the lock has several path entries of the name', () => {
    const before = lock(
      'version = 4',
      '',
      '[[package]]',
      'name = "core"',
      'version = "1.4.0"',
      '',
      '[[package]]',
      'name = "core"',
      'version = "3.0.0"',
    );

    expect(() => setCargoLockVersion(before, 'core', '2.0.0')).toThrow('it has 2 path entries named core');
  });

  it('should throw on a lock format newer than v4', () => {
    const before = lock('version = 5', '', '[[package]]', 'name = "core"', 'version = "1.4.0"');

    expect(() => setCargoLockVersion(before, 'core', '1.5.0')).toThrow(
      'its format (version = 5) is newer than releasekit can edit',
    );
  });
});

describe('planCargoLockUpdates', () => {
  const tmpDirs: string[] = [];

  function fakeGit(tracked: string[], ignored: string[] = []) {
    return {
      isRepository: vi.fn(async () => true),
      lsFiles: vi.fn(async () => tracked),
      isIgnored: vi.fn(async (file: string) => ignored.includes(file)),
    };
  }

  function write(file: string, content: string): string {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
    return file;
  }

  const lockWithDependency = (root: string, dependency: string, version: string): string =>
    lock(
      'version = 4',
      '',
      '[[package]]',
      `name = "${dependency}"`,
      `version = "${version}"`,
      '',
      '[[package]]',
      `name = "${root}"`,
      'version = "0.1.0"',
      'dependencies = [',
      ` "${dependency}",`,
      ']',
    );

  /** A workspace whose root lock lists `core`, plus a separate app whose own lock uses `core` by path. */
  function repoWithLocks(): { root: string; manifest: string; ownLock: string; appLock: string } {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rk-cargo-lock-plan-')));
    tmpDirs.push(root);
    write(path.join(root, 'Cargo.toml'), '[workspace]\nmembers = ["crates/*"]\n');
    const manifest = write(
      path.join(root, 'crates', 'core', 'Cargo.toml'),
      '[package]\nname = "core"\nversion = "1.5.0"\n',
    );
    const ownLock = write(
      path.join(root, 'Cargo.lock'),
      lock('version = 4', '', '[[package]]', 'name = "core"', 'version = "1.4.0"'),
    );
    const appManifest = write(
      path.join(root, 'app', 'Cargo.toml'),
      '[package]\nname = "app"\nversion = "0.1.0"\n\n[workspace]\n\n[dependencies]\ncore = { path = "../crates/core" }\n',
    );
    return {
      root,
      manifest,
      ownLock,
      appManifest,
      appLock: write(path.join(root, 'app', 'Cargo.lock'), lockWithDependency('app', 'core', '1.4.0')),
    };
  }

  afterEach(() => {
    for (const dir of tmpDirs) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    tmpDirs.length = 0;
  });

  it('should plan the crate’s own lock and every tracked lock that uses it, writing nothing', async () => {
    const { root, manifest, ownLock, appLock } = repoWithLocks();
    write(path.join(root, 'other', 'Cargo.lock'), lockWithDependency('other', 'serde', '1.0.0'));
    const git = fakeGit(['../../app/Cargo.lock', '../../app/Cargo.toml', '../../other/Cargo.lock']);
    const bump = { cargoTomlPath: manifest, name: 'core', version: '1.5.0' };

    const updates = await planCargoLockUpdates(git, path.dirname(manifest), [bump]);

    expect(updates).toEqual([
      { lockPath: appLock, content: fs.readFileSync(appLock, 'utf8').replace('1.4.0', '1.5.0'), changed: true },
      { lockPath: ownLock, content: fs.readFileSync(ownLock, 'utf8').replace('1.4.0', '1.5.0'), changed: true },
    ]);
    expect(git.lsFiles).toHaveBeenCalledWith({
      paths: [':(top,glob)**/Cargo.lock', ':(top,glob)**/Cargo.toml'],
      cwd: path.dirname(manifest),
    });
    expect(fs.readFileSync(ownLock, 'utf8')).toContain('version = "1.4.0"');
  });

  it('should plan only the crate’s own lock outside a git repository', async () => {
    const { manifest, ownLock } = repoWithLocks();
    const git = { ...fakeGit([]), isRepository: vi.fn(async () => false) };

    const updates = await planCargoLockUpdates(git, path.dirname(manifest), [
      { cargoTomlPath: manifest, name: 'core', version: '1.5.0' },
    ]);

    expect(updates.map((update) => update.lockPath)).toEqual([ownLock]);
    expect(git.lsFiles).not.toHaveBeenCalled();
  });

  it('should not plan an own lock git ignores', async () => {
    const { root, manifest, ownLock } = repoWithLocks();

    const updates = await planCargoLockUpdates(fakeGit([], [ownLock]), root, [
      { cargoTomlPath: manifest, name: 'core', version: '1.5.0' },
    ]);

    expect(updates).toEqual([]);
  });

  it('should apply every bump a shared lock lists in one update', async () => {
    const { root, manifest, appManifest, appLock } = repoWithLocks();

    const updates = await planCargoLockUpdates(fakeGit([appLock, appManifest]), root, [
      { cargoTomlPath: appManifest, name: 'app', version: '0.2.0' },
      { cargoTomlPath: manifest, name: 'core', version: '1.5.0' },
    ]);

    expect(updates.find((update) => update.lockPath === appLock)?.content).toBe(
      fs.readFileSync(appLock, 'utf8').replace('"0.1.0"', '"0.2.0"').replace('"1.4.0"', '"1.5.0"'),
    );
  });

  it('should report a lock already at the new version as unchanged, and skip a tracked lock missing from disk', async () => {
    const { root, manifest, ownLock } = repoWithLocks();
    fs.writeFileSync(ownLock, lock('version = 4', '', '[[package]]', 'name = "core"', 'version = "1.5.0"'));

    const updates = await planCargoLockUpdates(fakeGit([path.join(root, 'deleted', 'Cargo.lock')]), root, [
      { cargoTomlPath: manifest, name: 'core', version: '1.5.0' },
    ]);

    expect(updates).toEqual([{ lockPath: ownLock, content: fs.readFileSync(ownLock, 'utf8'), changed: false }]);
  });

  /** A `plugins` workspace whose `core` 1.0.0 is bumped, and an app workspace with a `core` 1.0.0 of its own. */
  function pluginsAndApp(appDependencies: string, apiDependencies: string) {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rk-cargo-lock-reach-')));
    tmpDirs.push(root);
    const crate = (dir: string, name: string, version: string, extra = ''): string =>
      write(path.join(root, dir, 'Cargo.toml'), `[package]\nname = "${name}"\nversion = "${version}"\n\n${extra}\n`);
    const manifests = [
      write(
        path.join(root, 'plugins', 'Cargo.toml'),
        '[workspace]\nmembers = ["api", "core"]\n\n[workspace.dependencies]\ncore = { path = "core" }\n',
      ),
      crate('plugins/core', 'core', '1.0.0'),
      crate('plugins/api', 'api', '0.1.0', apiDependencies),
      crate('app', 'app', '0.1.0', `[workspace]\n\n${appDependencies}`),
      crate('app/core', 'core', '1.0.0'),
    ];
    const pluginsLock = write(path.join(root, 'plugins', 'Cargo.lock'), lockWithDependency('api', 'core', '1.0.0'));
    const appLock = write(path.join(root, 'app', 'Cargo.lock'), lockWithDependency('app', 'core', '1.0.0'));
    return {
      root,
      pluginsLock,
      appLock,
      git: fakeGit([...manifests, pluginsLock, appLock]),
      bump: { cargoTomlPath: manifests[1], name: 'core', version: '1.1.0' },
    };
  }

  it.each([
    ['depends on the bumped crate by path', '[dependencies]\ncore = { path = "../plugins/core" }', ''],
    [
      'has it as a target-specific dev-dependency',
      `[target.'cfg(unix)'.dev-dependencies]\ncore = { path = "../plugins/core" }`,
      '',
    ],
    [
      'inherits it from its workspace',
      '[workspace.dependencies]\ncore = { path = "../plugins/core" }\n\n[dependencies]\ncore = { workspace = true }',
      '',
    ],
    [
      'depends on a crate that inherits it from another workspace',
      '[dependencies]\napi = { path = "../plugins/api" }',
      '[dependencies]\ncore = { workspace = true }',
    ],
  ])('should sync an app’s lock when the app %s', async (_label, appDependencies, apiDependencies) => {
    const { root, appLock, git, bump } = pluginsAndApp(appDependencies, apiDependencies);

    const updates = await planCargoLockUpdates(git, root, [bump]);

    expect(updates.find((update) => update.lockPath === appLock)).toEqual({
      lockPath: appLock,
      content: lockWithDependency('app', 'core', '1.1.0'),
      changed: true,
    });
  });

  it.each([
    ['depends on its own crate of the same name and version', '[dependencies]\ncore = { path = "core" }', ''],
    [
      'depends on a crate that has the bumped crate as a dev-dependency',
      '[dependencies]\ncore = { path = "core" }\napi = { path = "../plugins/api" }',
      '[dev-dependencies]\ncore = { path = "../core" }',
    ],
    ['patches it in', '[patch.crates-io]\ncore = { path = "../plugins/core" }', ''],
  ])('should leave an app’s lock alone when the app %s', async (_label, appDependencies, apiDependencies) => {
    const { root, pluginsLock, git, bump } = pluginsAndApp(appDependencies, apiDependencies);

    const updates = await planCargoLockUpdates(git, root, [bump]);

    expect(updates.map((update) => update.lockPath)).toEqual([pluginsLock]);
  });

  it('should name the lock when an edit cannot be made unambiguously', async () => {
    const { root, manifest, appManifest, appLock } = repoWithLocks();
    fs.appendFileSync(appLock, lock('', '[[package]]', 'name = "core"', 'version = "1.5.0"', `source = "${REGISTRY}"`));

    await expect(
      planCargoLockUpdates(fakeGit([appLock, appManifest]), root, [
        { cargoTomlPath: manifest, name: 'core', version: '1.5.0' },
      ]),
    ).rejects.toThrow(`can't set core to 1.5.0 in ${appLock}: it also has core 1.5.0 from another source`);
  });
});
