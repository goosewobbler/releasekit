/**
 * Runs the built VersionEngine API against a temp git repo with a remote, with skipReleasedAfter set the way release
 * sets it on a re-run. Requires `pnpm build` in @releasekit/version first.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { VersionOutput } from '@releasekit/core';
import { afterEach, describe, expect, it } from 'vitest';
import { createConventionalCommit } from '../utils/git.js';
import { mockVersionUpdates } from '../utils/package.js';
import { cleanupTempDir } from '../utils/tempFixture.js';
import { createWorkspaceRepo } from '../utils/workspace.js';

let tempDir: string;
let remoteDir: string;

const git = (...args: string[]) => execFileSync('git', args, { cwd: tempDir, encoding: 'utf8' }).trim();

function setUp(packages: Record<string, string>) {
  tempDir = createWorkspaceRepo('rk-released-', {
    packages,
    version: '1.0.0',
    config: {
      preset: 'conventionalcommits',
      sync: false,
      versionPrefix: 'v',
      packageSpecificTags: true,
      tagTemplate: '${packageName}@v${version}',
    },
    tags: Object.values(packages).map((name) => `${name}@v1.0.0`),
  });
  remoteDir = mkdtempSync(join(tmpdir(), 'rk-released-remote-'));
  execFileSync('git', ['init', '--bare', '-q', remoteDir]);
  git('remote', 'add', 'origin', remoteDir);
}

function commitTo(pkg: string, message: string) {
  writeFileSync(join(tempDir, 'packages', pkg, 'index.js'), `// ${message}\n`);
  createConventionalCommit(tempDir, 'fix', message, undefined, false, [`packages/${pkg}`]);
}

/** Releases `pkg` as a run at the current commit would, recording it with every other package at its first tag. */
function release(pkg: string, version: string, others: string[]) {
  const at = git('rev-parse', 'HEAD');
  const initial = git('rev-list', '--max-parents=0', 'HEAD');
  const record = Object.fromEntries([
    [`packages/${pkg}`, { name: pkg, version, at }],
    ...others.map((name) => [`packages/${name}`, { name, version: '1.0.0', at: initial }]),
  ]);
  writeFileSync(join(tempDir, 'releasekit.versions.json'), JSON.stringify(record));
  mockVersionUpdates(join(tempDir, 'packages', pkg), version);
  git('add', '-A', 'packages', 'releasekit.versions.json');
  git('commit', '-qm', `chore: release ${pkg} v${version}`, '--no-verify');
  git('tag', `${pkg}@v${version}`);
}

/** Pushes the branch and tags, and checks out `commit` as actions/checkout does on a re-run, with origin/main at that commit. */
function rerunAt(commit: string) {
  git('push', '-q', '--tags', 'origin', 'HEAD:refs/heads/main');
  git('update-ref', 'refs/remotes/origin/main', commit);
  git('checkout', '-q', commit);
}

function runVersionEngine(commit: string): VersionOutput {
  const script = `
    import { VersionEngine, enableJsonOutput, getJsonData, loadConfig } from ${JSON.stringify(pathToFileURL(join(process.cwd(), 'dist/index.js')).href)};
    enableJsonOutput(true);
    const skipReleasedAfter = { commit: ${JSON.stringify(commit)}, remote: 'origin', branch: 'main' };
    const engine = new VersionEngine(loadConfig(), { dryRun: true, skipReleasedAfter });
    engine.setStrategy('async');
    await engine.run(await engine.getWorkspacePackages());
    process.stdout.write(JSON.stringify(getJsonData()));
  `;
  const result = spawnSync('node', ['--input-type=module', '-e', script], { cwd: tempDir, encoding: 'utf8' });
  if (result.status !== 0) {
    const cause = result.error?.message ?? result.signal ?? `exit status ${result.status}`;
    throw new Error(`version engine failed (${cause}):\n${result.stderr}`);
  }
  return JSON.parse(result.stdout) as VersionOutput;
}

describe('skipReleasedAfter', () => {
  afterEach(() => {
    cleanupTempDir(tempDir);
    cleanupTempDir(remoteDir);
  });

  it("should skip a package the remote branch's record released at the run's commit, though the checkout and origin/main are behind it", () => {
    setUp({ 'pkg-a': 'pkg-a', 'pkg-b': 'pkg-b' });
    commitTo('pkg-a', 'correct a typo in a');
    commitTo('pkg-b', 'correct a typo in b');
    const runCommit = git('rev-parse', 'HEAD');
    release('pkg-a', '1.0.1', ['pkg-b']);
    rerunAt(runCommit);

    const output = runVersionEngine(runCommit);

    expect(output.updates.map((u) => [u.packageName, u.newVersion])).toEqual([['pkg-b', '1.0.1']]);
  });
});
