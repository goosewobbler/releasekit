import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
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
  getWorkspacePackageNames: vi.fn().mockResolvedValue([]),
  getWorkspacePackageVersions: vi.fn().mockResolvedValue({}),
}));

vi.mock('../../src/steps.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/steps.js')>();
  return { ...actual, runVersionStep: vi.fn(), runNotesStep: vi.fn(actual.runNotesStep) };
});

vi.mock('../../src/github.js', () => ({
  forgeFor: vi.fn(),
}));

vi.mock('../../src/preview/refresh.js', () => ({
  refreshFeederPreviews: vi.fn(),
  runRefreshAfterRelease: vi.fn(),
}));

const versionOutput = {
  dryRun: false,
  updates: [{ packageName: '@scope/core', newVersion: '1.2.3', filePath: 'packages/core/package.json' }],
  changelogs: [
    {
      packageName: '@scope/core',
      version: '1.2.3',
      previousVersion: '1.2.2',
      revisionRange: '@scope/core@v1.2.2..HEAD',
      repoUrl: null,
      entries: [
        { type: 'added', description: 'Add streaming support' },
        { type: 'fixed', description: 'Fix null pointer' },
      ],
    },
  ],
  tags: ['@scope/core@v1.2.3'],
  commitMessage: 'chore: release @scope/core',
  sharedEntries: [],
};

// The notes package is consumed built, so the LLM is stubbed at the Ollama endpoint rather than the provider.
function stubCategorizeLLM() {
  const content = JSON.stringify({
    entries: [
      { category: 'New', scope: null },
      { category: 'Fixed', scope: null },
    ],
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(`${JSON.stringify({ message: { content }, done: true })}\n`, { status: 200 })),
  );
}

describe('runStandingPRUpdate: CHANGELOG.md across preview-notes updates', () => {
  const originalEnv = { ...process.env };
  let projectDir: string;
  let changelogPath: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    process.env.GITHUB_REPOSITORY = 'owner/repo';
    process.env.GITHUB_TOKEN = 'test-token';
    delete process.env.GITHUB_EVENT_NAME;
    delete process.env.GITHUB_EVENT_PATH;

    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rk-standing-changelog-'));
    changelogPath = path.join(projectDir, 'CHANGELOG.md');
    fs.writeFileSync(
      path.join(projectDir, 'releasekit.config.json'),
      JSON.stringify({
        git: { branch: 'main' },
        notes: {
          changelog: { mode: 'root', file: changelogPath },
          releaseNotes: {
            llm: {
              provider: 'ollama',
              model: 'stub-model',
              baseURL: 'http://llm.invalid',
              apiKey: 'stub',
              tasks: { categorize: true },
            },
          },
        },
        ci: { releaseStrategy: 'standing-pr', standingPr: { branch: 'release/next' } },
      }),
    );

    fakeGit = new FakeGit({ headSha: 'abc123', commits: { '*': 'feat: add streaming' }, ancestors: () => true });
    stubCategorizeLLM();

    const { runVersionStep } = await import('../../src/steps.js');
    vi.mocked(runVersionStep).mockResolvedValue(versionOutput as unknown as Awaited<ReturnType<typeof runVersionStep>>);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fs.rmSync(projectDir, { recursive: true, force: true });
    process.env = { ...originalEnv };
  });

  async function update(body: string): Promise<FakeForge> {
    const { forgeFor } = await import('../../src/github.js');
    const forge = createFakeForge({
      standingPR: {
        number: 99,
        url: 'https://github.com/owner/repo/pull/99',
        labels: ['release', 'release:preview-notes'],
      },
      pullRequests: { 99: { body, labels: [] } },
    });
    vi.mocked(forgeFor).mockReturnValue(forge);
    await runStandingPRUpdate({ projectDir, verbose: false, quiet: false, json: false });
    return forge;
  }

  it('should write the same categorized changelog once the notes region exists', async () => {
    const { runNotesStep } = await import('../../src/steps.js');

    const first = await update('');
    const seeded = fs.readFileSync(changelogPath, 'utf-8');
    // The LLM's `New` rather than the commit type's `Added`.
    expect(seeded).toContain('### New\n- Add streaming support');
    expect(seeded).not.toContain('### Added');

    // Each update resets the release branch to base, which drops the previous CHANGELOG.md write.
    fs.rmSync(changelogPath);
    const bodyWithRegion = first.updatedPullRequests.at(-1)?.changes.body as string;
    expect(bodyWithRegion).toContain('<!-- releasekit-notes:@scope/core -->');
    await update(bodyWithRegion);

    expect(vi.mocked(runNotesStep).mock.calls.at(-1)?.[1]).toMatchObject({ skipReleaseNotes: true });
    expect(fs.readFileSync(changelogPath, 'utf-8')).toBe(seeded);
  });
});
