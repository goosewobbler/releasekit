import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { warn } from '@releasekit/core';
import { createFakeForge, type FakeForge } from '@releasekit/forge';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { forgeFor, MARKER } from '../../src/github.js';
import { runPreview } from '../../src/preview/preview.js';

vi.mock('../../src/github.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/github.js')>()),
  forgeFor: vi.fn(),
}));

vi.mock('@releasekit/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@releasekit/core')>()),
  info: vi.fn(),
  success: vi.fn(),
  warn: vi.fn(),
}));

function git(dir: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf-8' }).trim();
}

function commit(dir: string, file: string, message: string): void {
  writeFileSync(join(dir, file), `${message}\n`);
  git(dir, 'add', file);
  git(dir, 'commit', '-q', '-m', message);
}

function writeEvent(dir: string, pullRequest: object): void {
  const eventPath = join(dir, 'event.json');
  writeFileSync(eventPath, JSON.stringify({ pull_request: { number: 7, ...pullRequest } }));
  vi.stubEnv('GITHUB_EVENT_PATH', eventPath);
}

describe('runPreview commit scope in a standing-PR feeder', () => {
  let dir: string;
  let originalCwd: string;
  let forge: FakeForge;

  beforeEach(() => {
    vi.clearAllMocks();
    originalCwd = process.cwd();
    dir = realpathSync(mkdtempSync(join(tmpdir(), 'rk-preview-scope-')));
    git(dir, 'init', '-q', '-b', 'main');
    git(dir, 'config', 'user.email', 'test@example.com');
    git(dir, 'config', 'user.name', 'Test');
    git(dir, 'config', 'commit.gpgsign', 'false');
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'test-pkg', version: '1.0.0' }, null, 2));
    writeFileSync(
      join(dir, 'releasekit.config.json'),
      JSON.stringify({ version: { versionPrefix: 'v' }, ci: { releaseStrategy: 'standing-pr' } }, null, 2),
    );
    git(dir, 'add', '.');
    git(dir, 'commit', '-q', '-m', 'chore: init');
    git(dir, 'tag', 'v1.0.0');

    forge = createFakeForge();
    vi.mocked(forgeFor).mockReturnValue(forge);
    vi.stubEnv('GITHUB_REPOSITORY', 'owner/repo');
    vi.stubEnv('GITHUB_TOKEN', 'token');
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    // The conventional-commits bumper runs git in the process cwd, not the project dir.
    process.chdir(dir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    rmSync(dir, { recursive: true, force: true });
  });

  function previewBody(): string {
    return forge.comments.find((c) => c.body.startsWith(MARKER))?.body ?? '';
  }

  /** A PR fixing a bug while `main` gains a feature, checked out as GitHub's refs/pull/N/merge with no origin/main. */
  function checkOutMergeRef(): string {
    const branchPoint = git(dir, 'rev-parse', 'HEAD');
    git(dir, 'checkout', '-q', '-b', 'feat/own');
    commit(dir, 'own.txt', 'fix: correct the own bug');
    git(dir, 'checkout', '-q', 'main');
    commit(dir, 'other.txt', 'feat: add the other feature');
    git(dir, 'checkout', '-q', '--detach', 'main');
    git(dir, 'merge', '-q', '--no-ff', '-m', 'Merge feat/own into main', 'feat/own');
    writeEvent(dir, {
      head: { ref: 'feat/own', sha: git(dir, 'rev-parse', 'feat/own') },
      base: { ref: 'main', sha: branchPoint },
    });
    return branchPoint;
  }

  function seedStalePreview(releaseSha: string): void {
    forge = createFakeForge({
      comments: [
        {
          id: 1,
          prNumber: 7,
          body: `${MARKER}\n\n<!-- releasekit-preview-stale:${releaseSha} -->\n> **Stale:** notice\n\nold preview`,
        },
      ],
    });
    vi.mocked(forgeFor).mockReturnValue(forge);
  }

  it('should leave out commits merged to the base branch after the PR branched', async () => {
    checkOutMergeRef();

    await runPreview({ projectDir: dir, dryRun: false });

    expect(previewBody()).toContain('correct the own bug');
    expect(previewBody()).not.toContain('add the other feature');
    expect(previewBody()).toContain('1.0.1');
    expect(previewBody()).not.toContain('1.1.0');
    expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('pull_request.base.sha'));
  });

  it('should scope a PR-head checkout from its merge base with the remote-tracking base branch', async () => {
    const lagging = git(dir, 'rev-parse', 'HEAD');
    commit(dir, 'early.txt', 'feat: add the early feature');
    git(dir, 'checkout', '-q', '-b', 'feat/own');
    commit(dir, 'own.txt', 'fix: correct the own bug');
    git(dir, 'checkout', '-q', 'main');
    commit(dir, 'other.txt', 'feat: add the other feature');
    git(dir, 'update-ref', 'refs/remotes/origin/main', 'main');
    // Shadows refs/remotes/origin/main for a bare `origin/main`.
    git(dir, 'tag', 'origin/main', lagging);
    git(dir, 'checkout', '-q', 'feat/own');
    writeEvent(dir, {
      head: { ref: 'feat/own', sha: git(dir, 'rev-parse', 'HEAD') },
      base: { ref: 'main', sha: lagging },
    });

    await runPreview({ projectDir: dir, dryRun: false });

    expect(previewBody()).toContain('correct the own bug');
    expect(previewBody()).not.toContain('add the early feature');
    expect(previewBody()).toContain('1.0.1');
  });

  it('should look for the base branch under the configured git.remote', async () => {
    writeFileSync(
      join(dir, 'releasekit.config.json'),
      JSON.stringify({
        git: { remote: 'upstream' },
        version: { versionPrefix: 'v' },
        ci: { releaseStrategy: 'standing-pr' },
      }),
    );
    git(dir, 'commit', '-q', '-am', 'chore: push to upstream');
    const lagging = git(dir, 'rev-parse', 'HEAD~1');
    commit(dir, 'early.txt', 'feat: add the early feature');
    git(dir, 'checkout', '-q', '-b', 'feat/own');
    commit(dir, 'own.txt', 'fix: correct the own bug');
    git(dir, 'checkout', '-q', 'main');
    commit(dir, 'other.txt', 'feat: add the other feature');
    git(dir, 'update-ref', 'refs/remotes/upstream/main', 'main');
    git(dir, 'checkout', '-q', 'feat/own');
    writeEvent(dir, {
      head: { ref: 'feat/own', sha: git(dir, 'rev-parse', 'HEAD') },
      base: { ref: 'main', sha: lagging },
    });

    await runPreview({ projectDir: dir, dryRun: false });

    expect(previewBody()).toContain('correct the own bug');
    expect(previewBody()).not.toContain('add the early feature');
    expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('pull_request.base.sha'));
  });

  it("should fall back to the event's base SHA, with a warning", async () => {
    commit(dir, 'early.txt', 'feat: add the early feature');
    const lagging = git(dir, 'rev-parse', 'HEAD');
    commit(dir, 'late.txt', 'fix: patch the late bug');
    git(dir, 'checkout', '-q', '-b', 'feat/own');
    commit(dir, 'own.txt', 'fix: correct the own bug');
    writeEvent(dir, {
      head: { ref: 'feat/own', sha: git(dir, 'rev-parse', 'HEAD') },
      base: { ref: 'main', sha: lagging },
    });

    await runPreview({ projectDir: dir, dryRun: false });

    // Scoped from `lagging`: newer than the last tag, older than where the PR branched.
    expect(previewBody()).toContain('patch the late bug');
    expect(previewBody()).not.toContain('add the early feature');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('pull_request.base.sha'));
  });

  it('should keep the stale mark when the release it names landed after this checkout', async () => {
    checkOutMergeRef();
    const unseenRelease = 'c0ffee0000000000000000000000000000000001';
    seedStalePreview(unseenRelease);

    await runPreview({ projectDir: dir, dryRun: false });

    expect(previewBody().startsWith(`${MARKER}\n\n<!-- releasekit-preview-stale:${unseenRelease} -->`)).toBe(true);
    expect(previewBody()).toContain('correct the own bug');
    expect(previewBody()).not.toContain('old preview');
  });

  it('should drop the stale mark once the checkout includes the release it names', async () => {
    const branchPoint = checkOutMergeRef();
    seedStalePreview(branchPoint);

    await runPreview({ projectDir: dir, dryRun: false });

    expect(previewBody()).not.toContain('releasekit-preview-stale');
    expect(previewBody()).toContain('correct the own bug');
  });
});
