import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { devNull, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXIT_CODES } from '@releasekit/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const RELEASE_CLI = fileURLToPath(new URL('../../packages/release/dist/cli.js', import.meta.url));

// Ignore the developer's git config and any real GitHub context the suite runs under.
const env = {
  ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GITHUB_'))),
  GIT_CONFIG_GLOBAL: devNull,
  GIT_CONFIG_NOSYSTEM: '1',
};

function write(path: string, content: string): void {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, content);
}

/** A repo with one package, `pkg`, carrying a releasable commit since its tag. */
function createRepo(dir: string, pkg: string): void {
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, env });
  write(join(dir, 'package.json'), `{ "name": "${pkg}-root", "private": true }\n`);
  write(join(dir, 'pnpm-workspace.yaml'), 'packages:\n  - "packages/*"\n');
  write(join(dir, 'releasekit.config.json'), JSON.stringify({ version: { preset: 'angular', versionPrefix: 'v' } }));
  write(join(dir, 'packages', pkg, 'package.json'), `{ "name": "${pkg}", "version": "1.0.0" }\n`);
  git('init', '-q');
  git('config', 'user.name', 'test');
  git('config', 'user.email', 'test@example.com');
  git('add', '-A');
  git('commit', '-qm', 'chore: init');
  git('tag', 'v1.0.0');
  write(join(dir, 'packages', pkg, 'index.js'), '// feature\n');
  git('add', '-A');
  git('commit', '-qm', 'feat: add a feature');
}

function run(cwd: string, ...args: string[]) {
  return spawnSync(process.execPath, [RELEASE_CLI, ...args], { cwd, encoding: 'utf-8', env });
}

describe('--project-dir', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'rk-project-dir-'));
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("should release the project folder's packages, not the current folder's", () => {
    createRepo(join(root, 'project'), 'rk-project');
    createRepo(join(root, 'elsewhere'), 'rk-elsewhere');

    const result = run(
      join(root, 'elsewhere'),
      'release',
      '--dry-run',
      '--json',
      '--skip-notes',
      '--project-dir',
      '../project',
    );

    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    const updates = JSON.parse(result.stdout).data.versionOutput.updates as Array<{ packageName: string }>;
    const names = updates.map((u) => u.packageName);
    expect(names).toContain('rk-project');
    expect(names).not.toContain('rk-elsewhere');
  });

  it.each(['release', 'gate', 'standing-pr update'])(
    'should fail %s up front when the folder is missing',
    (command) => {
      const missing = join(root, 'missing');

      const result = run(root, ...command.split(' '), '--project-dir', missing, '--output', 'result.json');

      expect(result.status).toBe(EXIT_CODES.INPUT_ERROR);
      expect(result.stderr).toContain(`--project-dir ${missing} is not a directory`);
      expect(JSON.parse(readFileSync(join(root, 'result.json'), 'utf-8'))).toMatchObject({
        status: 'error',
        errors: [{ code: 'INPUT_ERROR', message: `--project-dir ${missing} is not a directory` }],
      });
    },
  );
});
