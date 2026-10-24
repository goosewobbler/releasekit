import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { VersionOutput, VersionPackageUpdate } from '@releasekit/core';
import { createFakeGit, type FakeGit } from '@releasekit/git';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDefaultConfig } from '../../src/config.js';
import { runPipeline } from '../../src/pipeline/index.js';
import type { PublishCliOptions } from '../../src/types.js';
import { execCommand, execCommandSafe } from '../../src/utils/exec.js';

vi.mock('../../src/utils/exec.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/utils/exec.js')>()),
  execCommand: vi.fn(),
  execCommandSafe: vi.fn(),
}));

vi.mock('../../src/utils/auth.js', () => ({
  detectNpmAuth: () => 'token',
  hasCargoAuth: () => true,
  hasPubTokenAuth: () => false,
  detectGitPushMethod: async () => 'https',
}));

let fakeGit: FakeGit;
vi.mock('@releasekit/git', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@releasekit/git')>()),
  createGitCli: () => fakeGit,
}));

const options: PublishCliOptions = {
  registry: 'all',
  npmAuth: 'auto',
  dryRun: false,
  skipGit: true,
  skipPublish: false,
  skipGithubRelease: true,
  skipVerification: true,
  json: false,
  verbose: false,
};

const originalCwd = process.cwd();
let workspace: string;

function write(file: string, contents: string): void {
  fs.mkdirSync(path.dirname(path.join(workspace, file)), { recursive: true });
  fs.writeFileSync(path.join(workspace, file), contents);
}

function packageJson(name: string, dependencies: Record<string, string> = {}): string {
  return JSON.stringify({ name, version: '0.1.0', dependencies });
}

const CORE_PATH_DEP = 'core-crate = { path = "../core", version = "0.1.0" }\n';

function cargoToml(name: string, dependencies = ''): string {
  return `[package]\nname = "${name}"\nversion = "0.1.0"\n\n[dependencies]\n${dependencies}`;
}

function update(packageName: string, filePath: string): VersionPackageUpdate {
  return { packageName, newVersion: '0.2.0', filePath, tag: `${packageName}@v0.2.0` };
}

function perPackageInput(updates: VersionPackageUpdate[]): VersionOutput {
  return { dryRun: false, updates, changelogs: [], tags: updates.map((u) => u.tag ?? '') };
}

function publishedLabels(): string[] {
  return vi
    .mocked(execCommand)
    .mock.calls.map(([, , opts]) => opts?.label ?? '')
    .filter((label) => /^(npm|cargo) publish /.test(label));
}

