/**
 * Runs the built VersionEngine API against a temp git repo, with skipTaggedAfter set as release sets it on a re-run.
 * Requires `pnpm build` in @releasekit/version first.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { VersionOutput } from '@releasekit/core';
import { afterEach, describe, expect, it } from 'vitest';
import { createConventionalCommit } from '../utils/git.js';
import { createPackageJson } from '../utils/package.js';
import { cleanupTempDir } from '../utils/tempFixture.js';
import { createWorkspaceRepo } from '../utils/workspace.js';

let tempDir: string;
let tagDay = 1;

const git = (...args: string[]) => execFileSync('git', args, { cwd: tempDir, encoding: 'utf8' }).trim();

/** Dated a day apart, so tags created in the same second don't tie on creation time. */
function tag(name: string) {
  execFileSync('git', ['tag', '-a', '-m', 'release', name], {
    cwd: tempDir,
    env: { ...process.env, GIT_COMMITTER_DATE: `2020-01-${String(tagDay++).padStart(2, '0')}T00:00:00Z` },
  });
}

function commitTo(pkg: string, message: string) {
  writeFileSync(join(tempDir, 'packages', pkg, 'index.js'), `// ${message}\n`);
  createConventionalCommit(tempDir, 'fix', message, undefined, false, [`packages/${pkg}`]);
}

function release(pkg: string, version: string) {
  createPackageJson(join(tempDir, 'packages', pkg), pkg, version);
  git('commit', '-qam', `chore: release ${pkg} v${version}`, '--no-verify');
  tag(`${pkg}@v${version}`);
}

function runVersionEngine(skipTaggedAfter: string, strategy = 'async'): VersionOutput {
  const script = `
    import { VersionEngine, enableJsonOutput, getJsonData, loadConfig } from ${JSON.stringify(pathToFileURL(join(process.cwd(), 'dist/index.js')).href)};
    enableJsonOutput(true);
    const engine = new VersionEngine(loadConfig(), { dryRun: true, skipTaggedAfter: ${JSON.stringify(skipTaggedAfter)} });
    engine.setStrategy(${JSON.stringify(strategy)});
    await engine.run(await engine.getWorkspacePackages());
    process.stdout.write(JSON.stringify(getJsonData()));
  `;
  const result = spawnSync('node', ['--input-type=module', '-e', script], {
    cwd: tempDir,
    encoding: 'utf8',
    timeout: 60_000,
  });
  if (result.status !== 0) {
    const cause = result.error?.message ?? result.signal ?? `exit status ${result.status}`;
    throw new Error(`version engine failed (${cause}):\n${result.stderr}`);
  }
  return JSON.parse(result.stdout) as VersionOutput;
}

describe('skipTaggedAfter', () => {
  afterEach(() => {
    cleanupTempDir(tempDir);
    tagDay = 1;
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
    tag('pkg-a@v1.0.0');
    tag('pkg-b@v1.0.0');
    commitTo('pkg-a', 'correct a typo in a');
    commitTo('pkg-b', 'correct a typo in b');
    const runCommit = git('rev-parse', 'HEAD');
    release('pkg-a', '1.0.1');
    commitTo('pkg-a', 'correct another typo in a');

    const output = runVersionEngine(runCommit);

    expect(output.updates.map((u) => [u.packageName, u.newVersion])).toEqual([['pkg-b', '1.0.1']]);
    expect(output.tags).toEqual(['pkg-b@v1.0.1']);
  });

  it.each(['async', 'single'])("should not skip a package released at the run's own commit (%s)", (strategy) => {
    tempDir = createWorkspaceRepo('rk-released-', {
      packages: { 'pkg-a': 'pkg-a' },
      version: '1.0.0',
      config: {
        preset: 'conventionalcommits',
        sync: false,
        versionPrefix: 'v',
        packageSpecificTags: true,
        tagTemplate: '${packageName}@v${version}',
      },
    });
    tag('pkg-a@v1.0.0');
    commitTo('pkg-a', 'correct a typo in a');
    release('pkg-a', '1.0.1');
    const runCommit = git('rev-parse', 'HEAD');
    commitTo('pkg-a', 'correct another typo in a');

    const output = runVersionEngine(runCommit, strategy);

    expect(output.updates.map((u) => [u.packageName, u.newVersion])).toEqual([['pkg-a', '1.0.2']]);
  });
});
