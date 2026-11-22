import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { devNull, tmpdir } from 'node:os';
import { join } from 'node:path';
import { EXIT_CODES } from '@releasekit/core';
import { createFakeForge, type FakeForge } from '@releasekit/forge';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMigrateCommand } from '../../../src/commands/migrate-command.js';
import { forgeFor } from '../../../src/github.js';
import { DRAFT_LABEL, DRAFT_MANIFEST_MARKER } from '../../../src/publish-authorization.js';
import { serializeManifest } from '../../../src/standing-pr/standing-pr.js';

vi.mock('../../../src/github.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/github.js')>()),
  forgeFor: vi.fn(),
}));

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8' }).trim();
}

// Runs the real version engine, whose first import can exceed the 5s default under a full turbo run.
describe('releasekit migrate', { timeout: 30_000 }, () => {
  let repo: string;
  let forge: FakeForge;
  let stderr: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.stubEnv('GIT_CONFIG_GLOBAL', devNull);
    vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1');
    vi.stubEnv('GITHUB_REPOSITORY', 'owner/repo');
    vi.stubEnv('GITHUB_TOKEN', 'token');
    forge = createFakeForge();
    vi.mocked(forgeFor).mockImplementation(() => forge);
    vi.spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`process.exit(${code})`);
    });
    stderr = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    repo = realpathSync(mkdtempSync(join(tmpdir(), 'rk-migrate-')));
  });

  afterEach(() => {
    vi.restoreAllMocks();
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

  async function migrate(): Promise<void> {
    await createMigrateCommand().parseAsync(['node', 'migrate', '--project-dir', repo]);
  }

  function record(): unknown {
    return JSON.parse(readFileSync(join(repo, 'releasekit.versions.json'), 'utf-8'));
  }

  function output(): string {
    return stderr.mock.calls.map((call) => String(call[0])).join('\n');
  }

  it("should seed each package from its last tag, with a prerelease's last stable release", async () => {
    setUpRepo({ sync: false, packageSpecificTags: true }, { a: '1.1.0-next.0', b: '2.0.0', c: '0.1.0' });
    const stable = git(repo, 'rev-parse', 'HEAD');
    git(repo, 'tag', 'a@v1.0.0');
    git(repo, 'tag', 'b@v2.0.0');
    const prerelease = commit('chore: release a v1.1.0-next.0');
    git(repo, 'tag', 'a@v1.1.0-next.0');
    commit('feat: a later change');

    await migrate();

    expect(record()).toEqual({
      'packages/a': {
        name: 'a',
        version: '1.1.0-next.0',
        at: prerelease,
        lastStable: { version: '1.0.0', at: stable },
      },
      'packages/b': { name: 'b', version: '2.0.0', at: stable },
    });
    expect(output()).toContain(
      'Not seeded: packages/c (c), no release tag is reachable from HEAD. If it has been released, add its entry by hand.',
    );
  });

  it('should keep existing entries and seed a package that has none', async () => {
    setUpRepo({ sync: false, packageSpecificTags: true }, { a: '1.0.0', b: '2.0.0' });
    const at = git(repo, 'rev-parse', 'HEAD');
    git(repo, 'tag', 'a@v1.0.0');
    git(repo, 'tag', 'b@v2.0.0');
    const existing = { 'packages/a': { name: 'a', version: '1.0.1', at: 'hand-edited' } };
    writeFileSync(join(repo, 'releasekit.versions.json'), JSON.stringify(existing));

    await migrate();

    expect(record()).toEqual({ ...existing, 'packages/b': { name: 'b', version: '2.0.0', at } });
  });

  it('should create an empty record in a repo with nothing to seed, so releases start recording', async () => {
    setUpRepo({ sync: false, packageSpecificTags: true }, { a: '1.0.0' });

    await migrate();

    expect(record()).toEqual({});
  });

  it("should seed a sync repo's entries with the shared version at its baseline tag", async () => {
    setUpRepo({ sync: true, baselineTagTemplate: 'release/${prefix}${version}' }, { a: '1.0.0', b: '1.0.0' });
    const at = git(repo, 'rev-parse', 'HEAD');
    git(repo, 'tag', 'release/v1.0.0');
    // The consumer tag, moved off the release commit by a downstream step.
    commit('chore: build');
    git(repo, 'tag', 'v1.0.0');

    await migrate();

    expect(record()).toEqual({
      'packages/a': { name: 'a', version: '1.0.0', at },
      'packages/b': { name: 'b', version: '1.0.0', at },
    });
  });

  it('should seed the manifest version where mismatchStrategy prefer-package picks it', async () => {
    setUpRepo(
      { sync: false, packageSpecificTags: true, mismatchStrategy: 'prefer-package' },
      { a: '1.2.0', b: '1.0.0' },
    );
    const at = git(repo, 'rev-parse', 'HEAD');
    git(repo, 'tag', 'a@v1.0.0');

    await migrate();

    expect(record()).toEqual({ 'packages/a': { name: 'a', version: '1.2.0', at } });
  });

  it.each([
    [
      'a standing PR',
      () => createFakeForge({ standingPR: { number: 5, url: 'u', labels: [] } }),
      'Standing PR #5 is open. Merge or close it, then run releasekit migrate again.',
    ],
    [
      'an unpublished release draft',
      () =>
        createFakeForge({
          openIssues: [{ number: 7, url: 'u', labels: [DRAFT_LABEL] }],
          comments: [
            {
              id: 1,
              prNumber: 7,
              body: serializeManifest(
                {
                  schemaVersion: 2,
                  versionOutput: { dryRun: false, updates: [], changelogs: [], tags: [] },
                  releaseNotes: {},
                  notesFiles: [],
                  createdAt: '2026-01-01T00:00:00.000Z',
                  baseSha: 'sha',
                },
                DRAFT_MANIFEST_MARKER,
              ),
            },
          ],
        }),
      "Release draft #7 hasn't been published.",
    ],
  ])('should refuse while %s is open', async (_case, seededForge, message) => {
    setUpRepo({ sync: false, packageSpecificTags: true }, { a: '1.0.0' });
    git(repo, 'tag', 'a@v1.0.0');
    forge = seededForge();

    await expect(migrate()).rejects.toThrow(`process.exit(${EXIT_CODES.GENERAL_ERROR})`);

    expect(output()).toContain(message);
    expect(existsSync(join(repo, 'releasekit.versions.json'))).toBe(false);
  });
});
