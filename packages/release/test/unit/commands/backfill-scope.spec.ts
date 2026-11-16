import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runPipeline } from '@releasekit/notes';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBackfillCommand } from '../../../src/commands/backfill-command.js';

vi.mock('@releasekit/notes', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@releasekit/notes')>()),
  runPipeline: vi.fn(async () => ({ files: [], releaseNotes: {} })),
}));

vi.mock('@releasekit/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@releasekit/core')>()),
  info: vi.fn(),
  success: vi.fn(),
  warn: vi.fn(),
}));

function git(dir: string, ...args: string[]): void {
  execFileSync('git', args, { cwd: dir });
}

function write(dir: string, file: string, content: string): void {
  mkdirSync(join(dir, file, '..'), { recursive: true });
  writeFileSync(join(dir, file), content);
}

function commit(dir: string, file: string, message: string): void {
  write(dir, file, `// ${message}\n`);
  git(dir, 'add', file);
  git(dir, 'commit', '-q', '-m', message);
}

describe('backfill commit scope', () => {
  let dir: string;
  let originalCwd: string;

  beforeEach(() => {
    vi.clearAllMocks();
    originalCwd = process.cwd();
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    dir = realpathSync(mkdtempSync(join(tmpdir(), 'rk-backfill-scope-')));
    git(dir, 'init', '-q', '-b', 'main');
    git(dir, 'config', 'user.email', 'test@example.com');
    git(dir, 'config', 'user.name', 'Test');
    git(dir, 'config', 'commit.gpgsign', 'false');
    git(dir, 'config', 'tag.gpgsign', 'false');
    write(dir, 'package.json', JSON.stringify({ name: 'monorepo', version: '1.0.0', private: true }));
    write(dir, 'pnpm-workspace.yaml', 'packages:\n  - "packages/*"\n  - "packages/*/plugin"\n');
    process.chdir(dir);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    // Windows can't remove the process's current directory.
    process.chdir(originalCwd);
    rmSync(dir, { recursive: true, force: true });
  });

  function createRepo(packages: Record<string, string>, version: Record<string, unknown> = {}): void {
    for (const [pkgDir, name] of Object.entries(packages)) {
      write(dir, join('packages', pkgDir, 'package.json'), JSON.stringify({ name, version: '1.0.0' }));
    }
    write(
      dir,
      'releasekit.config.json',
      JSON.stringify({
        version: { sync: false, packageSpecificTags: true, tagTemplate: '${packageName}@v${version}', ...version },
        notes: { releaseNotes: { file: { dir: 'release-notes' } } },
      }),
    );
    git(dir, 'add', '.');
    git(dir, 'commit', '-q', '-m', 'chore: init');
  }

  async function backfilledEntries(...args: string[]): Promise<string[]> {
    await createBackfillCommand().parseAsync(args, { from: 'user' });
    return vi
      .mocked(runPipeline)
      .mock.calls.filter(([input]) => input.packages[0]?.version === '1.1.0')
      .flatMap(([input]) => input.packages[0]?.entries.map((e) => e.description) ?? []);
  }

  it('should include commits to a crate the package versions through cargo.paths', async () => {
    createRepo({ app: 'app' }, { cargo: { paths: ['../../crates/app'] } });
    // publish = false, so discovery doesn't release the crate as a package of its own.
    write(dir, 'crates/app/Cargo.toml', '[package]\nname = "app"\nversion = "1.0.0"\npublish = false\n');
    git(dir, 'add', '.');
    git(dir, 'commit', '-q', '-m', 'chore: add crate');
    git(dir, 'tag', 'app@v1.0.0');
    commit(dir, 'crates/app/src/lib.rs', 'feat: add a crate API');
    commit(dir, 'packages/app/index.js', 'fix: correct a typo');
    commit(dir, 'docs/readme.md', 'docs: describe the app');
    git(dir, 'tag', 'app@v1.1.0');

    expect(await backfilledEntries('--path', 'packages/app')).toEqual(['correct a typo', 'add a crate API']);
  });

  it('should ignore cargo.paths in group mode, as version does', async () => {
    createRepo(
      { app: 'app' },
      {
        sync: false,
        cargo: { paths: ['../../crates/app'] },
        groups: { app: { packages: ['app'], sync: 'independent' } },
      },
    );
    write(dir, 'crates/app/Cargo.toml', '[package]\nname = "app"\nversion = "1.0.0"\npublish = false\n');
    git(dir, 'add', '.');
    git(dir, 'commit', '-q', '-m', 'chore: add crate');
    git(dir, 'tag', 'app@v1.0.0');
    commit(dir, 'crates/app/src/lib.rs', 'feat: add a crate API');
    commit(dir, 'packages/app/index.js', 'fix: correct a typo');
    git(dir, 'tag', 'app@v1.1.0');

    expect(await backfilledEntries('--path', 'packages/app')).toEqual(['correct a typo']);
  });

  it("should leave out a nested package's commits when it releases on its own", async () => {
    createRepo({ host: 'host', 'host/plugin': 'plugin' });
    git(dir, 'tag', 'host@v1.0.0');
    commit(dir, 'packages/host/plugin/index.js', 'feat: add a plugin API');
    commit(dir, 'packages/host/index.js', 'fix: correct a typo');
    git(dir, 'tag', 'host@v1.1.0');

    expect(await backfilledEntries('--path', 'packages/host')).toEqual(['correct a typo']);
  });

  it('should read the directory of the package --package names when --path is left out', async () => {
    createRepo({ app: 'app', lib: 'lib' });
    git(dir, 'tag', 'app@v1.0.0');
    commit(dir, 'packages/lib/index.js', 'feat: add a lib API');
    commit(dir, 'packages/app/index.js', 'fix: correct a typo');
    git(dir, 'tag', 'app@v1.1.0');

    expect(await backfilledEntries('--package', 'app')).toEqual(['correct a typo']);
  });

  it("should keep every workspace package's commits in a synced release's notes", async () => {
    createRepo({ app: 'app', lib: 'lib' }, { sync: true, packageSpecificTags: false, tagTemplate: 'v${version}' });
    git(dir, 'tag', 'v1.0.0');
    commit(dir, 'packages/lib/index.js', 'feat: add a lib API');
    commit(dir, 'packages/app/index.js', 'fix: correct a typo');
    git(dir, 'tag', 'v1.1.0');

    expect(await backfilledEntries('--path', '.')).toEqual(['correct a typo', 'add a lib API']);
  });
});
