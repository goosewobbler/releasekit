import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { VersionPackageUpdate } from '@releasekit/core';
import { createFakeForge } from '@releasekit/forge';
import { FakeGit } from '@releasekit/git';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStandingPRCommand } from '../../../src/commands/standing-pr-command.js';
import { forgeFor } from '../../../src/github.js';
import { serializeManifest } from '../../../src/standing-pr/standing-pr.js';
import { runNotesStep, runPublishStep } from '../../../src/steps.js';

let fakeGit: FakeGit;
vi.mock('@releasekit/git', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@releasekit/git')>()),
  createGitCli: () => fakeGit,
}));

vi.mock('../../../src/github.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/github.js')>()),
  forgeFor: vi.fn(),
}));

vi.mock('../../../src/steps.js', () => ({
  runVersionStep: vi.fn(),
  runNotesStep: vi.fn(),
  runPublishStep: vi.fn(),
}));

const PR = 7;

describe('standing-pr publish', () => {
  let dir: string;
  let output: string;

  beforeEach(() => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), 'rk-publish-')));
    output = join(dir, 'out.json');
    vi.stubEnv('GITHUB_REPOSITORY', 'owner/repo');
    vi.stubEnv('GITHUB_TOKEN', 'token');
    fakeGit = new FakeGit({ ancestors: () => true });
    vi.mocked(runNotesStep).mockResolvedValue({ packageNotes: {}, releaseNotes: {}, files: [] });
    vi.mocked(runPublishStep).mockResolvedValue({
      npm: [],
      cargo: [],
      pub: [],
      githubReleases: [],
      git: { committed: false, tags: [], pushed: true },
    } as unknown as Awaited<ReturnType<typeof runPublishStep>>);
    vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    rmSync(dir, { recursive: true, force: true });
  });

  function write(file: string, content: string) {
    mkdirSync(dirname(join(dir, file)), { recursive: true });
    writeFileSync(join(dir, file), content);
  }

  function writeConfig(npmVersioning: boolean) {
    write(
      'releasekit.config.json',
      JSON.stringify({
        version: { sync: true, npm: { enabled: npmVersioning } },
        ci: { standingPr: { deleteBranchOnMerge: false } },
      }),
    );
  }

  function update(packageName: string, files: string[], extra: Partial<VersionPackageUpdate> = {}) {
    const paths = files.map((file) => join(dir, file));
    return { packageName, newVersion: '1.1.0', filePath: paths[0], files: paths, ...extra };
  }

  async function publish(updates: VersionPackageUpdate[]): Promise<Record<string, unknown>> {
    const manifest = serializeManifest({
      schemaVersion: 2,
      versionOutput: { dryRun: false, strategy: 'sync', updates, changelogs: [], tags: ['v1.1.0'] },
      releaseNotes: {},
      notesFiles: [],
      createdAt: '2026-01-01T00:00:00.000Z',
      baseSha: 'a'.repeat(40),
    });
    vi.mocked(forgeFor).mockReturnValue(
      createFakeForge({
        comments: [{ id: 1, body: manifest }],
        pullRequests: { [PR]: { body: '', labels: [] } },
      }),
    );
    await createStandingPRCommand().parseAsync([
      'node',
      'standing-pr',
      'publish',
      '--pr',
      String(PR),
      '--json',
      '--output',
      output,
      '--project-dir',
      dir,
    ]);
    return JSON.parse(readFileSync(output, 'utf-8'));
  }

  it.each([
    { npm: 'off', files: ['Cargo.toml'], packageJsonVersion: '1.0.0' },
    { npm: 'on', files: ['package.json', 'Cargo.toml'], packageJsonVersion: '1.1.0' },
  ])('should publish a single-package hybrid with npm versioning $npm', async ({ npm, files, packageJsonVersion }) => {
    writeConfig(npm === 'on');
    write('package.json', JSON.stringify({ name: 'my-app', version: packageJsonVersion }));
    write('Cargo.toml', '[package]\nname = "my_crate"\nversion = "1.1.0"\n');
    const updates = [update('my-app', files, { isRoot: true })];

    const envelope = await publish(updates);

    expect(envelope).toMatchObject({ status: 'success' });
    expect(vi.mocked(runPublishStep).mock.calls[0]?.[0]).toMatchObject({ updates });
  });

  describe('in a monorepo whose hybrids have npm versioning off', () => {
    beforeEach(() => {
      writeConfig(false);
      write('package.json', JSON.stringify({ name: 'monorepo', version: '1.0.0', private: true }));
      write('pnpm-workspace.yaml', 'packages:\n  - "packages/*"\n');
      write('packages/core/package.json', JSON.stringify({ name: '@scope/core', version: '1.0.0' }));
      write('packages/core/Cargo.toml', '[package]\nname = "core"\nversion = "1.1.0"\n');
      write('packages/ui/package.json', JSON.stringify({ name: '@scope/ui', version: '1.0.0' }));
      write('packages/ui/pubspec.yaml', 'name: ui\nversion: 1.1.0\n');
    });

    it('should publish from the native manifests', async () => {
      const updates = [
        update('@scope/core', ['packages/core/Cargo.toml']),
        update('@scope/ui', ['packages/ui/pubspec.yaml']),
      ];

      const envelope = await publish(updates);

      expect(envelope).toMatchObject({ status: 'success' });
      expect(vi.mocked(runPublishStep).mock.calls[0]?.[0]).toMatchObject({ updates });
    });

    it("should refuse an update that vouches for its version with another package's manifest", async () => {
      write('packages/core/Cargo.toml', '[package]\nname = "core"\nversion = "1.0.0"\n');

      const envelope = await publish([update('@scope/core', ['packages/ui/pubspec.yaml'])]);

      expect(envelope).toMatchObject({ status: 'error' });
      expect(envelope.errors).toMatchObject([
        { message: expect.stringContaining("which is not in that package's directory") },
      ]);
      expect(runPublishStep).not.toHaveBeenCalled();
    });
  });
});
