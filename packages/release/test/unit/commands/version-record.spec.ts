import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { devNull, tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeForge } from '@releasekit/forge';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createReleaseCommand } from '../../../src/commands/release-command.js';
import { createStandingPRCommand } from '../../../src/commands/standing-pr-command.js';
import { forgeFor } from '../../../src/github.js';

vi.mock('../../../src/github.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/github.js')>()),
  forgeFor: vi.fn(),
}));

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8' }).trim();
}

// Runs the real version engine, whose first import can exceed the 5s default under a full turbo run.
describe('the version record in a release', { timeout: 30_000 }, () => {
  let root: string;
  let repo: string;
  let remote: string;
  let previousCwd: string;

  beforeEach(() => {
    previousCwd = process.cwd();
    vi.stubEnv('GIT_CONFIG_GLOBAL', devNull);
    vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1');
    vi.stubEnv('GITHUB_EVENT_NAME', '');
    vi.stubEnv('GITHUB_EVENT_PATH', '');
    vi.spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`process.exit(${code})`);
    });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    root = realpathSync(mkdtempSync(join(tmpdir(), 'rk-version-record-')));
    repo = join(root, 'repo');
    remote = join(root, 'remote.git');
  });

  afterEach(() => {
    process.chdir(previousCwd);
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    rmSync(root, { recursive: true, force: true });
  });

  /** Returns the record committed before the releases, or undefined for a repo without one. */
  function setUpRepo(config: Record<string, unknown>, { withRecord = true } = {}): Record<string, unknown> | undefined {
    git(root, 'init', '-q', '--bare', '-b', 'main', remote);
    mkdirSync(repo);
    writeFileSync(join(repo, 'package.json'), JSON.stringify({ name: 'monorepo', version: '0.0.0', private: true }));
    writeFileSync(join(repo, 'pnpm-workspace.yaml'), 'packages:\n  - "packages/*"\n');
    writeFileSync(
      join(repo, 'releasekit.config.json'),
      JSON.stringify({ version: { sync: false, packageSpecificTags: true }, ...config }),
    );
    for (const name of ['a', 'b']) {
      mkdirSync(join(repo, 'packages', name), { recursive: true });
      writeFileSync(join(repo, 'packages', name, 'package.json'), JSON.stringify({ name, version: '1.0.0' }));
    }
    git(repo, 'init', '-q', '-b', 'main');
    git(repo, 'config', 'user.email', 'test@example.com');
    git(repo, 'config', 'user.name', 'Test');
    git(repo, 'add', '-A');
    // Tags sort by creation date, so the setup tags predate the ones the releases create.
    const date = '2020-01-01T00:00:00Z';
    execFileSync('git', ['commit', '-q', '-m', 'chore: init'], {
      cwd: repo,
      env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
    });
    git(repo, 'tag', 'a@v1.0.0');
    git(repo, 'tag', 'b@v1.0.0');
    let record: Record<string, unknown> | undefined;
    if (withRecord) {
      const at = git(repo, 'rev-parse', 'HEAD');
      record = {
        'packages/a': { name: 'a', version: '1.0.0', at },
        'packages/b': { name: 'b', version: '1.0.0', at },
      };
      writeFileSync(join(repo, 'releasekit.versions.json'), JSON.stringify(record));
      git(repo, 'add', '-A');
      git(repo, 'commit', '-q', '-m', 'chore: add the version record');
    }
    git(repo, 'remote', 'add', 'origin', remote);
    git(repo, 'push', '-q', 'origin', 'main', '--tags');
    return record;
  }

  const release = (...args: string[]) =>
    createReleaseCommand().parseAsync([
      'node',
      'release',
      '--skip-notes',
      '--skip-github-release',
      '--skip-verification',
      '--project-dir',
      repo,
      ...args,
    ]);

  function changeA(message: string): string {
    writeFileSync(join(repo, 'packages', 'a', 'index.js'), `// ${message}\n`);
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', message);
    return git(repo, 'rev-parse', 'HEAD');
  }

  function recordAt(ref: string, cwd = repo): unknown {
    return JSON.parse(git(cwd, 'show', `${ref}:releasekit.versions.json`));
  }

  it("should record each released package in the release commit, keeping a prerelease's last stable release", async () => {
    vi.stubEnv('GITHUB_REPOSITORY', '');
    const existing = setUpRepo({ publish: { npm: { enabled: false } } });

    const stableAt = changeA('feat: add a feature');
    await release();
    expect(recordAt('HEAD')).toEqual({
      ...existing,
      'packages/a': { name: 'a', version: '1.1.0', at: stableAt },
    });

    const prereleaseAt = changeA('fix: correct a typo');
    await release('--prerelease', 'next');

    expect(git(repo, 'log', '-1', '--format=%s')).toMatch(/^chore: release /);
    expect(recordAt('HEAD')).toEqual({
      ...existing,
      'packages/a': {
        name: 'a',
        version: '1.1.1-next.0',
        at: prereleaseAt,
        lastStable: { version: '1.1.0', at: stableAt },
      },
    });
    expect(git(repo, 'status', '--porcelain')).toBe('');
  });

  it("should seed the record in a repo's first release", async () => {
    vi.stubEnv('GITHUB_REPOSITORY', '');
    setUpRepo({ publish: { npm: { enabled: false } } }, { withRecord: false });
    const tagged = git(repo, 'rev-parse', 'HEAD');
    const at = changeA('feat: add a feature');

    await release();

    expect(git(repo, 'log', '-1', '--format=%s')).toMatch(/^chore: release /);
    expect(recordAt('HEAD')).toEqual({
      'packages/a': { name: 'a', version: '1.1.0', at },
      'packages/b': { name: 'b', version: '1.0.0', at: tagged },
    });
    expect(git(repo, 'status', '--porcelain')).toBe('');
  });

  it('should record the base commit the standing PR was computed at on its release branch', async () => {
    vi.stubEnv('GITHUB_REPOSITORY', 'owner/repo');
    vi.stubEnv('GITHUB_TOKEN', 'token');
    vi.mocked(forgeFor).mockReturnValue(createFakeForge());
    const existing = setUpRepo({ ci: { releaseStrategy: 'standing-pr' } });
    const at = changeA('feat: add a feature');
    git(repo, 'push', '-q', 'origin', 'main');

    await createStandingPRCommand().parseAsync(['node', 'standing-pr', 'update', '--project-dir', repo]);

    expect(recordAt('release/next', remote)).toEqual({
      ...existing,
      'packages/a': { name: 'a', version: '1.1.0', at },
    });
  });
});
