import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { devNull, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const RELEASE_CLI = fileURLToPath(new URL('../../packages/release/dist/cli.js', import.meta.url));
const FAKE_GITHUB_API = new URL('./fixtures/fake-github-api.mjs', import.meta.url).href;

// Ignore the developer's git config and any real GitHub context the suite runs under.
const env = {
  ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GITHUB_'))),
  GIT_CONFIG_GLOBAL: devNull,
  GIT_CONFIG_NOSYSTEM: '1',
};

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8', env }).trim();
}

function write(path: string, content: string): void {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, content);
}

describe('direct release after a merged PR', () => {
  let repo: string;

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), 'rk-merged-pr-'));
  });

  afterEach(() => rmSync(repo, { recursive: true, force: true }));

  /** Two packages that both change in the merged PR's commit, released with `ci` and the PR carrying `labels`. */
  function releaseAfterMerge(ci: Record<string, unknown>, labels: string[]) {
    write(join(repo, 'package.json'), '{ "name": "rk-fixture", "private": true }\n');
    write(join(repo, 'pnpm-workspace.yaml'), 'packages:\n  - "packages/*"\n');
    write(
      join(repo, 'releasekit.config.json'),
      JSON.stringify({
        version: {
          preset: 'angular',
          versionPrefix: 'v',
          tagTemplate: '${packageName}@v${version}',
          packageSpecificTags: true,
        },
        publish: { npm: { enabled: false }, git: { push: false }, githubRelease: { enabled: false } },
        ci,
      }),
    );
    for (const name of ['a', 'b']) {
      write(join(repo, 'packages', name, 'package.json'), `{ "name": "rk-${name}", "version": "1.0.0" }\n`);
      write(join(repo, 'packages', name, 'index.js'), '// v1\n');
    }

    git(repo, 'init', '-q');
    git(repo, 'config', 'user.name', 'test');
    git(repo, 'config', 'user.email', 'test@example.com');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-qm', 'chore: init');
    git(repo, 'tag', 'rk-a@v1.0.0');
    git(repo, 'tag', 'rk-b@v1.0.0');
    for (const name of ['a', 'b']) {
      write(join(repo, 'packages', name, 'index.js'), '// feature\n');
    }
    git(repo, 'commit', '-qam', 'feat: add features (#7)');
    const mergeSha = git(repo, 'rev-parse', 'HEAD');

    const result = spawnSync(
      process.execPath,
      [
        '--import',
        FAKE_GITHUB_API,
        RELEASE_CLI,
        'release',
        '--json',
        '--skip-notes',
        '--skip-github-release',
        '--skip-verification',
      ],
      {
        cwd: repo,
        encoding: 'utf-8',
        env: {
          ...env,
          GITHUB_REPOSITORY: 'owner/repo',
          GITHUB_SHA: mergeSha,
          GITHUB_TOKEN: 'fake-token',
          GITHUB_EVENT_NAME: 'push',
          RK_FAKE_GITHUB: JSON.stringify({ prs: [{ number: 7, sha: mergeSha, labels }] }),
        },
      },
    );
    return { result, mergeSha };
  }

  it('should release every changed package for a PR with no scope label, without --target', () => {
    const { result } = releaseAfterMerge({ releaseStrategy: 'direct', releaseTrigger: 'commit' }, []);

    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(result.stderr).toContain('winning PR #7');
    expect(git(repo, 'tag', '--points-at', 'HEAD').split('\n').sort()).toEqual(['rk-a@v1.1.0', 'rk-b@v1.1.0']);
  });

  it('should take the bump from a bump label in label mode', () => {
    const { result } = releaseAfterMerge({ releaseStrategy: 'direct', releaseTrigger: 'label' }, ['bump:major']);

    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(git(repo, 'tag', '--points-at', 'HEAD').split('\n').sort()).toEqual(['rk-a@v2.0.0', 'rk-b@v2.0.0']);
  });

  it('should exit 0 without releasing for a PR with no release labels in label mode', () => {
    const { result, mergeSha } = releaseAfterMerge({ releaseStrategy: 'direct', releaseTrigger: 'label' }, []);

    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ status: 'success', changed: false, data: null });
    expect(result.stderr).toContain('No release labels found');
    expect(git(repo, 'rev-parse', 'HEAD')).toBe(mergeSha);
  });
});
