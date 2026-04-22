import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StandingPRManifest } from '../../src/standing-pr.js';
import { parseManifest, runStandingPRPublish, runStandingPRUpdate, serializeManifest } from '../../src/standing-pr.js';

vi.mock('node:child_process', () => ({
  execSync: vi.fn().mockReturnValue(''),
}));

vi.mock('node:fs', () => ({
  default: {
    readFileSync: vi.fn(),
  },
  readFileSync: vi.fn(),
}));

vi.mock('@releasekit/config', () => ({
  loadCIConfig: vi.fn(),
  loadConfig: vi.fn().mockReturnValue({
    ci: { standingPr: { branch: 'release/next', deleteBranchOnMerge: true } },
    git: { branch: 'main' },
    release: { ci: { skipPatterns: ['chore: release '] } },
  }),
}));

vi.mock('../../src/steps.js', () => ({
  runVersionStep: vi.fn(),
  runNotesStep: vi.fn(),
  runPublishStep: vi.fn(),
}));

vi.mock('../../src/preview-github.js', () => ({
  createOctokit: vi.fn(),
}));

function createMockVersionOutput(updates: { packageName: string; newVersion: string }[] = []) {
  return {
    dryRun: false,
    updates: updates.map((u) => ({ ...u, filePath: `packages/${u.packageName}/package.json` })),
    changelogs: [],
    tags: updates.map((u) => `${u.packageName}@v${u.newVersion}`),
    commitMessage: `chore: release ${updates.map((u) => u.packageName).join(', ')}`,
    sharedEntries: [],
  };
}

function createMockOctokit(overrides: Record<string, unknown> = {}) {
  const createComment = vi.fn().mockResolvedValue({});
  const updateComment = vi.fn().mockResolvedValue({});
  const pullsList = vi.fn().mockResolvedValue({ data: [] });
  const pullsCreate = vi
    .fn()
    .mockResolvedValue({ data: { number: 42, html_url: 'https://github.com/owner/repo/pull/42' } });
  const pullsUpdate = vi.fn().mockResolvedValue({});
  const issuesSetLabels = vi.fn().mockResolvedValue({});

  const paginate = {
    iterator: vi.fn().mockReturnValue({
      async *[Symbol.asyncIterator]() {
        yield { data: [] };
      },
    }),
  };

  return {
    octokit: {
      paginate,
      rest: {
        issues: {
          listComments: vi.fn(),
          createComment,
          updateComment,
          setLabels: issuesSetLabels,
        },
        pulls: {
          list: pullsList,
          create: pullsCreate,
          update: pullsUpdate,
        },
      },
      ...overrides,
    },
    mocks: { createComment, updateComment, pullsList, pullsCreate, pullsUpdate, issuesSetLabels, paginate },
  };
}

const baseManifest: StandingPRManifest = {
  schemaVersion: 1,
  versionOutput: createMockVersionOutput([{ packageName: '@scope/core', newVersion: '1.2.3' }]),
  releaseNotes: { '@scope/core': '- added new feature' },
  notesFiles: ['packages/core/CHANGELOG.md'],
  createdAt: '2024-01-01T00:00:00.000Z',
  baseSha: 'abc123',
};

describe('serializeManifest / parseManifest', () => {
  it('should round-trip a manifest through serialize/parse', () => {
    const serialized = serializeManifest(baseManifest);
    expect(serialized).toContain('<!-- releasekit-manifest -->');
    expect(serialized).toContain('<!-- json ');

    const parsed = parseManifest(serialized);
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.versionOutput.updates).toHaveLength(1);
    expect(parsed.releaseNotes['@scope/core']).toBe('- added new feature');
    expect(parsed.baseSha).toBe('abc123');
  });

  it('should throw when manifest comment is missing', () => {
    expect(() => parseManifest('No marker here')).toThrow(/not found or malformed/);
  });

  it('should throw when manifest JSON is malformed', () => {
    const bad = '<!-- releasekit-manifest -->\n<!-- json {invalid} -->';
    expect(() => parseManifest(bad)).toThrow(/malformed/);
  });

  it('should throw when schemaVersion is incompatible', () => {
    const wrongVersion = serializeManifest({ ...baseManifest, schemaVersion: 99 as unknown as 1 });
    expect(() => parseManifest(wrongVersion)).toThrow(/incompatible/);
  });
});

