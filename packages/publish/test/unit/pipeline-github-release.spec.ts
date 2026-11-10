import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { VersionOutput, VersionPackageChangelog, VersionPackageUpdate } from '@releasekit/core';
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

const { warnMock } = vi.hoisted(() => ({ warnMock: vi.fn() }));
vi.mock('@releasekit/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@releasekit/core')>()),
  warn: warnMock,
}));

let fakeGit: FakeGit;
vi.mock('@releasekit/git', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@releasekit/git')>()),
  createGitCli: () => fakeGit,
}));

// A standing-PR merge: the release commit is already on the remote, so publish pushes the tags and creates releases.
const options: PublishCliOptions = {
  registry: 'all',
  npmAuth: 'auto',
  dryRun: false,
  skipGit: false,
  skipGitCommit: true,
  skipPublish: false,
  skipGithubRelease: false,
  skipVerification: true,
  json: false,
  verbose: false,
};

const GENERATED = '--generate-notes';

const originalCwd = process.cwd();
let workspace: string;

function writePackage(name: string): string {
  const filePath = `packages/${name.replace(/^@[^/]+\//, '')}/package.json`;
  fs.mkdirSync(path.dirname(path.join(workspace, filePath)), { recursive: true });
  fs.writeFileSync(path.join(workspace, filePath), JSON.stringify({ name, version: '1.2.2' }));
  return filePath;
}

function update(packageName: string, tag?: string): VersionPackageUpdate {
  return { packageName, newVersion: '1.2.3', filePath: writePackage(packageName), ...(tag ? { tag } : {}) };
}

function changelog(packageName: string, description: string): VersionPackageChangelog {
  return {
    packageName,
    version: '1.2.3',
    previousVersion: '1.2.2',
    revisionRange: 'HEAD~1..HEAD',
    repoUrl: null,
    entries: [{ type: 'fixed', description }],
  };
}

function rootUpdate(): VersionPackageUpdate {
  fs.writeFileSync(path.join(workspace, 'package.json'), JSON.stringify({ name: 'root', private: true }));
  return { packageName: 'root', newVersion: '1.2.3', filePath: 'package.json', isRoot: true };
}

function syncInput(tag: string): VersionOutput {
  return {
    dryRun: false,
    strategy: 'sync',
    updates: [rootUpdate(), update('pkg-a'), update('pkg-b')],
    changelogs: [changelog('monorepo', 'Fix the sync release')],
    tags: [tag],
  };
}

function perPackageInput(tags: Record<string, string>): VersionOutput {
  const names = Object.keys(tags);
  return {
    dryRun: false,
    strategy: 'async',
    updates: names.map((name) => update(name, tags[name])),
    changelogs: names.map((name) => changelog(name, `Fix ${name}`)),
    tags: Object.values(tags),
  };
}

/** Each created release's `--notes` body, or `--generate-notes` when GitHub writes it. */
function releaseBodies(): Record<string, string | undefined> {
  const bodies: Record<string, string | undefined> = {};
  for (const [command, args] of vi.mocked(execCommand).mock.calls) {
    if (command !== 'gh' || args[1] !== 'create') {
      continue;
    }
    const notesIndex = args.indexOf('--notes');
    bodies[args[2] as string] = notesIndex === -1 ? args.find((arg) => arg === GENERATED) : args[notesIndex + 1];
  }
  return bodies;
}

function releaseTitles(): Record<string, string | undefined> {
  const titles: Record<string, string | undefined> = {};
  for (const [command, args] of vi.mocked(execCommand).mock.calls) {
    if (command === 'gh' && args[1] === 'create') {
      titles[args[2] as string] = args[args.indexOf('--title') + 1];
    }
  }
  return titles;
}

function warningsNaming(tag: string): string[] {
  return warnMock.mock.calls.map(([message]) => String(message)).filter((message) => message.includes(tag));
}

