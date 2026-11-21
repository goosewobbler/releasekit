/**
 * Runs the built CLI against a temp git repo.
 * Requires `pnpm build` in @releasekit/version first.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runVersionJson } from '../utils/cli.js';
import { createConventionalCommit } from '../utils/git.js';
import { cleanupTempDir } from '../utils/tempFixture.js';
import { createWorkspaceRepo } from '../utils/workspace.js';

let tempDir: string;

function createRepo(config: Record<string, unknown> = {}) {
  const names = ['app', 'lib', 'util'];
  tempDir = createWorkspaceRepo('rk-prerequisites-', {
    packages: Object.fromEntries(names.map((name) => [name, name])),
    version: '1.0.0',
    config: {
      preset: 'conventionalcommits',
      sync: false,
      versionPrefix: 'v',
      packageSpecificTags: true,
      tagTemplate: '${packageName}@v${version}',
      ...config,
    },
    tags: names.map((name) => `${name}@v1.0.0`),
  });
}

function addDependencies() {
  writeFileSync(
    join(tempDir, 'packages', 'app', 'package.json'),
    JSON.stringify({ name: 'app', version: '1.0.0', dependencies: { lib: 'workspace:*', util: 'workspace:*' } }),
  );
  createConventionalCommit(tempDir, 'chore', 'depend on lib and util', undefined, false, ['packages/app']);
}

function commitTo(name: string, type: string, message: string) {
  writeFileSync(join(tempDir, 'packages', name, 'index.js'), `// ${message}\n`);
  createConventionalCommit(tempDir, type, message, undefined, false, [`packages/${name}`]);
}

describe('--include-prerequisites', () => {
  afterEach(() => {
    cleanupTempDir(tempDir);
  });

  it.each([
    ['async', {}],
    ['group', { groups: { apps: { packages: ['app'], sync: 'fixed' } } }],
  ])('should release the targets and their changed prerequisites in %s mode', (_mode, config) => {
    createRepo(config);
    addDependencies();
    commitTo('app', 'feat', 'add a command');
    commitTo('lib', 'fix', 'correct a typo');

    const output = runVersionJson(tempDir, '--target app --include-prerequisites');

    expect(Object.fromEntries(output.updates.map((u) => [u.packageName, u.newVersion]))).toEqual({
      app: '1.1.0',
      lib: '1.0.1',
    });
  });
});
