/**
 * Runs the built version engine against a temp git repo, the way release does on a re-run.
 * Requires `pnpm build` in @releasekit/version first.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { VersionOutput } from '@releasekit/core';
import { afterEach, describe, expect, it } from 'vitest';
import { createConventionalCommit } from '../utils/git.js';
import { createPackageJson } from '../utils/package.js';
import { cleanupTempDir } from '../utils/tempFixture.js';
import { createWorkspaceRepo } from '../utils/workspace.js';

let tempDir: string;

const git = (...args: string[]) => execFileSync('git', args, { cwd: tempDir, encoding: 'utf8' }).trim();

/** Dated a day apart, so tags created in the same second don't tie on creation time. */
function tag(name: string, day: number) {
  execFileSync('git', ['tag', '-a', '-m', 'release', name], {
    cwd: tempDir,
    env: { ...process.env, GIT_COMMITTER_DATE: `2020-01-0${day}T00:00:00Z` },
  });
}

function commitTo(pkg: string, message: string) {
  writeFileSync(join(tempDir, 'packages', pkg, 'index.js'), `// ${message}\n`);
  createConventionalCommit(tempDir, 'fix', message, undefined, false, [`packages/${pkg}`]);
}

function release(pkg: string, version: string) {
  createPackageJson(join(tempDir, 'packages', pkg), pkg, version);
  git('commit', '-qam', `chore: release ${pkg} v${version}`);
  tag(`${pkg}@v${version}`, 2);
}

function runVersionEngine(skipTaggedAfter: string): VersionOutput {
  const script = `
    import { VersionEngine, enableJsonOutput, getJsonData, loadConfig } from ${JSON.stringify(join(process.cwd(), 'dist/index.js'))};
    enableJsonOutput(true);
    const engine = new VersionEngine(loadConfig(), { dryRun: true, skipTaggedAfter: ${JSON.stringify(skipTaggedAfter)} });
    engine.setStrategy('async');
    await engine.run(await engine.getWorkspacePackages());
    process.stdout.write(JSON.stringify(getJsonData()));
  `;
  const result = spawnSync('node', ['--input-type=module', '-e', script], { cwd: tempDir, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`version engine failed:\n${result.stderr}`);
  }
  return JSON.parse(result.stdout) as VersionOutput;
}

describe('skipTaggedAfter', () => {
  afterEach(() => {
    cleanupTempDir(tempDir);
  });

  it("should skip a package already released after the run's commit and bump one released before it", () => {
    tempDir = createWorkspaceRepo('rk-released-', {
      packages: { 'pkg-a': 'pkg-a', 'pkg-b': 'pkg-b' },
      version: '1.0.0',
      config: {
        preset: 'conventionalcommits',
        sync: false,
        versionPrefix: 'v',
        packageSpecificTags: true,
        tagTemplate: '${packageName}@v${version}',
      },
    });
    tag('pkg-a@v1.0.0', 1);
    tag('pkg-b@v1.0.0', 1);
    commitTo('pkg-a', 'correct a typo in a');
    commitTo('pkg-b', 'correct a typo in b');
    const runCommit = git('rev-parse', 'HEAD');
    release('pkg-a', '1.0.1');
    commitTo('pkg-a', 'correct another typo in a');

    const output = runVersionEngine(runCommit);

    expect(output.updates.map((u) => [u.packageName, u.newVersion])).toEqual([['pkg-b', '1.0.1']]);
    expect(output.tags).toEqual(['pkg-b@v1.0.1']);
  });
});
