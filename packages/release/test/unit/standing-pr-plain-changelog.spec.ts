import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { VersionOutput } from '@releasekit/core';
import { createFakeForge, type FakeForge } from '@releasekit/forge';
import { FakeGit } from '@releasekit/git';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runStandingPRUpdate } from '../../src/standing-pr/standing-pr.js';

let fakeGit: FakeGit;
vi.mock('@releasekit/git', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@releasekit/git')>();
  return { ...actual, createGitCli: () => fakeGit };
});

vi.mock('@releasekit/version', () => ({
  getWorkspacePackageNames: async () => [],
  getWorkspacePackageVersions: async () => ({}),
}));

vi.mock('../../src/steps.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/steps.js')>();
  return { ...actual, runVersionStep: vi.fn() };
});

vi.mock('../../src/github.js', () => ({ forgeFor: vi.fn() }));

vi.mock('../../src/preview/stale.js', () => ({ markFeederPreviewsStale: vi.fn() }));

const versionOutput: VersionOutput = {
  dryRun: false,
  updates: [{ packageName: 'my-lib', newVersion: '2.0.0', filePath: 'package.json' }],
  changelogs: [
    {
      packageName: 'my-lib',
      version: '2.0.0',
      previousVersion: '1.0.0',
      revisionRange: 'v1.0.0..HEAD',
      repoUrl: null,
      entries: [
        { type: 'added', description: 'Add streaming support' },
        { type: 'fixed', description: 'Fix null pointer' },
      ],
    },
  ],
  tags: ['v2.0.0'],
};

const CATEGORIZED = JSON.stringify({
  entries: [
    { index: 0, category: 'New', scope: null },
    { index: 1, category: 'New', scope: null },
  ],
});

const PREVIEW_NOTES = 'release:preview-notes';
const LLM_URL = 'http://llm.test';

// Runs the real notes pipeline, whose first import can exceed the 5s default under a full turbo run.
describe('runStandingPRUpdate: CHANGELOG.md', { timeout: 15_000 }, () => {
  const dirs: string[] = [];
  const fetchStub = vi.fn(
    async (_url: string | URL | Request) =>
      new Response(`${JSON.stringify({ message: { content: CATEGORIZED }, done: true })}\n`),
  );
  const llmCalls = () => fetchStub.mock.calls.filter(([url]) => String(url).startsWith(`${LLM_URL}/`));

  beforeEach(async () => {
    vi.stubEnv('GITHUB_REPOSITORY', 'owner/repo');
    vi.stubEnv('GITHUB_TOKEN', 'test-token');
    vi.stubEnv('GITHUB_EVENT_NAME', 'push');
    vi.stubGlobal('fetch', fetchStub);
    fetchStub.mockClear();
    const { runVersionStep } = await import('../../src/steps.js');
    vi.mocked(runVersionStep).mockImplementation(async () => structuredClone(versionOutput));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    for (const dir of dirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  /** Each update starts from a fresh checkout of the base branch, so each gets its own project dir. */
  async function update(pr: { labels: string[]; body: string }): Promise<{ changelog: string; forge: FakeForge }> {
    const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'releasekit-standing-pr-changelog-'));
    dirs.push(projectDir);
    fs.writeFileSync(
      path.join(projectDir, 'releasekit.config.json'),
      JSON.stringify({
        ci: { releaseStrategy: 'standing-pr' },
        version: { sync: false },
        notes: {
          changelog: { mode: 'root' },
          releaseNotes: {
            llm: { provider: 'ollama', model: 'test', baseURL: LLM_URL, tasks: { categorize: true } },
          },
        },
      }),
    );
    // The notes pipeline writes CHANGELOG.md relative to the working directory.
    process.chdir(projectDir);
    fakeGit = new FakeGit({ headSha: 'abc123', ancestors: () => true });
    const forge = createFakeForge({
      standingPR: { number: 99, url: 'https://github.com/owner/repo/pull/99', labels: pr.labels },
      pullRequests: { 99: { body: pr.body, labels: [] } },
    });
    const { forgeFor } = await import('../../src/github.js');
    vi.mocked(forgeFor).mockReturnValue(forge);

    await runStandingPRUpdate({ projectDir, verbose: false, quiet: true, json: false });

    return { changelog: fs.readFileSync(path.join(projectDir, 'CHANGELOG.md'), 'utf-8'), forge };
  }

  it('should write the same plain changelog on the preview-notes seeding update and a later update', async () => {
    const seeding = await update({ labels: ['release', PREVIEW_NOTES], body: '' });
    expect(llmCalls().length).toBeGreaterThan(0);
    const seededBody = seeding.forge.updatedPullRequests.at(-1)?.changes.body as string;
    expect(seededBody).toContain('### New\n\n- Add streaming support\n- Fix null pointer');

    fetchStub.mockClear();
    const later = await update({ labels: ['release', PREVIEW_NOTES], body: seededBody });
    expect(llmCalls()).toHaveLength(0);

    expect(seeding.changelog).toContain('### Added\n\n- Add streaming support');
    expect(seeding.changelog).not.toContain('### New');
    expect(later.changelog).toBe(seeding.changelog);
  });

  it('should make no LLM call without the preview-notes label', async () => {
    const { changelog } = await update({ labels: ['release'], body: '' });

    expect(llmCalls()).toHaveLength(0);
    expect(changelog).toContain('### Fixed\n\n- Fix null pointer');
  });
});
