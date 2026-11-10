import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { devNull, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const RELEASE_CLI = fileURLToPath(new URL('../../packages/release/dist/cli.js', import.meta.url));

// Ignore the developer's git config (signing, hooks) and any CI GitHub context (PR label lookups).
const env = {
  ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GITHUB_'))),
  GIT_CONFIG_GLOBAL: devNull,
  GIT_CONFIG_NOSYSTEM: '1',
};

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8', env });
}

function write(path: string, content: string): void {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, content);
}

// Logs the files it's given, then re-indents JSON with tabs and appends a `# formatted` line to the rest.
const FORMATTER = `import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
const [log, ...files] = process.argv.slice(2);
appendFileSync(log, files.map((file) => file + '\\n').join(''));
for (const file of files) {
  const text = readFileSync(file, 'utf-8');
  writeFileSync(file, file.endsWith('.json') ? JSON.stringify(JSON.parse(text), null, '\\t') + '\\n' : text + '# formatted\\n');
}
`;

describe('git.formatCommand in a direct release', () => {
  let root: string;
  let repo: string;
  let tools: string;
  let log: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'rk-format-command-'));
    repo = join(root, 'repo');
    // A space in the path, so the command needs its quotes kept.
    tools = join(root, 'format tools');
    log = join(tools, 'formatted.log');
    write(join(tools, 'format.mjs'), FORMATTER);
    write(join(tools, 'fail.mjs'), "process.stderr.write('format check exploded\\n');\nprocess.exit(1);\n");
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  function setUpRepo(formatCommand: string): void {
    write(join(repo, 'package.json'), '{ "name": "rk-fixture", "private": true }\n');
    write(join(repo, 'pnpm-workspace.yaml'), 'packages:\n  - "packages/*"\n');
    write(
      join(repo, 'releasekit.config.json'),
      JSON.stringify({
        git: { formatCommand },
        version: {
          preset: 'angular',
          sync: false,
          versionPrefix: 'v',
          tagTemplate: '${packageName}@v${version}',
          packageSpecificTags: true,
        },
        publish: {
          npm: { enabled: false },
          cargo: { enabled: false },
          git: { push: false },
          githubRelease: { enabled: false },
        },
      }),
    );
    write(join(repo, 'packages', 'napi', 'package.json'), '{ "name": "rk-napi", "version": "0.1.0" }\n');
    write(
      join(repo, 'packages', 'napi', 'Cargo.toml'),
      '[package]\nname = "rk-napi"\nversion = "0.1.0"\nedition = "2021"\n',
    );
    write(
      join(repo, 'packages', 'napi', 'Cargo.lock'),
      'version = 4\n\n[[package]]\nname = "rk-napi"\nversion = "0.1.0"\n',
    );
    write(join(repo, 'packages', 'napi', 'src', 'lib.rs'), '// napi\n');

    git(repo, 'init', '-q');
    git(repo, 'config', 'user.name', 'test');
    git(repo, 'config', 'user.email', 'test@example.com');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-qm', 'chore: init');
    git(repo, 'tag', 'rk-napi@v0.1.0');
    write(join(repo, 'packages', 'napi', 'src', 'lib.rs'), '// napi feature\n');
    git(repo, 'commit', '-qam', 'feat: add a feature');
  }

  function release() {
    return spawnSync(process.execPath, [RELEASE_CLI, 'release', '--skip-github-release', '--skip-verification'], {
      cwd: repo,
      encoding: 'utf-8',
      env,
    });
  }

  it('should commit every file the release wrote as the formatter left it', () => {
    setUpRepo(`node "${join(tools, 'format.mjs')}" "${log}"`);

    const result = release();
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);

    expect(git(repo, 'log', '-1', '--format=%s')).toMatch(/^chore: release /);
    expect(readFileSync(log, 'utf-8').split('\n').filter(Boolean).sort()).toEqual([
      'CHANGELOG.md',
      'packages/napi/Cargo.lock',
      'packages/napi/Cargo.toml',
      'packages/napi/package.json',
    ]);
    expect(git(repo, 'show', 'HEAD:packages/napi/package.json')).toBe(
      '{\n\t"name": "rk-napi",\n\t"version": "0.2.0"\n}\n',
    );
    expect(git(repo, 'show', 'HEAD:packages/napi/Cargo.toml')).toMatch(/version = "0\.2\.0"\n[\s\S]*# formatted\n$/);
    expect(git(repo, 'show', 'HEAD:packages/napi/Cargo.lock')).toMatch(/version = "0\.2\.0"\n# formatted\n$/);
    expect(git(repo, 'show', 'HEAD:CHANGELOG.md')).toMatch(/0\.2\.0[\s\S]*# formatted\n$/);
    expect(git(repo, 'status', '--porcelain')).toBe('');
  });

  it('should stop before committing or tagging when the formatter fails', () => {
    const command = `node "${join(tools, 'fail.mjs')}"`;
    setUpRepo(command);
    const head = git(repo, 'rev-parse', 'HEAD');

    const result = release();

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(`git.formatCommand \`${command}\` exited with code 1:\nformat check exploded`);
    expect(git(repo, 'rev-parse', 'HEAD')).toBe(head);
    expect(git(repo, 'tag', '--list').trim()).toBe('rk-napi@v0.1.0');
  });
});
