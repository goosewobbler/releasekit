import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { unwrapEnvelope } from '@releasekit/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createReleaseCommand } from '../../src/commands/release-command.js';
import type { ReleaseOutput } from '../../src/types.js';

function git(cwd: string, ...args: string[]) {
  execFileSync('git', args, { cwd, stdio: 'ignore' });
}

function writePackage(dir: string, json: Record<string, unknown>) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(json));
}

function commitTo(projectDir: string, name: string, message: string) {
  fs.writeFileSync(path.join(projectDir, 'packages', name, 'index.js'), `// ${message}\n`);
  git(projectDir, 'add', '.');
  git(projectDir, 'commit', '-qm', message);
}

function createRepo(versionConfig: Record<string, unknown>): string {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'releasekit-release-prerequisites-'));
  writePackage(projectDir, { name: 'monorepo', version: '1.0.0', private: true });
  fs.writeFileSync(path.join(projectDir, 'pnpm-workspace.yaml'), 'packages:\n  - "packages/*"\n');
  writePackage(path.join(projectDir, 'packages', 'app'), {
    name: 'app',
    version: '1.0.0',
    dependencies: { lib: 'workspace:*', util: 'workspace:*' },
  });
  writePackage(path.join(projectDir, 'packages', 'lib'), { name: 'lib', version: '1.0.0' });
  writePackage(path.join(projectDir, 'packages', 'util'), { name: 'util', version: '1.0.0' });
  fs.writeFileSync(
    path.join(projectDir, 'releasekit.config.json'),
    JSON.stringify({
      version: {
        preset: 'conventionalcommits',
        sync: false,
        packageSpecificTags: true,
        tagTemplate: '${packageName}@v${version}',
        ...versionConfig,
      },
    }),
  );
  git(projectDir, 'init', '-q');
  git(projectDir, 'config', 'user.email', 'test@example.com');
  git(projectDir, 'config', 'user.name', 'Test');
  git(projectDir, 'add', '.');
  git(projectDir, 'commit', '-qm', 'chore: initial commit');
  for (const name of ['app', 'lib', 'util']) {
    git(projectDir, 'tag', `${name}@v1.0.0`);
  }
  return projectDir;
}

// Runs the real version engine, whose first import can exceed the 5s default under a full turbo run.
describe('release --include-prerequisites', { timeout: 30_000 }, () => {
  let projectDir: string;

  beforeEach(() => {
    // Without a GitHub context the merged-PR gate is skipped.
    vi.stubEnv('GITHUB_REPOSITORY', '');
    vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    fs.rmSync(projectDir, { recursive: true, force: true });
  });

  it.each([
    ['async', {}],
    ['group', { groups: { apps: { packages: ['app'], sync: 'fixed' } } }],
  ])('should release the targets and their changed prerequisites in %s mode', async (_mode, versionConfig) => {
    projectDir = createRepo(versionConfig);
    commitTo(projectDir, 'app', 'feat: add a command');
    commitTo(projectDir, 'lib', 'fix: correct a typo');
    const outputPath = path.join(projectDir, 'result.json');

    await createReleaseCommand().parseAsync([
      'node',
      'release',
      '--dry-run',
      '--json',
      '--skip-notes',
      '--skip-publish',
      '--target',
      'app',
      '--include-prerequisites',
      '--output',
      outputPath,
      '--project-dir',
      projectDir,
    ]);

    const result = unwrapEnvelope(JSON.parse(fs.readFileSync(outputPath, 'utf-8'))) as ReleaseOutput;
    expect(Object.fromEntries(result.versionOutput.updates.map((u) => [u.packageName, u.newVersion]))).toEqual({
      app: '1.1.0',
      lib: '1.0.1',
    });
  });
});
