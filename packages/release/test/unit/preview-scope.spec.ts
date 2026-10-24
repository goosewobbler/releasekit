import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

describe('runPreview commit scope in a standing-PR feeder', () => {
  let dir: string;
  let originalCwd: string;
  let forge: FakeForge;

  beforeEach(() => {
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

  it('should leave out commits merged to the base branch after the PR branched', async () => {
    const branchPoint = git(dir, 'rev-parse', 'HEAD');
    git(dir, 'checkout', '-q', '-b', 'feat/own');
    commit(dir, 'own.txt', 'fix: correct the own bug');
    git(dir, 'checkout', '-q', 'main');
    commit(dir, 'other.txt', 'feat: add the other feature');
    // GitHub's refs/pull/N/merge: the base tip merged with the PR head.
    git(dir, 'checkout', '-q', '--detach', 'main');
    git(dir, 'merge', '-q', '--no-ff', '-m', 'Merge feat/own into main', 'feat/own');
    git(dir, 'update-ref', 'refs/remotes/origin/main', 'main');

    const eventPath = join(dir, 'event.json');
    writeFileSync(
      eventPath,
      JSON.stringify({
        pull_request: {
          number: 7,
          head: { ref: 'feat/own' },
          base: { ref: 'main', sha: branchPoint },
        },
      }),
    );
    vi.stubEnv('GITHUB_EVENT_PATH', eventPath);

    await runPreview({ projectDir: dir, dryRun: false });

    const body = forge.comments.find((c) => c.body.startsWith(MARKER))?.body ?? '';
    expect(body).toContain('correct the own bug');
    expect(body).not.toContain('add the other feature');
    expect(body).toContain('1.0.1');
    expect(body).not.toContain('1.1.0');
  });
});
