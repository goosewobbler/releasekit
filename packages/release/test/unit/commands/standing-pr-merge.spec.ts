import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EXIT_CODES } from '@releasekit/core';
import { createFakeForge, type FakeForgeSeed } from '@releasekit/forge';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStandingPRCommand } from '../../../src/commands/standing-pr-command.js';
import { forgeFor } from '../../../src/github.js';
import { type StandingPRManifest, serializeManifest } from '../../../src/standing-pr/standing-pr.js';

vi.mock('../../../src/github.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/github.js')>()),
  forgeFor: vi.fn(),
}));

const HEAD = 'a'.repeat(40);
const MOVED_HEAD = 'b'.repeat(40);

const manifest: StandingPRManifest = {
  schemaVersion: 2,
  versionOutput: { dryRun: false, updates: [], changelogs: [], tags: [] },
  releaseNotes: {},
  notesFiles: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  baseSha: 'c'.repeat(40),
  headSha: HEAD,
  overrideLabels: [],
};

const standingPR = { number: 42, url: 'https://github.com/owner/repo/pull/42', labels: [] };

describe('standing-pr merge', () => {
  let dir: string;
  let output: string;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'rk-merge-'));
    output = join(dir, 'out.json');
    writeFileSync(join(dir, 'releasekit.config.json'), JSON.stringify({}));
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.stubEnv('GITHUB_REPOSITORY', 'owner/repo');
    vi.stubEnv('GITHUB_TOKEN', 'token');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    rmSync(dir, { recursive: true, force: true });
  });

  function seedForge(seed: FakeForgeSeed) {
    const forge = createFakeForge({
      standingPR,
      pullRequests: { 42: { body: '', labels: [], headSha: HEAD } },
      ...seed,
    });
    vi.mocked(forgeFor).mockReturnValue(forge);
    return forge;
  }

  async function merge(): Promise<Record<string, unknown>> {
    await createStandingPRCommand().parseAsync([
      'node',
      'standing-pr',
      'merge',
      '--json',
      '--output',
      output,
      '--project-dir',
      dir,
    ]);
    return JSON.parse(readFileSync(output, 'utf-8'));
  }

  it('should merge at the head the manifest describes and report it as changed', async () => {
    const forge = seedForge({ comments: [{ id: 1, body: serializeManifest(manifest) }] });

    const envelope = await merge();

    expect(envelope).toMatchObject({ status: 'success', changed: true, data: { merged: true, prNumber: 42 } });
    expect(forge.mergedPullRequests).toEqual([{ prNumber: 42, method: 'merge', sha: HEAD }]);
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("should merge at the PR's head when the manifest predates headSha", async () => {
    const forge = seedForge({ comments: [{ id: 1, body: serializeManifest({ ...manifest, headSha: undefined }) }] });

    await merge();

    expect(forge.mergedPullRequests).toEqual([{ prNumber: 42, method: 'merge', sha: HEAD }]);
  });

  it.each<[string, FakeForgeSeed, RegExp]>([
    ['the manifest is missing', { comments: [] }, /Release manifest not found on PR #42/],
    [
      'a human wrote the manifest',
      { comments: [{ id: 1, body: serializeManifest(manifest), user: { login: 'mallory', type: 'User' } }] },
      /Refusing to merge PR #42: .*'mallory', not the release bot/,
    ],
    [
      'the manifest is invalid',
      { comments: [{ id: 1, body: serializeManifest({ ...manifest, baseSha: undefined as unknown as string }) }] },
      /Release manifest on PR #42 is invalid/,
    ],
    [
      'an update moved the release branch after the manifest was written',
      {
        comments: [{ id: 1, body: serializeManifest(manifest) }],
        pullRequests: { 42: { body: '', labels: [], headSha: MOVED_HEAD } },
      },
      /'release\/next' has moved since the release manifest was written/,
    ],
    [
      'the override labels changed since the manifest was written',
      {
        comments: [{ id: 1, body: serializeManifest(manifest) }],
        pullRequests: { 42: { body: '', labels: ['bump:major'], headSha: HEAD } },
      },
      /override labels changed after the last update[\s\S]*Refusing to merge/,
    ],
  ])('should refuse to merge when %s', async (_case, seed, message) => {
    const forge = seedForge(seed);

    const envelope = await merge();

    expect(envelope).toMatchObject({
      status: 'error',
      changed: false,
      errors: [{ message: expect.stringMatching(message) }],
    });
    expect(forge.mergedPullRequests).toEqual([]);
    expect(exitSpy).toHaveBeenCalled();
  });

  it('should fail with a GitHub error envelope when there is no GitHub context', async () => {
    vi.stubEnv('GITHUB_REPOSITORY', '');
    vi.stubEnv('GITHUB_TOKEN', '');

    const envelope = await merge();

    expect(envelope).toMatchObject({ status: 'error', changed: false });
    expect(envelope.errors).toMatchObject([
      { code: 'GITHUB_ERROR', category: 'github', message: expect.stringMatching(/No GitHub context/) },
    ]);
    expect(exitSpy).toHaveBeenCalledWith(EXIT_CODES.GITHUB_ERROR);
  });
});