describe('runStandingPRUpdate', () => {
  const originalEnv = { ...process.env };

  const defaultConfig = {
    ci: {
      standingPr: {
        branch: 'release/next',
        labels: ['release'],
        deleteBranchOnMerge: true,
        mergeMethod: 'squash',
        title: 'chore: release ${count} package(s)',
      },
      releaseStrategy: 'standing-pr',
      releaseTrigger: 'label',
      prPreview: true,
      autoRelease: false,
      skipPatterns: ['chore: release '],
      minChanges: 1,
      labels: {
        stable: 'release:stable',
        prerelease: 'release:prerelease',
        skip: 'release:skip',
        major: 'bump:major',
        minor: 'bump:minor',
        patch: 'bump:patch',
      },
    },
    git: { branch: 'main', remote: 'origin', pushMethod: 'auto' },
    release: { ci: { skipPatterns: ['chore: release '] } },
  };

  beforeEach(async () => {
    vi.resetAllMocks();
    process.env.GITHUB_REPOSITORY = 'owner/repo';
    process.env.GITHUB_TOKEN = 'test-token';

    const { loadConfig } = await import('@releasekit/config');
    vi.mocked(loadConfig).mockReturnValue(defaultConfig as ReturnType<typeof loadConfig>);

    const { execSync } = await import('node:child_process');
    vi.mocked(execSync).mockReturnValue('abc123\n' as unknown as Buffer);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('should return noop when HEAD commit matches skip pattern', async () => {
    const { execSync } = await import('node:child_process');
    vi.mocked(execSync).mockReturnValueOnce('chore: release @scope/core v1.2.3' as unknown as Buffer);

    const result = await runStandingPRUpdate({
      projectDir: '/test',
      verbose: false,
      quiet: false,
      json: false,
    });

    expect(result.action).toBe('noop');
  });

  it('should return noop when no releasable changes found and no existing PR', async () => {
    const { runVersionStep } = await import('../../src/steps.js');
    vi.mocked(runVersionStep).mockResolvedValue(
      createMockVersionOutput([]) as unknown as Awaited<ReturnType<typeof runVersionStep>>,
    );

    const { createOctokit } = await import('../../src/preview-github.js');
    const { mocks, octokit } = createMockOctokit();
    mocks.pullsList.mockResolvedValue({ data: [] });
    vi.mocked(createOctokit).mockReturnValue(octokit as unknown as ReturnType<typeof createOctokit>);

    const result = await runStandingPRUpdate({
      projectDir: '/test',
      verbose: false,
      quiet: false,
      json: false,
    });

    expect(result.action).toBe('noop');
  });

  it('should close existing PR when no releasable changes', async () => {
    const { runVersionStep } = await import('../../src/steps.js');
    vi.mocked(runVersionStep).mockResolvedValue(
      createMockVersionOutput([]) as unknown as Awaited<ReturnType<typeof runVersionStep>>,
    );

    const { createOctokit } = await import('../../src/preview-github.js');
    const { mocks, octokit } = createMockOctokit();
    mocks.pullsList.mockResolvedValue({ data: [{ number: 10, html_url: 'https://github.com/owner/repo/pull/10' }] });
    vi.mocked(createOctokit).mockReturnValue(octokit as unknown as ReturnType<typeof createOctokit>);

    const result = await runStandingPRUpdate({
      projectDir: '/test',
      verbose: false,
      quiet: false,
      json: false,
    });

    expect(result.action).toBe('closed');
    expect(result.prNumber).toBe(10);
    expect(mocks.pullsUpdate).toHaveBeenCalledWith(expect.objectContaining({ state: 'closed', pull_number: 10 }));
  });

  it('should create a new PR when no existing standing PR', async () => {
    const { runVersionStep, runNotesStep } = await import('../../src/steps.js');
    const versionOutput = createMockVersionOutput([{ packageName: '@scope/core', newVersion: '1.2.3' }]);
    vi.mocked(runVersionStep)
      .mockResolvedValueOnce(versionOutput as unknown as Awaited<ReturnType<typeof runVersionStep>>)
      .mockResolvedValueOnce(versionOutput as unknown as Awaited<ReturnType<typeof runVersionStep>>);
    vi.mocked(runNotesStep).mockResolvedValue({ packageNotes: {}, releaseNotes: {}, files: [] });

    const { createOctokit } = await import('../../src/preview-github.js');
    const { mocks, octokit } = createMockOctokit();
    mocks.pullsList.mockResolvedValue({ data: [] });
    vi.mocked(createOctokit).mockReturnValue(octokit as unknown as ReturnType<typeof createOctokit>);

    const result = await runStandingPRUpdate({
      projectDir: '/test',
      verbose: false,
      quiet: false,
      json: false,
    });

    expect(result.action).toBe('created');
    expect(result.prNumber).toBe(42);
    expect(mocks.pullsCreate).toHaveBeenCalled();
  });

  it('should update existing PR when standing PR already exists', async () => {
    const { runVersionStep, runNotesStep } = await import('../../src/steps.js');
    const versionOutput = createMockVersionOutput([{ packageName: '@scope/core', newVersion: '1.2.3' }]);
    vi.mocked(runVersionStep)
      .mockResolvedValueOnce(versionOutput as unknown as Awaited<ReturnType<typeof runVersionStep>>)
      .mockResolvedValueOnce(versionOutput as unknown as Awaited<ReturnType<typeof runVersionStep>>);
    vi.mocked(runNotesStep).mockResolvedValue({ packageNotes: {}, releaseNotes: {}, files: [] });

    const { createOctokit } = await import('../../src/preview-github.js');
    const { mocks, octokit } = createMockOctokit();
    mocks.pullsList.mockResolvedValue({ data: [{ number: 99, html_url: 'https://github.com/owner/repo/pull/99' }] });
    vi.mocked(createOctokit).mockReturnValue(octokit as unknown as ReturnType<typeof createOctokit>);

    const result = await runStandingPRUpdate({
      projectDir: '/test',
      verbose: false,
      quiet: false,
      json: false,
    });

    expect(result.action).toBe('updated');
    expect(result.prNumber).toBe(99);
    expect(mocks.pullsUpdate).toHaveBeenCalledWith(expect.objectContaining({ pull_number: 99 }));
    expect(mocks.pullsCreate).not.toHaveBeenCalled();
  });

  it('should update manifest comment when existing manifest comment found on PR', async () => {
    const { runVersionStep, runNotesStep } = await import('../../src/steps.js');
    const versionOutput = createMockVersionOutput([{ packageName: '@scope/core', newVersion: '1.2.3' }]);
    vi.mocked(runVersionStep)
      .mockResolvedValueOnce(versionOutput as unknown as Awaited<ReturnType<typeof runVersionStep>>)
      .mockResolvedValueOnce(versionOutput as unknown as Awaited<ReturnType<typeof runVersionStep>>);
    vi.mocked(runNotesStep).mockResolvedValue({ packageNotes: {}, releaseNotes: {}, files: [] });

    const { createOctokit } = await import('../../src/preview-github.js');
    const { mocks, octokit } = createMockOctokit();
    mocks.pullsList.mockResolvedValue({ data: [{ number: 99, html_url: 'https://github.com/owner/repo/pull/99' }] });
    // Paginate returns an existing manifest comment so the update path is taken
    mocks.paginate.iterator.mockReturnValue({
      async *[Symbol.asyncIterator]() {
        yield { data: [{ id: 77, body: serializeManifest(baseManifest) }] };
      },
    });
    vi.mocked(createOctokit).mockReturnValue(octokit as unknown as ReturnType<typeof createOctokit>);

    await runStandingPRUpdate({ projectDir: '/test', verbose: false, quiet: false, json: false });

    expect(mocks.updateComment).toHaveBeenCalledWith(expect.objectContaining({ comment_id: 77 }));
    expect(mocks.createComment).not.toHaveBeenCalledWith(
      expect.objectContaining({ body: expect.stringContaining('<!-- releasekit-manifest -->') }),
    );
  });

  it('should return noop with versionOutput when no GitHub context is available but changes exist', async () => {
    delete process.env.GITHUB_REPOSITORY;
    delete process.env.GITHUB_TOKEN;

    const { runVersionStep, runNotesStep } = await import('../../src/steps.js');
    const versionOutput = createMockVersionOutput([{ packageName: '@scope/core', newVersion: '1.2.3' }]);
    vi.mocked(runVersionStep)
      .mockResolvedValueOnce(versionOutput as unknown as Awaited<ReturnType<typeof runVersionStep>>)
      .mockResolvedValueOnce(versionOutput as unknown as Awaited<ReturnType<typeof runVersionStep>>);
    vi.mocked(runNotesStep).mockResolvedValue({ packageNotes: {}, releaseNotes: {}, files: [] });

    const result = await runStandingPRUpdate({ projectDir: '/test', verbose: false, quiet: false, json: false });

    expect(result.action).toBe('noop');
    expect(result.versionOutput).toBeDefined();
    expect(result.versionOutput?.updates).toHaveLength(1);
  });
});

describe('runStandingPRPublish', () => {
  const originalEnv = { ...process.env };

  beforeEach(async () => {
    vi.resetAllMocks();
    process.env.GITHUB_REPOSITORY = 'owner/repo';
    process.env.GITHUB_TOKEN = 'test-token';
    process.env.GITHUB_EVENT_PATH = '/tmp/test-event.json';

    const { loadConfig } = await import('@releasekit/config');
    vi.mocked(loadConfig).mockReturnValue({
      ci: {
        standingPr: { branch: 'release/next', deleteBranchOnMerge: true },
      },
      git: { branch: 'main' },
    } as ReturnType<typeof loadConfig>);

    const { execSync } = await import('node:child_process');
    vi.mocked(execSync).mockReturnValue('abc123\n' as unknown as Buffer);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('should return null when GITHUB_EVENT_PATH is not set', async () => {
    delete process.env.GITHUB_EVENT_PATH;

    const result = await runStandingPRPublish({
      projectDir: '/test',
      verbose: false,
      quiet: false,
      json: false,
    });

    expect(result).toBeNull();
  });

  it('should return null when merged PR head ref does not match release branch', async () => {
    const { readFileSync } = await import('node:fs');
    vi.mocked(readFileSync).mockReturnValue(
      JSON.stringify({
        pull_request: { head: { ref: 'feature/something' }, number: 5, merged: true },
      }) as unknown as Buffer,
    );

    const result = await runStandingPRPublish({
      projectDir: '/test',
      verbose: false,
      quiet: false,
      json: false,
    });

    expect(result).toBeNull();
  });

  it('should return null when PR was not merged', async () => {
    const { readFileSync } = await import('node:fs');
    vi.mocked(readFileSync).mockReturnValue(
      JSON.stringify({
        pull_request: { head: { ref: 'release/next' }, number: 5, merged: false },
      }) as unknown as Buffer,
    );

    const result = await runStandingPRPublish({
      projectDir: '/test',
      verbose: false,
      quiet: false,
      json: false,
    });

    expect(result).toBeNull();
  });

  it('should throw when manifest comment is missing from merged PR', async () => {
    const { readFileSync } = await import('node:fs');
    vi.mocked(readFileSync).mockReturnValue(
      JSON.stringify({
        pull_request: { head: { ref: 'release/next' }, number: 42, merged: true },
      }) as unknown as Buffer,
    );

    const { createOctokit } = await import('../../src/preview-github.js');
    const { octokit } = createMockOctokit();
    // No manifest comment
    vi.mocked(createOctokit).mockReturnValue(octokit as unknown as ReturnType<typeof createOctokit>);

    await expect(
      runStandingPRPublish({ projectDir: '/test', verbose: false, quiet: false, json: false }),
    ).rejects.toThrow(/manifest not found/);
  });

  it('should publish when valid manifest found on merged PR', async () => {
    const { readFileSync } = await import('node:fs');
    vi.mocked(readFileSync).mockReturnValue(
      JSON.stringify({
        pull_request: { head: { ref: 'release/next' }, number: 42, merged: true },
      }) as unknown as Buffer,
    );

    const { createOctokit } = await import('../../src/preview-github.js');
    const { octokit } = createMockOctokit();
    const manifestBody = serializeManifest(baseManifest);
    (octokit as unknown as { paginate: { iterator: ReturnType<typeof vi.fn> } }).paginate.iterator.mockReturnValue({
      async *[Symbol.asyncIterator]() {
        yield { data: [{ id: 1, body: manifestBody }] };
      },
    });
    vi.mocked(createOctokit).mockReturnValue(octokit as unknown as ReturnType<typeof createOctokit>);

    const { runPublishStep } = await import('../../src/steps.js');
    vi.mocked(runPublishStep).mockResolvedValue({ publishSucceeded: true } as unknown as Awaited<
      ReturnType<typeof runPublishStep>
    >);

    const result = await runStandingPRPublish({
      projectDir: '/test',
      verbose: false,
      quiet: false,
      json: false,
    });

    expect(result).not.toBeNull();
    expect(vi.mocked(runPublishStep)).toHaveBeenCalledWith(
      expect.objectContaining({ updates: baseManifest.versionOutput.updates }),
      expect.objectContaining({ skipGitCommit: true }),
      baseManifest.releaseNotes,
      baseManifest.notesFiles,
    );
  });

  it('should delete release branch after publish when deleteBranchOnMerge is true', async () => {
    const { readFileSync } = await import('node:fs');
    vi.mocked(readFileSync).mockReturnValue(
      JSON.stringify({
        pull_request: { head: { ref: 'release/next' }, number: 42, merged: true },
      }) as unknown as Buffer,
    );

    const { createOctokit } = await import('../../src/preview-github.js');
    const { octokit } = createMockOctokit();
    const manifestBody = serializeManifest(baseManifest);
    (octokit as unknown as { paginate: { iterator: ReturnType<typeof vi.fn> } }).paginate.iterator.mockReturnValue({
      async *[Symbol.asyncIterator]() {
        yield { data: [{ id: 1, body: manifestBody }] };
      },
    });
    vi.mocked(createOctokit).mockReturnValue(octokit as unknown as ReturnType<typeof createOctokit>);

    const { runPublishStep } = await import('../../src/steps.js');
    vi.mocked(runPublishStep).mockResolvedValue({ publishSucceeded: true } as unknown as Awaited<
      ReturnType<typeof runPublishStep>
    >);

    const { execSync } = await import('node:child_process');

    await runStandingPRPublish({ projectDir: '/test', verbose: false, quiet: false, json: false });

    const deleteCalls = vi
      .mocked(execSync)
      .mock.calls.filter((c) => typeof c[0] === 'string' && c[0].includes('--delete'));
    expect(deleteCalls).toHaveLength(1);
    expect(deleteCalls[0][0]).toContain('release/next');
  });

  it('should skip branch deletion when deleteBranchOnMerge is false', async () => {
    const { loadConfig } = await import('@releasekit/config');
    vi.mocked(loadConfig).mockReturnValue({
      ci: { standingPr: { branch: 'release/next', deleteBranchOnMerge: false } },
      git: { branch: 'main' },
    } as ReturnType<typeof loadConfig>);

    const { readFileSync } = await import('node:fs');
    vi.mocked(readFileSync).mockReturnValue(
      JSON.stringify({
        pull_request: { head: { ref: 'release/next' }, number: 42, merged: true },
      }) as unknown as Buffer,
    );

    const { createOctokit } = await import('../../src/preview-github.js');
    const { octokit } = createMockOctokit();
    const manifestBody = serializeManifest(baseManifest);
    (octokit as unknown as { paginate: { iterator: ReturnType<typeof vi.fn> } }).paginate.iterator.mockReturnValue({
      async *[Symbol.asyncIterator]() {
        yield { data: [{ id: 1, body: manifestBody }] };
      },
    });
    vi.mocked(createOctokit).mockReturnValue(octokit as unknown as ReturnType<typeof createOctokit>);

    const { runPublishStep } = await import('../../src/steps.js');
    vi.mocked(runPublishStep).mockResolvedValue({ publishSucceeded: true } as unknown as Awaited<
      ReturnType<typeof runPublishStep>
    >);

    const { execSync } = await import('node:child_process');

    await runStandingPRPublish({ projectDir: '/test', verbose: false, quiet: false, json: false });

    const deleteCalls = vi
      .mocked(execSync)
      .mock.calls.filter((c) => typeof c[0] === 'string' && c[0].includes('--delete'));
    expect(deleteCalls).toHaveLength(0);
  });

  it('should return null when no GitHub context is available for a merged release PR', async () => {
    delete process.env.GITHUB_REPOSITORY;
    delete process.env.GITHUB_TOKEN;

    const { readFileSync } = await import('node:fs');
    vi.mocked(readFileSync).mockReturnValue(
      JSON.stringify({
        pull_request: { head: { ref: 'release/next' }, number: 42, merged: true },
      }) as unknown as Buffer,
    );

    const result = await runStandingPRPublish({ projectDir: '/test', verbose: false, quiet: false, json: false });

    expect(result).toBeNull();
  });

  it('should throw with actionable message when manifest JSON is malformed', async () => {
    const { readFileSync } = await import('node:fs');
    vi.mocked(readFileSync).mockReturnValue(
      JSON.stringify({
        pull_request: { head: { ref: 'release/next' }, number: 42, merged: true },
      }) as unknown as Buffer,
    );

    const { createOctokit } = await import('../../src/preview-github.js');
    const { octokit } = createMockOctokit();
    const badManifest = '<!-- releasekit-manifest -->\n<!-- json {broken -->';
    (octokit as unknown as { paginate: { iterator: ReturnType<typeof vi.fn> } }).paginate.iterator.mockReturnValue({
      async *[Symbol.asyncIterator]() {
        yield { data: [{ id: 1, body: badManifest }] };
      },
    });
    vi.mocked(createOctokit).mockReturnValue(octokit as unknown as ReturnType<typeof createOctokit>);

    await expect(
      runStandingPRPublish({ projectDir: '/test', verbose: false, quiet: false, json: false }),
    ).rejects.toThrow(/invalid or incompatible/);
  });
});
