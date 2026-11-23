import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { devNull, tmpdir } from 'node:os';
import { join } from 'node:path';
import { getPackagesSync } from '@manypkg/get-packages';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../../../src/config.js';
import { VersionRecord } from '../../../src/record/recordFile.js';
import { seedMissingEntries } from '../../../src/record/seed.js';
import type { VersionRecordEntries } from '../../../src/record/versionRecord.js';

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8' }).trim();
}

describe('seedMissingEntries', { timeout: 30_000 }, () => {
  let repo: string;
  let previousCwd: string;

  beforeEach(() => {
    vi.stubEnv('GIT_CONFIG_GLOBAL', devNull);
    vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1');
    repo = realpathSync(mkdtempSync(join(tmpdir(), 'rk-seed-')));
    previousCwd = process.cwd();
    process.chdir(repo);
  });

  afterEach(() => {
    process.chdir(previousCwd);
    vi.unstubAllEnvs();
    rmSync(repo, { recursive: true, force: true });
  });

  function setUpRepo(version: Record<string, unknown>, packages: Record<string, string>): void {
    writeFileSync(join(repo, 'package.json'), JSON.stringify({ name: 'monorepo', version: '0.0.0', private: true }));
    writeFileSync(join(repo, 'pnpm-workspace.yaml'), 'packages:\n  - "packages/*"\n');
    writeFileSync(join(repo, 'releasekit.config.json'), JSON.stringify({ version }));
    for (const [name, packageVersion] of Object.entries(packages)) {
      mkdirSync(join(repo, 'packages', name), { recursive: true });
      writeFileSync(join(repo, 'packages', name, 'package.json'), JSON.stringify({ name, version: packageVersion }));
    }
    git(repo, 'init', '-q', '-b', 'main');
    git(repo, 'config', 'user.email', 'test@example.com');
    git(repo, 'config', 'user.name', 'Test');
    commit('chore: init');
  }

  // Tags are ordered by creation date, which for a lightweight tag is its commit's, so each commit gets its own day.
  let day = 0;
  function commit(message: string): string {
    day += 1;
    const date = `2026-01-${String(day).padStart(2, '0')}T00:00:00Z`;
    git(repo, 'add', '-A');
    execFileSync('git', ['commit', '-q', '--allow-empty', '-m', message], {
      cwd: repo,
      env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
    });
    return git(repo, 'rev-parse', 'HEAD');
  }

  function seed(record: VersionRecordEntries = {}) {
    return seedMissingEntries(record, getPackagesSync(repo).packages, loadConfig({ cwd: repo }), repo);
  }

  it("should seed each package from its last tag, with a prerelease's last stable release", async () => {
    setUpRepo({ sync: false, packageSpecificTags: true }, { a: '1.1.0-next.0', b: '2.0.0', c: '0.1.0' });
    const stable = git(repo, 'rev-parse', 'HEAD');
    git(repo, 'tag', 'a@v1.0.0');
    git(repo, 'tag', 'b@v2.0.0');
    const prerelease = commit('chore: release a v1.1.0-next.0');
    git(repo, 'tag', 'a@v1.1.0-next.0');
    commit('feat: a later change');

    const { record, unseeded } = await seed();

    expect(record).toEqual({
      'packages/a': {
        name: 'a',
        version: '1.1.0-next.0',
        at: prerelease,
        lastStable: { version: '1.0.0', at: stable },
      },
      'packages/b': { name: 'b', version: '2.0.0', at: stable },
    });
    expect(unseeded).toEqual([{ name: 'c', reason: 'no release tag of its own is reachable from HEAD' }]);
  });

  it("should keep an existing record's entries, seed the missing ones and record a release in the same file", async () => {
    setUpRepo({ sync: false, packageSpecificTags: true }, { a: '1.0.0', b: '2.0.0', c: '3.0.0' });
    const at = git(repo, 'rev-parse', 'HEAD');
    for (const tag of ['a@v1.0.0', 'b@v2.0.0', 'c@v3.0.0']) {
      git(repo, 'tag', tag);
    }
    const existing = { 'packages/a': { name: 'a', version: '1.0.1', at: 'hand-edited' } };
    writeFileSync(join(repo, 'releasekit.versions.json'), JSON.stringify(existing));
    const { packages } = getPackagesSync(repo);

    const record = VersionRecord.open(repo, 'head');
    const { seeded } = await record.seed(packages, loadConfig({ cwd: repo }));
    record.saveReleases(new Map([['c', '3.1.0']]), packages, false);

    expect(seeded).toEqual(['b', 'c']);
    expect(JSON.parse(readFileSync(join(repo, 'releasekit.versions.json'), 'utf-8'))).toEqual({
      ...existing,
      'packages/b': { name: 'b', version: '2.0.0', at },
      'packages/c': { name: 'c', version: '3.1.0', at: 'head' },
    });
  });

  it("should seed a sync repo's entries with the shared version at its baseline tag", async () => {
    setUpRepo({ sync: true, baselineTagTemplate: 'release/${prefix}${version}' }, { a: '1.0.0', b: '1.0.0' });
    const at = git(repo, 'rev-parse', 'HEAD');
    git(repo, 'tag', 'release/v1.0.0');
    // The consumer tag, moved off the release commit by a downstream step.
    commit('chore: build');
    git(repo, 'tag', 'v1.0.0');

    const { record } = await seed();

    expect(record).toEqual({
      'packages/a': { name: 'a', version: '1.0.0', at },
      'packages/b': { name: 'b', version: '1.0.0', at },
    });
  });

  it("should seed a package without a tag of its own from the repo's tags", async () => {
    setUpRepo({ sync: false }, { a: '1.0.0' });
    const at = git(repo, 'rev-parse', 'HEAD');
    git(repo, 'tag', 'v1.0.0');

    const { record } = await seed();

    expect(record).toEqual({ 'packages/a': { name: 'a', version: '1.0.0', at } });
  });

  it('should seed the manifest version where mismatchStrategy prefer-package picks it', async () => {
    setUpRepo(
      { sync: false, packageSpecificTags: true, mismatchStrategy: 'prefer-package' },
      { a: '1.2.0', b: '1.0.0' },
    );
    const at = git(repo, 'rev-parse', 'HEAD');
    git(repo, 'tag', 'a@v1.0.0');

    const { record } = await seed();

    expect(record).toEqual({ 'packages/a': { name: 'a', version: '1.2.0', at } });
  });
});