describe('GitHub release bodies in the publish pipeline', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(execCommand).mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 });
    // Nothing is published yet, and no GitHub release exists.
    vi.mocked(execCommandSafe).mockResolvedValue({ stdout: '', stderr: '', exitCode: 1 });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 404 } as Response));
    fakeGit = createFakeGit({ currentBranch: 'main' });
    workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'releasekit-github-release-'));
    process.chdir(workspace);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    vi.unstubAllGlobals();
    fs.rmSync(workspace, { recursive: true, force: true });
  });

  it.each(['release-1.2.3', 'app-v1.2.3', '1.2.3', 'v1.2.3'])(
    'should give a sync release tagged %s the sole release notes',
    async (tag) => {
      await runPipeline(syncInput(tag), getDefaultConfig(), { ...options, releaseNotes: { monorepo: 'X' } });

      expect(releaseBodies()).toEqual({ [tag]: 'X' });
      expect(warnMock).not.toHaveBeenCalled();
    },
  );

  it.each(['release-1.2.3', 'app-v1.2.3'])('should give a sync release tagged %s the sole changelog', async (tag) => {
    const config = getDefaultConfig();
    config.githubRelease.body = 'changelog';

    await runPipeline(syncInput(tag), config, options);

    expect(releaseBodies()).toEqual({ [tag]: '- Fix the sync release' });
  });

  it('should give a v-tagged release the sole release notes when the input predates strategy', async () => {
    const { strategy: _, ...input } = syncInput('v1.2.3');

    await runPipeline(input, getDefaultConfig(), { ...options, releaseNotes: { monorepo: 'X' } });

    expect(releaseBodies()).toEqual({ 'v1.2.3': 'X' });
  });

  it.each(['release-1.2.3', 'app-v1.2.3'])(
    'should give a sync release tagged %s the sole release notes when the input predates strategy',
    async (tag) => {
      const { strategy: _, ...input } = syncInput(tag);

      await runPipeline(input, getDefaultConfig(), { ...options, releaseNotes: { monorepo: 'X' } });

      expect(releaseBodies()).toEqual({ [tag]: 'X' });
    },
  );

  it('should give a tag shared by several packages the sole release notes', async () => {
    const input: VersionOutput = {
      dryRun: false,
      strategy: 'async',
      updates: [update('pkg-a', 'release-1.2.3'), update('pkg-b', 'release-1.2.3')],
      changelogs: [],
      tags: ['release-1.2.3'],
    };

    await runPipeline(input, getDefaultConfig(), { ...options, releaseNotes: { monorepo: 'X' } });

    expect(releaseBodies()).toEqual({ 'release-1.2.3': 'X' });
  });

  it("should not give a shared tag the sole release notes when they're another tag's package's", async () => {
    const input: VersionOutput = {
      dryRun: false,
      strategy: 'async',
      updates: [
        update('pkg-a', 'release-1.2.3'),
        update('pkg-b', 'release-1.2.3'),
        { ...update('pkg-c', 'release-2.0.0'), newVersion: '2.0.0' },
      ],
      changelogs: [],
      tags: ['release-1.2.3', 'release-2.0.0'],
    };

    await runPipeline(input, getDefaultConfig(), { ...options, releaseNotes: { 'pkg-c': 'C' } });

    expect(releaseBodies()).toEqual({ 'release-1.2.3': GENERATED, 'release-2.0.0': 'C' });
  });

  it("should not give a package's tag the sole release notes when they're keyed under a package not releasing", async () => {
    const input = perPackageInput({ 'pkg-a': 'pkg-a-v1.2.3' });

    await runPipeline(input, getDefaultConfig(), { ...options, releaseNotes: { 'pkg-b': 'B' } });

    expect(releaseBodies()).toEqual({ 'pkg-a-v1.2.3': GENERATED });
  });

  it("should not give a package's notes to a longer-named package with empty notes", async () => {
    const input = perPackageInput({ pkg: 'pkg-v1.2.3', 'pkg-2': 'pkg-2-v1.2.3' });

    await runPipeline(input, getDefaultConfig(), { ...options, releaseNotes: { pkg: 'P', 'pkg-2': '' } });

    expect(releaseBodies()).toEqual({ 'pkg-v1.2.3': 'P', 'pkg-2-v1.2.3': GENERATED });
  });

  it("should match per-package tags from a custom template to each package's own notes", async () => {
    const input = perPackageInput({ 'pkg-a': 'pkg-a/1.2.3', 'pkg-b': 'pkg-b/1.2.3' });

    await runPipeline(input, getDefaultConfig(), { ...options, releaseNotes: { 'pkg-a': 'A', 'pkg-b': 'B' } });

    expect(releaseBodies()).toEqual({ 'pkg-a/1.2.3': 'A', 'pkg-b/1.2.3': 'B' });
    expect(warnMock).not.toHaveBeenCalled();
  });

  it("should match per-package tags from a custom template to each package's own changelog", async () => {
    const config = getDefaultConfig();
    config.githubRelease.body = 'changelog';

    await runPipeline(perPackageInput({ 'pkg-a': 'pkg-a/1.2.3', 'pkg-b': 'pkg-b/1.2.3' }), config, options);

    expect(releaseBodies()).toEqual({ 'pkg-a/1.2.3': '- Fix pkg-a', 'pkg-b/1.2.3': '- Fix pkg-b' });
  });

  it("should match scoped name@v tags to each package's own notes", async () => {
    const input = perPackageInput({ '@scope/pkg-a': '@scope/pkg-a@v1.2.3', '@scope/pkg-b': '@scope/pkg-b@v1.2.3' });

    await runPipeline(input, getDefaultConfig(), {
      ...options,
      releaseNotes: { '@scope/pkg-a': 'A', '@scope/pkg-b': 'B' },
    });

    expect(releaseBodies()).toEqual({ '@scope/pkg-a@v1.2.3': 'A', '@scope/pkg-b@v1.2.3': 'B' });
  });

  it("should not give a package's notes to another package's version-only tag", async () => {
    const input: VersionOutput = {
      dryRun: false,
      strategy: 'async',
      updates: [update('pkg-a', 'v1.2.3'), { ...update('pkg-b', 'v2.0.0'), newVersion: '2.0.0' }],
      changelogs: [],
      tags: ['v1.2.3', 'v2.0.0'],
    };

    await runPipeline(input, getDefaultConfig(), { ...options, releaseNotes: { 'pkg-a': 'A' } });

    expect(releaseBodies()).toEqual({ 'v1.2.3': 'A', 'v2.0.0': GENERATED });
  });

  it.each(['auto', 'releaseNotes'] as const)(
    'should warn naming only the tag no notes match when body is %s',
    async (body) => {
      const config = getDefaultConfig();
      config.githubRelease.body = body;
      const input = perPackageInput({ 'pkg-a': 'pkg-a/1.2.3', 'pkg-b': 'pkg-b/1.2.3' });

      await runPipeline(input, config, { ...options, releaseNotes: { 'pkg-a': 'A' } });

      expect(releaseBodies()).toEqual({ 'pkg-a/1.2.3': 'A', 'pkg-b/1.2.3': GENERATED });
      expect(warningsNaming('pkg-b/1.2.3')).not.toEqual([]);
      expect(warningsNaming('pkg-a/1.2.3')).toEqual([]);
    },
  );

  it('should warn naming only the tag no changelog matches when body is changelog', async () => {
    const config = getDefaultConfig();
    config.githubRelease.body = 'changelog';
    const input = perPackageInput({ 'pkg-a': 'pkg-a/1.2.3', 'pkg-b': 'pkg-b/1.2.3' });
    input.changelogs = input.changelogs.filter((c) => c.packageName === 'pkg-a');

    await runPipeline(input, config, options);

    expect(releaseBodies()).toEqual({ 'pkg-a/1.2.3': '- Fix pkg-a', 'pkg-b/1.2.3': GENERATED });
    expect(warningsNaming('pkg-b/1.2.3')).not.toEqual([]);
    expect(warningsNaming('pkg-a/1.2.3')).toEqual([]);
  });

  it('should skip the release for a package in skipPackages whose tag comes from a custom template', async () => {
    const config = getDefaultConfig();
    config.githubRelease.skipPackages = ['pkg-a'];

    await runPipeline(perPackageInput({ 'pkg-a': 'pkg-a/1.2.3', 'pkg-b': 'pkg-b/1.2.3' }), config, options);

    expect(Object.keys(releaseBodies())).toEqual(['pkg-b/1.2.3']);
  });

  it("should not skip a package whose name starts with a skipped package's name", async () => {
    const config = getDefaultConfig();
    config.githubRelease.skipPackages = ['pkg'];

    await runPipeline(perPackageInput({ pkg: 'pkg-v1.2.3', 'pkg-2': 'pkg-2-v1.2.3' }), config, options);

    expect(Object.keys(releaseBodies())).toEqual(['pkg-2-v1.2.3']);
  });

  it('should skip the release for a package listed under the name its tag uses', async () => {
    const config = getDefaultConfig();
    config.githubRelease.skipPackages = ['scope-pkg-a'];

    await runPipeline(
      perPackageInput({ '@scope/pkg-a': 'scope-pkg-a@v1.2.3', 'pkg-b': 'pkg-b@v1.2.3' }),
      config,
      options,
    );

    expect(Object.keys(releaseBodies())).toEqual(['pkg-b@v1.2.3']);
  });

  it.each([
    [['pkg-a', 'pkg-b'], []],
    [['pkg-a'], ['release-1.2.3']],
  ])('should skip a tag shared by several packages only when all are in skipPackages %j', async (skip, released) => {
    const config = getDefaultConfig();
    config.githubRelease.skipPackages = skip;
    const input: VersionOutput = {
      dryRun: false,
      strategy: 'async',
      updates: [update('pkg-a', 'release-1.2.3'), update('pkg-b', 'release-1.2.3')],
      changelogs: [],
      tags: ['release-1.2.3'],
    };

    await runPipeline(input, config, options);

    expect(Object.keys(releaseBodies())).toEqual(released);
  });

  it.each([
    [['pkg-a', 'pkg-b'], []],
    [['pkg-a'], ['v1.2.3']],
  ])('should skip a sync release only when all its packages are in skipPackages %j', async (skip, released) => {
    const config = getDefaultConfig();
    config.githubRelease.skipPackages = skip;

    await runPipeline(syncInput('v1.2.3'), config, options);

    expect(Object.keys(releaseBodies())).toEqual(released);
  });

  it('should skip a single-package sync release when its package is in skipPackages', async () => {
    const config = getDefaultConfig();
    config.githubRelease.skipPackages = ['root'];
    const input: VersionOutput = { ...syncInput('v1.2.3'), updates: [rootUpdate()] };

    await runPipeline(input, config, options);

    expect(releaseBodies()).toEqual({});
  });

  it("should not give another package's notes to a per-package tag when updates don't carry tags", async () => {
    const input = perPackageInput({ 'pkg-a': 'pkg-a/1.2.3', 'pkg-b': 'pkg-b/1.2.3' });
    input.updates = input.updates.map(({ tag: _, ...u }) => u);

    await runPipeline(input, getDefaultConfig(), { ...options, releaseNotes: { 'pkg-a': 'A' } });

    expect(releaseBodies()['pkg-b/1.2.3']).toBe(GENERATED);
  });

  it("should title a release with its package's name and version", async () => {
    const input = perPackageInput({
      'pkg-a': 'pkg-a/1.2.3',
      '@scope/pkg-b': '@scope/pkg-b@v1.2.3',
      'pkg-c': 'pkg-c-dev1.2.3',
    });

    await runPipeline(input, getDefaultConfig(), options);

    expect(releaseTitles()).toEqual({
      'pkg-a/1.2.3': 'pkg-a: 1.2.3',
      '@scope/pkg-b@v1.2.3': '@scope/pkg-b: v1.2.3',
      'pkg-c-dev1.2.3': 'pkg-c: 1.2.3',
    });
  });

  it.each([
    ['pkg-a', 'v1.2.3'],
    ['pkg-a', 'release-1.2.3'],
    ['app', 'myapp-1.2.3'],
  ])("should title %s's release with its tag %s, which doesn't start with the package name", async (name, tag) => {
    const input: VersionOutput = {
      dryRun: false,
      strategy: 'single',
      updates: [update(name, tag)],
      changelogs: [],
      tags: [tag],
    };

    await runPipeline(input, getDefaultConfig(), options);

    expect(releaseTitles()).toEqual({ [tag]: tag });
  });
});