describe('per-package publish pipeline', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(execCommand).mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 });
    vi.mocked(execCommandSafe).mockResolvedValue({ stdout: '', stderr: '', exitCode: 1 });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 404 } as Response));
    fakeGit = createFakeGit({ currentBranch: 'main' });
    workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'releasekit-per-package-'));
    process.chdir(workspace);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    vi.unstubAllGlobals();
    fs.rmSync(workspace, { recursive: true, force: true });
  });

  it('should publish a crate after its path dependency when it is listed first', async () => {
    write('crates/app/Cargo.toml', cargoToml('app-crate', CORE_PATH_DEP));
    write('crates/core/Cargo.toml', cargoToml('core-crate'));

    await runPipeline(
      perPackageInput([update('app-crate', 'crates/app/Cargo.toml'), update('core-crate', 'crates/core/Cargo.toml')]),
      getDefaultConfig(),
      options,
    );

    expect(publishedLabels()).toEqual(['cargo publish core-crate@0.2.0', 'cargo publish app-crate@0.2.0']);
  });

  it('should publish an npm package after its dependency when it is listed first', async () => {
    write('packages/app/package.json', packageJson('app', { lib: '^0.1.0' }));
    write('packages/lib/package.json', packageJson('lib'));

    await runPipeline(
      perPackageInput([update('app', 'packages/app/package.json'), update('lib', 'packages/lib/package.json')]),
      getDefaultConfig(),
      options,
    );

    expect(publishedLabels()).toEqual(['npm publish lib@0.2.0', 'npm publish app@0.2.0']);
  });

  it("should keep both registries' orders when a hybrid package spans npm and cargo", async () => {
    // web depends on the hybrid's npm side; the hybrid's crate depends on a crate-only package.
    write('packages/web/package.json', packageJson('web', { hybrid: '^0.1.0' }));
    write('packages/hybrid/package.json', packageJson('hybrid'));
    write('packages/hybrid/Cargo.toml', cargoToml('hybrid-crate', CORE_PATH_DEP));
    write('packages/core/Cargo.toml', cargoToml('core-crate'));

    await runPipeline(
      perPackageInput([
        update('web', 'packages/web/package.json'),
        update('hybrid', 'packages/hybrid/package.json'),
        update('core-crate', 'packages/core/Cargo.toml'),
      ]),
      getDefaultConfig(),
      options,
    );

    expect(publishedLabels()).toEqual([
      'cargo publish core-crate@0.2.0',
      'npm publish hybrid@0.2.0',
      'cargo publish hybrid-crate@0.2.0',
      'npm publish web@0.2.0',
    ]);
  });

  it('should publish a hybrid crate after its path dependency when the npm sides are unrelated', async () => {
    write('packages/a/package.json', packageJson('a'));
    write('packages/a/Cargo.toml', cargoToml('a-crate', 'b-crate = { path = "../b", version = "0.1.0" }\n'));
    write('packages/b/package.json', packageJson('b'));
    write('packages/b/Cargo.toml', cargoToml('b-crate'));

    await runPipeline(
      perPackageInput([update('a', 'packages/a/package.json'), update('b', 'packages/b/package.json')]),
      getDefaultConfig(),
      options,
    );

    expect(publishedLabels().filter((l) => l.startsWith('cargo'))).toEqual([
      'cargo publish b-crate@0.2.0',
      'cargo publish a-crate@0.2.0',
    ]);
  });

  it('should follow a configured cargo publishOrder over input order', async () => {
    write('crates/a/Cargo.toml', cargoToml('a-crate'));
    write('crates/b/Cargo.toml', cargoToml('b-crate'));
    const config = getDefaultConfig();
    config.cargo.publishOrder = ['b-crate', 'a-crate'];

    await runPipeline(
      perPackageInput([update('a-crate', 'crates/a/Cargo.toml'), update('b-crate', 'crates/b/Cargo.toml')]),
      config,
      options,
    );

    expect(publishedLabels()).toEqual(['cargo publish b-crate@0.2.0', 'cargo publish a-crate@0.2.0']);
  });

  it('should follow a configured npm publishOrder over input order', async () => {
    write('packages/a/package.json', packageJson('a'));
    write('packages/b/package.json', packageJson('b'));
    const config = getDefaultConfig();
    config.npm.publishOrder = ['b', 'a'];

    await runPipeline(
      perPackageInput([update('a', 'packages/a/package.json'), update('b', 'packages/b/package.json')]),
      config,
      options,
    );

    expect(publishedLabels()).toEqual(['npm publish b@0.2.0', 'npm publish a@0.2.0']);
  });

  it("should push the branch before a package's tag, so a rejected branch push leaves no tag on the remote", async () => {
    write('packages/lib/package.json', packageJson('lib'));
    const push = vi.spyOn(fakeGit, 'push').mockImplementation(async ({ ref }) => {
      if (ref === 'main') {
        throw new Error('remote: error: GH013: Repository rule violations found for refs/heads/main');
      }
    });

    await expect(
      runPipeline(
        { ...perPackageInput([update('lib', 'packages/lib/package.json')]), commitMessage: 'chore: release lib' },
        getDefaultConfig(),
        { ...options, skipGit: false },
      ),
    ).rejects.toMatchObject({ failedStage: 'git-push' });

    expect(publishedLabels()).toEqual(['npm publish lib@0.2.0']);
    expect(push.mock.calls.map(([opts]) => opts.ref)).toEqual(['main']);
  });
});
