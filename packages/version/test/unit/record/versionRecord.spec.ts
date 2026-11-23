import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { devNull, tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Package } from '@manypkg/get-packages';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VersionRecord } from '../../../src/record/recordFile.js';
import { readVersionRecord, recordRelease } from '../../../src/record/versionRecord.js';
import type { Config } from '../../../src/types.js';

describe('version record', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'rk-record-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  const file = () => join(root, 'releasekit.versions.json');
  const pkg = (name: string, dir: string) => ({ dir: join(root, dir), packageJson: { name } }) as unknown as Package;

  describe('readVersionRecord', () => {
    it('should keep fields it does not know', () => {
      writeFileSync(
        file(),
        JSON.stringify({ 'packages/a': { name: 'a', version: '1.0.0', at: 'sha', channel: 'next' } }),
      );

      expect(readVersionRecord(root)).toEqual({
        'packages/a': { name: 'a', version: '1.0.0', at: 'sha', channel: 'next' },
      });
    });

    it('should fail naming the malformed field', () => {
      writeFileSync(file(), JSON.stringify({ 'packages/a': { name: 'a', version: '1.0.0' } }));

      expect(() => readVersionRecord(root)).toThrow('releasekit.versions.json is malformed at "packages/a.at"');
    });
  });

  describe('recordRelease', () => {
    it.each([
      ['a stable previous release', { name: 'a', version: '1.0.0', at: 's' }, { version: '1.0.0', at: 's' }],
      [
        "a prerelease's last stable release",
        { name: 'a', version: '1.1.0-next.0', at: 'p', lastStable: { version: '1.0.0', at: 's' } },
        { version: '1.0.0', at: 's' },
      ],
    ])('should give a prerelease %s as its last stable release', (_case, previous, lastStable) => {
      expect(recordRelease(previous, 'a', '1.1.0-next.1', 'q')).toEqual({
        name: 'a',
        version: '1.1.0-next.1',
        at: 'q',
        lastStable,
      });
    });

    it('should drop the last stable release on a stable release', () => {
      const previous = { name: 'a', version: '1.1.0-next.1', at: 'q', lastStable: { version: '1.0.0', at: 's' } };

      expect(recordRelease(previous, 'a', '1.1.0', 'r')).toEqual({ name: 'a', version: '1.1.0', at: 'r' });
    });
  });

  describe('VersionRecord', () => {
    const packages = () => [pkg('a', 'packages/a'), pkg('b', 'packages/b')];

    it('should update an existing record, keeping entries a release leaves alone and skipping non-packages', () => {
      writeFileSync(file(), JSON.stringify({ 'packages/b': { name: 'b', version: '2.0.0', at: 'old' } }));
      const released = new Map([
        ['a', '1.1.0'],
        ['monorepo', '1.1.0'],
      ]);

      VersionRecord.open(root, 'head').saveReleases(released, packages(), false);

      expect(JSON.parse(readFileSync(file(), 'utf-8'))).toEqual({
        'packages/a': { name: 'a', version: '1.1.0', at: 'head' },
        'packages/b': { name: 'b', version: '2.0.0', at: 'old' },
      });
    });

    it("should create the file when it doesn't exist", () => {
      VersionRecord.open(root, 'head').saveReleases(new Map([['a', '1.1.0']]), packages(), false);

      expect(JSON.parse(readFileSync(file(), 'utf-8'))).toEqual({
        'packages/a': { name: 'a', version: '1.1.0', at: 'head' },
      });
    });

    it('should write nothing when nothing was released', () => {
      VersionRecord.open(root, 'head').saveReleases(new Map(), packages(), false);

      expect(existsSync(file())).toBe(false);
    });

    it("should remove an entry whose name another package's entry already holds, rather than move it", () => {
      writeFileSync(
        file(),
        JSON.stringify({
          'packages/old-a': { name: 'a', version: '1.0.0', at: 'old' },
          'packages/a': { name: 'a', version: '2.0.0', at: 'new' },
        }),
      );
      const record = VersionRecord.open(root, 'head');

      expect(record.reconcile(packages())).toEqual([]);
      record.saveReleases(new Map([['b', '1.0.0']]), packages(), false);
      expect(Object.keys(JSON.parse(readFileSync(file(), 'utf-8')))).toEqual(['packages/a', 'packages/b']);
    });
  });

  describe('current versions without an entry', () => {
    const manifests = (dir: string, files: Record<string, string>) => {
      mkdirSync(join(root, dir), { recursive: true });
      for (const [name, content] of Object.entries(files)) {
        writeFileSync(join(root, dir, name), content);
      }
      return pkg(dir, dir);
    };

    it("should start a package from its first enabled ecosystem's manifest", () => {
      const hybrid = manifests('hybrid', {
        'package.json': JSON.stringify({ name: 'hybrid', version: '1.0.0' }),
        'Cargo.toml': '[package]\nname = "hybrid"\nversion = "2.0.0"\n',
      });
      const config = { npm: { enabled: false } } as Config;

      expect(VersionRecord.open(root, 'head').current(hybrid, config)).toEqual({ version: '2.0.0', recorded: false });
    });

    it('should start a group with no entries from the highest of its manifest versions, else 0.1.0', () => {
      const a = manifests('a', { 'package.json': JSON.stringify({ name: 'a', version: '1.2.0' }) });
      const b = manifests('b', { 'package.json': JSON.stringify({ name: 'b', version: '1.10.0' }) });
      const unversioned = manifests('c', { 'package.json': JSON.stringify({ name: 'c' }) });
      const record = VersionRecord.open(root, 'head');

      expect(record.groupCurrent([a, b], {} as Config)).toEqual({ version: '1.10.0', recorded: false });
      expect(record.groupCurrent([unversioned], {} as Config)).toEqual({ version: '0.1.0', recorded: false });
    });
  });

  describe('git checks', () => {
    const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf-8' }).trim();

    beforeEach(() => {
      vi.stubEnv('GIT_CONFIG_GLOBAL', devNull);
      vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1');
      git('init', '-q', '-b', 'main');
      git('-c', 'user.email=t@example.com', '-c', 'user.name=T', 'commit', '-q', '--allow-empty', '-m', 'init');
    });

    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it("should fail when a prerelease's last stable commit isn't in the history of HEAD", async () => {
      const head = git('rev-parse', 'HEAD');
      const missing = '0'.repeat(40);
      writeFileSync(
        file(),
        JSON.stringify({
          'packages/a': { name: 'a', version: '1.1.0-next.0', at: head, lastStable: { version: '1.0.0', at: missing } },
        }),
      );

      await expect(VersionRecord.open(root, head).assertAncestors()).rejects.toThrow(`a (packages/a) at ${missing}`);
    });

    it("should count a sync release at the run's own commit as released once its shared tag is on the remote", async () => {
      const runCommit = git('rev-parse', 'HEAD');
      writeFileSync(file(), JSON.stringify({ 'packages/a': { name: 'a', version: '1.0.1', at: runCommit } }));
      git('add', '-A');
      git('-c', 'user.email=t@example.com', '-c', 'user.name=T', 'commit', '-q', '-m', 'chore: release v1.0.1');
      git('tag', 'v1.0.1');
      const remote = mkdtempSync(join(tmpdir(), 'rk-record-remote-'));
      try {
        git('init', '-q', '--bare', remote);
        git('push', '-q', '--tags', remote, 'HEAD:refs/heads/main');
        const config = { sync: true, versionPrefix: 'v', tagTemplate: '${prefix}${version}' } as Config;
        const record = VersionRecord.open(root, runCommit);

        await record.loadReleasedAfter({ commit: runCommit, remote, branch: 'main' }, config);

        expect(record.current(pkg('a', 'packages/a'), config).releasedAfterRun).toBe('1.0.1');
      } finally {
        rmSync(remote, { recursive: true, force: true });
      }
    });

    it("should fail the re-run guard when the remote branch can't be fetched", async () => {
      const head = git('rev-parse', 'HEAD');

      await expect(
        VersionRecord.open(root, head).loadReleasedAfter(
          { commit: head, remote: 'origin', branch: 'main' },
          {} as Config,
        ),
      ).rejects.toThrow("Can't fetch main to check what it has already released");
    });
  });
});
