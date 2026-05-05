import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StandingPRManifest } from '../../src/standing-pr/standing-pr.js';
import {
  extractEditableSection,
  parseEditedNotes,
  parseManifest,
  publishFromManifest,
  runStandingPRMerge,
  runStandingPRPublish,
  runStandingPRUpdate,
  serializeManifest,
} from '../../src/standing-pr/standing-pr.js';

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

vi.mock('../../src/github.js', () => ({
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
  const pullsGet = vi.fn().mockResolvedValue({ data: { body: '' } });
  const pullsMerge = vi.fn().mockResolvedValue({});
  const issuesSetLabels = vi.fn().mockResolvedValue({});
  const createCommitStatus = vi.fn().mockResolvedValue({});

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
          get: pullsGet,
          merge: pullsMerge,
        },
        repos: {
          createCommitStatus,
        },
      },
      ...overrides,
    },
    mocks: {
      createComment,
      updateComment,
      pullsList,
      pullsCreate,
      pullsUpdate,
      pullsGet,
      pullsMerge,
      issuesSetLabels,
      paginate,
      createCommitStatus,
    },
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
    expect(serialized).toMatch(/<!-- base64 [A-Za-z0-9+/=]+ -->/);

    const parsed = parseManifest(serialized);
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.versionOutput.updates).toHaveLength(1);
    expect(parsed.releaseNotes['@scope/core']).toBe('- added new feature');
    expect(parsed.baseSha).toBe('abc123');
  });

  it('should throw when manifest comment is missing', () => {
    expect(() => parseManifest('No marker here')).toThrow(/not found or malformed/);
  });

  it('should throw when manifest encoding is invalid', () => {
    const bad = '<!-- releasekit-manifest -->\n<!-- base64 !!!invalid!!! -->';
    expect(() => parseManifest(bad)).toThrow(/encoding is invalid|malformed/);
  });

  it('should throw when schemaVersion is incompatible', () => {
    const wrongVersion = serializeManifest({ ...baseManifest, schemaVersion: 99 as unknown as 1 });
    expect(() => parseManifest(wrongVersion)).toThrow(/incompatible/);
  });

  it('should accept a v1 manifest without firstUpdatedAt (backward compat)', () => {
    // v1 manifests from before schema v2 have no firstUpdatedAt
    const v1Manifest = { ...baseManifest, schemaVersion: 1 as const };
    const serialized = serializeManifest(v1Manifest);
    const parsed = parseManifest(serialized);
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.firstUpdatedAt).toBeUndefined();
  });

  it('should round-trip a v2 manifest with firstUpdatedAt', () => {
    const v2Manifest = {
      ...baseManifest,
      schemaVersion: 2 as const,
      firstUpdatedAt: '2024-06-01T12:00:00.000Z',
    };
    const serialized = serializeManifest(v2Manifest);
    const parsed = parseManifest(serialized);
    expect(parsed.schemaVersion).toBe(2);
    expect(parsed.firstUpdatedAt).toBe('2024-06-01T12:00:00.000Z');
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
        stable: 'channel:stable',
        prerelease: 'channel:prerelease',
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
    vi.mocked(execSync).mockReturnValue('abc123\n');
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('should return noop when HEAD commit matches skip pattern', async () => {
    const { execSync } = await import('node:child_process');
    vi.mocked(execSync).mockReturnValueOnce('chore: release @scope/core v1.2.3');

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

    const { createOctokit } = await import('../../src/github.js');
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

    const { createOctokit } = await import('../../src/github.js');
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

    const { createOctokit } = await import('../../src/github.js');
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

    const { createOctokit } = await import('../../src/github.js');
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

    const { createOctokit } = await import('../../src/github.js');
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

  it('should return noop when package count is below minPackages threshold', async () => {
    const { loadConfig } = await import('@releasekit/config');
    vi.mocked(loadConfig).mockReturnValue({
      ...defaultConfig,
      ci: { ...defaultConfig.ci, standingPr: { ...defaultConfig.ci.standingPr, minPackages: 3 } },
    } as ReturnType<typeof loadConfig>);

    const { runVersionStep } = await import('../../src/steps.js');
    // Only 1 package changed — below threshold of 3
    const versionOutput = createMockVersionOutput([{ packageName: '@scope/core', newVersion: '1.2.3' }]);
    vi.mocked(runVersionStep).mockResolvedValue(versionOutput as unknown as Awaited<ReturnType<typeof runVersionStep>>);

    const { createOctokit } = await import('../../src/github.js');
    const { mocks, octokit } = createMockOctokit();
    mocks.pullsList.mockResolvedValue({ data: [] });
    vi.mocked(createOctokit).mockReturnValue(octokit as unknown as ReturnType<typeof createOctokit>);

    const result = await runStandingPRUpdate({ projectDir: '/test', verbose: false, quiet: false, json: false });

    expect(result.action).toBe('noop');
    expect(mocks.pullsCreate).not.toHaveBeenCalled();
  });

  it('should close existing PR when package count is below minPackages threshold', async () => {
    const { loadConfig } = await import('@releasekit/config');
    vi.mocked(loadConfig).mockReturnValue({
      ...defaultConfig,
      ci: { ...defaultConfig.ci, standingPr: { ...defaultConfig.ci.standingPr, minPackages: 3 } },
    } as ReturnType<typeof loadConfig>);

    const { runVersionStep } = await import('../../src/steps.js');
    const versionOutput = createMockVersionOutput([{ packageName: '@scope/core', newVersion: '1.2.3' }]);
    vi.mocked(runVersionStep).mockResolvedValue(versionOutput as unknown as Awaited<ReturnType<typeof runVersionStep>>);

    const { createOctokit } = await import('../../src/github.js');
    const { mocks, octokit } = createMockOctokit();
    mocks.pullsList.mockResolvedValue({ data: [{ number: 55, html_url: 'https://github.com/owner/repo/pull/55' }] });
    vi.mocked(createOctokit).mockReturnValue(octokit as unknown as ReturnType<typeof createOctokit>);

    const result = await runStandingPRUpdate({ projectDir: '/test', verbose: false, quiet: false, json: false });

    expect(result.action).toBe('closed');
    expect(result.prNumber).toBe(55);
    expect(mocks.pullsUpdate).toHaveBeenCalledWith(expect.objectContaining({ state: 'closed', pull_number: 55 }));
    expect(mocks.createComment).toHaveBeenCalledWith(
      expect.objectContaining({ body: expect.stringContaining('1 of 3 required') }),
    );
  });

  it('should post success status check when all gates are satisfied', async () => {
    const { runVersionStep, runNotesStep } = await import('../../src/steps.js');
    const versionOutput = createMockVersionOutput([{ packageName: '@scope/core', newVersion: '1.2.3' }]);
    vi.mocked(runVersionStep)
      .mockResolvedValueOnce(versionOutput as unknown as Awaited<ReturnType<typeof runVersionStep>>)
      .mockResolvedValueOnce(versionOutput as unknown as Awaited<ReturnType<typeof runVersionStep>>);
    vi.mocked(runNotesStep).mockResolvedValue({ packageNotes: {}, releaseNotes: {}, files: [] });

    const { createOctokit } = await import('../../src/github.js');
    const { mocks, octokit } = createMockOctokit();
    mocks.pullsList.mockResolvedValue({ data: [] });
    vi.mocked(createOctokit).mockReturnValue(octokit as unknown as ReturnType<typeof createOctokit>);

    await runStandingPRUpdate({ projectDir: '/test', verbose: false, quiet: false, json: false });

    expect(mocks.createCommitStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: 'owner',
        repo: 'repo',
        sha: 'abc123',
        state: 'success',
        description: 'Ready to merge',
        context: 'releasekit/standing-pr',
      }),
    );
  });

  it('should post pending status check when minAge has not elapsed', async () => {
    const { loadConfig } = await import('@releasekit/config');
    vi.mocked(loadConfig).mockReturnValue({
      ...defaultConfig,
      ci: { ...defaultConfig.ci, standingPr: { ...defaultConfig.ci.standingPr, minAge: '6h' } },
    } as ReturnType<typeof loadConfig>);

    const { runVersionStep, runNotesStep } = await import('../../src/steps.js');
    const versionOutput = createMockVersionOutput([{ packageName: '@scope/core', newVersion: '1.2.3' }]);
    vi.mocked(runVersionStep)
      .mockResolvedValueOnce(versionOutput as unknown as Awaited<ReturnType<typeof runVersionStep>>)
      .mockResolvedValueOnce(versionOutput as unknown as Awaited<ReturnType<typeof runVersionStep>>);
    vi.mocked(runNotesStep).mockResolvedValue({ packageNotes: {}, releaseNotes: {}, files: [] });

    const { createOctokit } = await import('../../src/github.js');
    const { mocks, octokit } = createMockOctokit();
    // Existing PR with a manifest that has a recent firstUpdatedAt (5 minutes ago)
    mocks.pullsList.mockResolvedValue({ data: [{ number: 99, html_url: 'https://github.com/owner/repo/pull/99' }] });
    const recentTimestamp = new Date(Date.now() - 5 * 60_000).toISOString();
    const existingManifest = serializeManifest({
      ...baseManifest,
      schemaVersion: 2,
      firstUpdatedAt: recentTimestamp,
    });
    mocks.paginate.iterator.mockReturnValue({
      async *[Symbol.asyncIterator]() {
        yield { data: [{ id: 77, body: existingManifest }] };
      },
    });
    vi.mocked(createOctokit).mockReturnValue(octokit as unknown as ReturnType<typeof createOctokit>);

    await runStandingPRUpdate({ projectDir: '/test', verbose: false, quiet: false, json: false });

    expect(mocks.createCommitStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        state: 'pending',
        context: 'releasekit/standing-pr',
        description: expect.stringMatching(/Waiting .+ for minAge/),
      }),
    );
  });

  it('should post success status check when minAge has elapsed', async () => {
    const { loadConfig } = await import('@releasekit/config');
    vi.mocked(loadConfig).mockReturnValue({
      ...defaultConfig,
      ci: { ...defaultConfig.ci, standingPr: { ...defaultConfig.ci.standingPr, minAge: '1h' } },
    } as ReturnType<typeof loadConfig>);

    const { runVersionStep, runNotesStep } = await import('../../src/steps.js');
    const versionOutput = createMockVersionOutput([{ packageName: '@scope/core', newVersion: '1.2.3' }]);
    vi.mocked(runVersionStep)
      .mockResolvedValueOnce(versionOutput as unknown as Awaited<ReturnType<typeof runVersionStep>>)
      .mockResolvedValueOnce(versionOutput as unknown as Awaited<ReturnType<typeof runVersionStep>>);
    vi.mocked(runNotesStep).mockResolvedValue({ packageNotes: {}, releaseNotes: {}, files: [] });

    const { createOctokit } = await import('../../src/github.js');
    const { mocks, octokit } = createMockOctokit();
    mocks.pullsList.mockResolvedValue({ data: [{ number: 99, html_url: 'https://github.com/owner/repo/pull/99' }] });
    // firstUpdatedAt is 2 hours ago — minAge of 1h is satisfied
    const oldTimestamp = new Date(Date.now() - 2 * 3_600_000).toISOString();
    const existingManifest = serializeManifest({
      ...baseManifest,
      schemaVersion: 2,
      firstUpdatedAt: oldTimestamp,
    });
    mocks.paginate.iterator.mockReturnValue({
      async *[Symbol.asyncIterator]() {
        yield { data: [{ id: 77, body: existingManifest }] };
      },
    });
    vi.mocked(createOctokit).mockReturnValue(octokit as unknown as ReturnType<typeof createOctokit>);

    await runStandingPRUpdate({ projectDir: '/test', verbose: false, quiet: false, json: false });

    expect(mocks.createCommitStatus).toHaveBeenCalledWith(
      expect.objectContaining({ state: 'success', description: 'Ready to merge' }),
    );
  });

  it('should preserve firstUpdatedAt from existing manifest across updates', async () => {
    const { runVersionStep, runNotesStep } = await import('../../src/steps.js');
    const versionOutput = createMockVersionOutput([{ packageName: '@scope/core', newVersion: '1.2.3' }]);
    vi.mocked(runVersionStep)
      .mockResolvedValueOnce(versionOutput as unknown as Awaited<ReturnType<typeof runVersionStep>>)
      .mockResolvedValueOnce(versionOutput as unknown as Awaited<ReturnType<typeof runVersionStep>>);
    vi.mocked(runNotesStep).mockResolvedValue({ packageNotes: {}, releaseNotes: {}, files: [] });

    const { createOctokit } = await import('../../src/github.js');
    const { mocks, octokit } = createMockOctokit();
    mocks.pullsList.mockResolvedValue({ data: [{ number: 99, html_url: 'https://github.com/owner/repo/pull/99' }] });

    const originalTimestamp = '2024-01-15T08:00:00.000Z';
    const existingManifest = serializeManifest({
      ...baseManifest,
      schemaVersion: 2,
      firstUpdatedAt: originalTimestamp,
    });
    mocks.paginate.iterator.mockReturnValue({
      async *[Symbol.asyncIterator]() {
        yield { data: [{ id: 77, body: existingManifest }] };
      },
    });
    vi.mocked(createOctokit).mockReturnValue(octokit as unknown as ReturnType<typeof createOctokit>);

    await runStandingPRUpdate({ projectDir: '/test', verbose: false, quiet: false, json: false });

    // The manifest comment update should contain the original firstUpdatedAt
    const updateCall = mocks.updateComment.mock.calls.find(
      (c) => typeof c[0]?.body === 'string' && c[0].body.includes('<!-- releasekit-manifest -->'),
    );
    expect(updateCall).toBeDefined();
    const writtenBody = updateCall?.[0]?.body as string;
    const writtenManifest = parseManifest(writtenBody);
    expect(writtenManifest.firstUpdatedAt).toBe(originalTimestamp);
  });

  it('should use createdAt as firstUpdatedAt fallback when migrating from v1 manifest', async () => {
    const { runVersionStep, runNotesStep } = await import('../../src/steps.js');
    const versionOutput = createMockVersionOutput([{ packageName: '@scope/core', newVersion: '1.2.3' }]);
    vi.mocked(runVersionStep)
      .mockResolvedValueOnce(versionOutput as unknown as Awaited<ReturnType<typeof runVersionStep>>)
      .mockResolvedValueOnce(versionOutput as unknown as Awaited<ReturnType<typeof runVersionStep>>);
    vi.mocked(runNotesStep).mockResolvedValue({ packageNotes: {}, releaseNotes: {}, files: [] });

    const { createOctokit } = await import('../../src/github.js');
    const { mocks, octokit } = createMockOctokit();
    mocks.pullsList.mockResolvedValue({ data: [{ number: 99, html_url: 'https://github.com/owner/repo/pull/99' }] });

    // v1 manifest has no firstUpdatedAt — should fall back to createdAt
    const v1Manifest = serializeManifest({ ...baseManifest, schemaVersion: 1 });
    mocks.paginate.iterator.mockReturnValue({
      async *[Symbol.asyncIterator]() {
        yield { data: [{ id: 77, body: v1Manifest }] };
      },
    });
    vi.mocked(createOctokit).mockReturnValue(octokit as unknown as ReturnType<typeof createOctokit>);

    await runStandingPRUpdate({ projectDir: '/test', verbose: false, quiet: false, json: false });

    const updateCall = mocks.updateComment.mock.calls.find(
      (c) => typeof c[0]?.body === 'string' && c[0].body.includes('<!-- releasekit-manifest -->'),
    );
    expect(updateCall).toBeDefined();
    const writtenManifest = parseManifest(updateCall?.[0]?.body as string);
    expect(writtenManifest.firstUpdatedAt).toBe(baseManifest.createdAt);
  });

  it('should not fail update when status check post throws', async () => {
    const { runVersionStep, runNotesStep } = await import('../../src/steps.js');
    const versionOutput = createMockVersionOutput([{ packageName: '@scope/core', newVersion: '1.2.3' }]);
    vi.mocked(runVersionStep)
      .mockResolvedValueOnce(versionOutput as unknown as Awaited<ReturnType<typeof runVersionStep>>)
      .mockResolvedValueOnce(versionOutput as unknown as Awaited<ReturnType<typeof runVersionStep>>);
    vi.mocked(runNotesStep).mockResolvedValue({ packageNotes: {}, releaseNotes: {}, files: [] });

    const { createOctokit } = await import('../../src/github.js');
    const { mocks, octokit } = createMockOctokit();
    mocks.pullsList.mockResolvedValue({ data: [] });
    mocks.createCommitStatus.mockRejectedValue(new Error('API rate limit exceeded'));
    vi.mocked(createOctokit).mockReturnValue(octokit as unknown as ReturnType<typeof createOctokit>);

    // Should resolve (not throw) even when status check post fails
    const result = await runStandingPRUpdate({ projectDir: '/test', verbose: false, quiet: false, json: false });

    expect(result.action).toBe('created');
    expect(result.prNumber).toBe(42);
  });

  describe('standing-PR labels as overrides', () => {
    async function setupWithStandingPRLabels(labelNames: string[]) {
      const { runVersionStep, runNotesStep } = await import('../../src/steps.js');
      const versionOutput = createMockVersionOutput([{ packageName: '@scope/core', newVersion: '1.2.3' }]);
      vi.mocked(runVersionStep)
        .mockResolvedValueOnce(versionOutput as unknown as Awaited<ReturnType<typeof runVersionStep>>)
        .mockResolvedValueOnce(versionOutput as unknown as Awaited<ReturnType<typeof runVersionStep>>);
      vi.mocked(runNotesStep).mockResolvedValue({ packageNotes: {}, releaseNotes: {}, files: [] });

      const { createOctokit } = await import('../../src/github.js');
      const { mocks, octokit } = createMockOctokit();
      mocks.pullsList.mockResolvedValue({
        data: [
          {
            number: 99,
            html_url: 'https://github.com/owner/repo/pull/99',
            labels: labelNames.map((name) => ({ name })),
          },
        ],
      });
      vi.mocked(createOctokit).mockReturnValue(octokit as unknown as ReturnType<typeof createOctokit>);

      return { mocks, octokit, runVersionStepMock: vi.mocked(runVersionStep) };
    }

    it('passes bump:major from standing PR labels into version step', async () => {
      const { runVersionStepMock } = await setupWithStandingPRLabels(['release', 'bump:major']);

      await runStandingPRUpdate({ projectDir: '/test', verbose: false, quiet: false, json: false });

      // First call (dry run) and second call (write) should both carry bump: 'major'
      expect(runVersionStepMock.mock.calls[0]?.[0]).toMatchObject({ bump: 'major' });
      expect(runVersionStepMock.mock.calls[1]?.[0]).toMatchObject({ bump: 'major' });
    });

    it('passes channel:prerelease from standing PR labels as prerelease override', async () => {
      const { runVersionStepMock } = await setupWithStandingPRLabels(['release', 'channel:prerelease']);

      await runStandingPRUpdate({ projectDir: '/test', verbose: false, quiet: false, json: false });

      expect(runVersionStepMock.mock.calls[0]?.[0]).toMatchObject({ prerelease: true });
    });

    it('drops conflicting bump labels and posts pending status check', async () => {
      const { mocks, runVersionStepMock } = await setupWithStandingPRLabels(['release', 'bump:patch', 'bump:major']);

      await runStandingPRUpdate({ projectDir: '/test', verbose: false, quiet: false, json: false });

      // Conflict → bump override dropped, version analysis runs commit-driven
      expect(runVersionStepMock.mock.calls[0]?.[0]).not.toHaveProperty('bump', 'major');
      expect(runVersionStepMock.mock.calls[0]?.[0]?.bump).toBeUndefined();
      // Final status check is pending with conflict description
      const lastStatus = mocks.createCommitStatus.mock.calls.at(-1)?.[0];
      expect(lastStatus?.state).toBe('pending');
      expect(lastStatus?.description).toMatch(/Conflicting bump labels/);
    });

    it('preserves maintainer-added labels in setLabels (union with configured labels)', async () => {
      const { mocks } = await setupWithStandingPRLabels(['release', 'bump:major']);

      await runStandingPRUpdate({ projectDir: '/test', verbose: false, quiet: false, json: false });

      const lastSetLabels = mocks.issuesSetLabels.mock.calls.at(-1)?.[0];
      // Should contain BOTH the configured 'release' and the maintainer-added 'bump:major'
      expect(lastSetLabels?.labels).toContain('release');
      expect(lastSetLabels?.labels).toContain('bump:major');
    });

    it('inherits sync from version config (defaults true) instead of forcing false', async () => {
      const { runVersionStepMock } = await setupWithStandingPRLabels([]);

      await runStandingPRUpdate({ projectDir: '/test', verbose: false, quiet: false, json: false });

      expect(runVersionStepMock.mock.calls[0]?.[0]).toMatchObject({ sync: true });
    });
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
    vi.mocked(execSync).mockReturnValue('abc123\n');
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
        pull_request: { head: { ref: 'feature/something-else' }, number: 42, merged: true },
      }),
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
      }),
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
      }),
    );

    const { createOctokit } = await import('../../src/github.js');
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
      }),
    );

    const { createOctokit } = await import('../../src/github.js');
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
      }),
    );

    const { createOctokit } = await import('../../src/github.js');
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
      }),
    );

    const { createOctokit } = await import('../../src/github.js');
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
      }),
    );

    const result = await runStandingPRPublish({ projectDir: '/test', verbose: false, quiet: false, json: false });

    expect(result).toBeNull();
  });

  it('should throw with actionable message when manifest JSON is malformed', async () => {
    const { readFileSync } = await import('node:fs');
    vi.mocked(readFileSync).mockReturnValue(
      JSON.stringify({
        pull_request: { head: { ref: 'release/next' }, number: 42, merged: true },
      }),
    );

    const { createOctokit } = await import('../../src/github.js');
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

// ─── Editable notes helpers ───────────────────────────────────────────────────

describe('extractEditableSection', () => {
  const START = '<!-- releasekit-editable-start -->';
  const END = '<!-- releasekit-editable-end -->';

  it('returns the trimmed content between editable markers', () => {
    const body = `some text\n\n${START}\n### Release Notes\n\n#### pkg — 1.0.0\n\n- note\n${END}\n---`;
    expect(extractEditableSection(body)).toBe('### Release Notes\n\n#### pkg — 1.0.0\n\n- note');
  });

  it('returns null when start marker is absent', () => {
    expect(extractEditableSection(`### Release Notes\n\n${END}`)).toBeNull();
  });

  it('returns null when end marker is absent', () => {
    expect(extractEditableSection(`${START}\n### Release Notes`)).toBeNull();
  });

  it('returns null when both markers are absent', () => {
    expect(extractEditableSection('### Release Notes\n\n- note')).toBeNull();
  });

  it('returns null when end marker precedes start marker', () => {
    expect(extractEditableSection(`${END}\n${START}`)).toBeNull();
  });
});

describe('parseEditedNotes', () => {
  it('parses multiple packages from a section', () => {
    const section = [
      '### Release Notes',
      '',
      '#### @scope/core — 1.2.3',
      '',
      '- added feature',
      '',
      '#### @scope/cli — 2.0.0',
      '',
      '- fixed bug',
    ].join('\n');

    const result = parseEditedNotes(section);
    expect(result['@scope/core']).toBe('- added feature');
    expect(result['@scope/cli']).toBe('- fixed bug');
  });

  it('preserves h4 subheadings within package notes without truncating content', () => {
    const section = [
      '### Release Notes',
      '',
      '#### @scope/core — 1.2.3',
      '',
      '#### Breaking Changes',
      '- something important',
      '',
      '#### New Features',
      '- another thing',
    ].join('\n');

    const result = parseEditedNotes(section);
    expect(result['@scope/core']).toContain('#### Breaking Changes');
    expect(result['@scope/core']).toContain('- something important');
    expect(result['@scope/core']).toContain('#### New Features');
    expect(result['@scope/core']).toContain('- another thing');
  });

  it('returns empty object for a section with no package headings', () => {
    expect(parseEditedNotes('### Release Notes\n\nsome text')).toEqual({});
  });

  it('returns empty object for an empty string', () => {
    expect(parseEditedNotes('')).toEqual({});
  });

  it('round-trips the content produced by renderPrBody editable markers', () => {
    const versionOutput = createMockVersionOutput([
      { packageName: '@scope/core', newVersion: '1.2.3' },
      { packageName: '@scope/cli', newVersion: '2.0.0' },
    ]);
    const releaseNotes = {
      '@scope/core': '- added feature',
      '@scope/cli': '- fixed bug',
    };

    // Manually reconstruct what renderNotesSection/renderPrBody produces
    const section = [
      '### Release Notes',
      '',
      '#### @scope/core — 1.2.3',
      '',
      '- added feature',
      '',
      '#### @scope/cli — 2.0.0',
      '',
      '- fixed bug',
    ].join('\n');

    const parsed = parseEditedNotes(section);
    expect(parsed).toEqual(releaseNotes);
    // Suppress unused variable warning
    void versionOutput;
  });
});

// ─── editableNotes in runStandingPRUpdate ─────────────────────────────────────

describe('runStandingPRUpdate — editableNotes', () => {
  const originalEnv = { ...process.env };

  const editableConfig = {
    ci: {
      standingPr: {
        branch: 'release/next',
        labels: ['release'],
        deleteBranchOnMerge: true,
        title: 'chore: release ${count} package(s)',
        editableNotes: true,
      },
      releaseStrategy: 'standing-pr',
      releaseTrigger: 'label',
      prPreview: true,
      autoRelease: false,
      skipPatterns: ['chore: release '],
      minChanges: 1,
      labels: {
        stable: 'channel:stable',
        prerelease: 'channel:prerelease',
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
    vi.mocked(loadConfig).mockReturnValue(editableConfig as ReturnType<typeof loadConfig>);

    const { execSync } = await import('node:child_process');
    vi.mocked(execSync).mockReturnValue('abc123\n' as unknown as Buffer);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('stores notesHash in manifest when editableNotes is enabled and notes exist', async () => {
    const { runVersionStep, runNotesStep } = await import('../../src/steps.js');
    const versionOutput = createMockVersionOutput([{ packageName: '@scope/core', newVersion: '1.2.3' }]);
    vi.mocked(runVersionStep)
      .mockResolvedValueOnce(versionOutput as unknown as Awaited<ReturnType<typeof runVersionStep>>)
      .mockResolvedValueOnce(versionOutput as unknown as Awaited<ReturnType<typeof runVersionStep>>);
    vi.mocked(runNotesStep).mockResolvedValue({
      packageNotes: {},
      releaseNotes: { '@scope/core': '- added feature' },
      files: [],
    });

    const { createOctokit } = await import('../../src/github.js');
    const { mocks, octokit } = createMockOctokit();
    mocks.pullsList.mockResolvedValue({ data: [] });
    vi.mocked(createOctokit).mockReturnValue(octokit as unknown as ReturnType<typeof createOctokit>);

    await runStandingPRUpdate({ projectDir: '/test', verbose: false, quiet: false, json: false });

    // The manifest comment should have been created; verify notesHash is present
    const createCommentCall = mocks.createComment.mock.calls.find(
      (c: unknown[]) =>
        typeof c[0] === 'object' &&
        c[0] !== null &&
        'body' in (c[0] as Record<string, unknown>) &&
        typeof (c[0] as Record<string, unknown>).body === 'string' &&
        ((c[0] as Record<string, unknown>).body as string).includes('<!-- releasekit-manifest -->'),
    );
    expect(createCommentCall).toBeDefined();

    const commentBody = (createCommentCall?.[0] as Record<string, unknown>).body as string;
    const parsedManifest = parseManifest(commentBody);
    expect(parsedManifest.notesHash).toBeDefined();
    expect(typeof parsedManifest.notesHash).toBe('string');
  });

  it('includes editable markers in PR body when editableNotes is enabled', async () => {
    const { runVersionStep, runNotesStep } = await import('../../src/steps.js');
    const versionOutput = createMockVersionOutput([{ packageName: '@scope/core', newVersion: '1.2.3' }]);
    vi.mocked(runVersionStep)
      .mockResolvedValueOnce(versionOutput as unknown as Awaited<ReturnType<typeof runVersionStep>>)
      .mockResolvedValueOnce(versionOutput as unknown as Awaited<ReturnType<typeof runVersionStep>>);
    vi.mocked(runNotesStep).mockResolvedValue({
      packageNotes: {},
      releaseNotes: { '@scope/core': '- added feature' },
      files: [],
    });

    const { createOctokit } = await import('../../src/github.js');
    const { mocks, octokit } = createMockOctokit();
    mocks.pullsList.mockResolvedValue({ data: [] });
    vi.mocked(createOctokit).mockReturnValue(octokit as unknown as ReturnType<typeof createOctokit>);

    await runStandingPRUpdate({ projectDir: '/test', verbose: false, quiet: false, json: false });

    expect(mocks.pullsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.stringContaining('<!-- releasekit-editable-start -->'),
      }),
    );
    expect(mocks.pullsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.stringContaining('<!-- releasekit-editable-end -->'),
      }),
    );
  });

  it('preserves user edits when existing section hash does not match stored notesHash', async () => {
    const { runVersionStep, runNotesStep } = await import('../../src/steps.js');
    const versionOutput = createMockVersionOutput([{ packageName: '@scope/core', newVersion: '1.2.3' }]);
    vi.mocked(runVersionStep)
      .mockResolvedValueOnce(versionOutput as unknown as Awaited<ReturnType<typeof runVersionStep>>)
      .mockResolvedValueOnce(versionOutput as unknown as Awaited<ReturnType<typeof runVersionStep>>);
    vi.mocked(runNotesStep).mockResolvedValue({
      packageNotes: {},
      releaseNotes: { '@scope/core': '- added feature' },
      files: [],
    });

    // Manifest stored with a hash that does NOT match the current PR body section
    const manifestWithDifferentHash: StandingPRManifest = {
      ...baseManifest,
      notesHash: 'aaaaaaaaaaaaaaaa', // intentionally wrong hash
    };

    const userEditedBody = [
      '## Release',
      '',
      '<!-- releasekit-editable-start -->',
      '### Release Notes',
      '',
      '#### @scope/core — 1.2.3',
      '',
      '- user-edited content here',
      '<!-- releasekit-editable-end -->',
      '---',
    ].join('\n');

    const { createOctokit } = await import('../../src/github.js');
    const { mocks, octokit } = createMockOctokit();
    mocks.pullsList.mockResolvedValue({ data: [{ number: 99, html_url: 'https://github.com/owner/repo/pull/99' }] });
    mocks.pullsGet.mockResolvedValue({ data: { body: userEditedBody } });
    mocks.paginate.iterator.mockReturnValue({
      async *[Symbol.asyncIterator]() {
        yield { data: [{ id: 77, body: serializeManifest(manifestWithDifferentHash) }] };
      },
    });
    vi.mocked(createOctokit).mockReturnValue(octokit as unknown as ReturnType<typeof createOctokit>);

    await runStandingPRUpdate({ projectDir: '/test', verbose: false, quiet: false, json: false });

    // PR body should contain the user's edited content
    expect(mocks.pullsUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.stringContaining('user-edited content here'),
      }),
    );
  });

  it('regenerates notes when existing section hash matches stored notesHash (user has not edited)', async () => {
    const { runVersionStep, runNotesStep } = await import('../../src/steps.js');
    const versionOutput = createMockVersionOutput([{ packageName: '@scope/core', newVersion: '1.2.3' }]);
    vi.mocked(runVersionStep)
      .mockResolvedValueOnce(versionOutput as unknown as Awaited<ReturnType<typeof runVersionStep>>)
      .mockResolvedValueOnce(versionOutput as unknown as Awaited<ReturnType<typeof runVersionStep>>);
    vi.mocked(runNotesStep).mockResolvedValue({
      packageNotes: {},
      releaseNotes: { '@scope/core': '- added feature' },
      files: [],
    });

    // Build a body with markers + the exact freshly-generated section, so the hash matches
    const freshSection = '### Release Notes\n\n#### @scope/core — 1.2.3\n\n- added feature';
    const { createHash } = await import('node:crypto');
    const freshHash = createHash('sha256').update(freshSection).digest('hex').slice(0, 16);

    const manifestWithMatchingHash: StandingPRManifest = {
      ...baseManifest,
      notesHash: freshHash,
    };

    const unedited = [
      '## Release',
      '',
      '<!-- releasekit-editable-start -->',
      freshSection,
      '<!-- releasekit-editable-end -->',
      '---',
    ].join('\n');

    const { createOctokit } = await import('../../src/github.js');
    const { mocks, octokit } = createMockOctokit();
    mocks.pullsList.mockResolvedValue({ data: [{ number: 99, html_url: 'https://github.com/owner/repo/pull/99' }] });
    mocks.pullsGet.mockResolvedValue({ data: { body: unedited } });
    mocks.paginate.iterator.mockReturnValue({
      async *[Symbol.asyncIterator]() {
        yield { data: [{ id: 77, body: serializeManifest(manifestWithMatchingHash) }] };
      },
    });
    vi.mocked(createOctokit).mockReturnValue(octokit as unknown as ReturnType<typeof createOctokit>);

    await runStandingPRUpdate({ projectDir: '/test', verbose: false, quiet: false, json: false });

    // PR body should contain the freshly generated content (markers present, no user override)
    expect(mocks.pullsUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.stringContaining('<!-- releasekit-editable-start -->'),
      }),
    );
    expect(mocks.pullsUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.stringContaining('- added feature'),
      }),
    );
  });
});

// ─── publishFromManifest ──────────────────────────────────────────────────────

describe('publishFromManifest', () => {
  const originalEnv = { ...process.env };

  beforeEach(async () => {
    vi.resetAllMocks();
    process.env.GITHUB_REPOSITORY = 'owner/repo';
    process.env.GITHUB_TOKEN = 'test-token';

    const { loadConfig } = await import('@releasekit/config');
    vi.mocked(loadConfig).mockReturnValue({
      ci: {
        standingPr: { branch: 'release/next', mergeMethod: 'merge', deleteBranchOnMerge: true, editableNotes: false },
      },
      git: { branch: 'main' },
    } as ReturnType<typeof loadConfig>);

    const { execSync } = await import('node:child_process');
    vi.mocked(execSync).mockReturnValue('abc123\n');
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('returns null when no GitHub context is available', async () => {
    delete process.env.GITHUB_REPOSITORY;
    delete process.env.GITHUB_TOKEN;

    const result = await publishFromManifest(42, {
      projectDir: '/test',
      verbose: false,
      quiet: false,
      json: false,
    });

    expect(result).toBeNull();
  });

  it('throws when manifest comment is missing from PR', async () => {
    const { createOctokit } = await import('../../src/github.js');
    const { octokit } = createMockOctokit();
    vi.mocked(createOctokit).mockReturnValue(octokit as unknown as ReturnType<typeof createOctokit>);

    await expect(
      publishFromManifest(42, { projectDir: '/test', verbose: false, quiet: false, json: false }),
    ).rejects.toThrow(/manifest not found/);
  });

  it('publishes using manifest notes when editableNotes is disabled', async () => {
    const { createOctokit } = await import('../../src/github.js');
    const { mocks, octokit } = createMockOctokit();
    const manifestBody = serializeManifest(baseManifest);
    mocks.paginate.iterator.mockReturnValue({
      async *[Symbol.asyncIterator]() {
        yield { data: [{ id: 1, body: manifestBody }] };
      },
    });
    vi.mocked(createOctokit).mockReturnValue(octokit as unknown as ReturnType<typeof createOctokit>);

    const { runPublishStep } = await import('../../src/steps.js');
    vi.mocked(runPublishStep).mockResolvedValue({ publishSucceeded: true } as unknown as Awaited<
      ReturnType<typeof runPublishStep>
    >);

    const result = await publishFromManifest(42, {
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

  it('uses edited notes from PR body when editableNotes is enabled', async () => {
    const { loadConfig } = await import('@releasekit/config');
    vi.mocked(loadConfig).mockReturnValue({
      ci: { standingPr: { branch: 'release/next', deleteBranchOnMerge: true, editableNotes: true } },
      git: { branch: 'main' },
    } as ReturnType<typeof loadConfig>);

    const editedBody = [
      '<!-- releasekit-editable-start -->',
      '### Release Notes',
      '',
      '#### @scope/core — 1.2.3',
      '',
      '- hand-crafted release note',
      '<!-- releasekit-editable-end -->',
    ].join('\n');

    const { createOctokit } = await import('../../src/github.js');
    const { mocks, octokit } = createMockOctokit();
    const manifestBody = serializeManifest(baseManifest);
    mocks.paginate.iterator.mockReturnValue({
      async *[Symbol.asyncIterator]() {
        yield { data: [{ id: 1, body: manifestBody }] };
      },
    });
    mocks.pullsGet.mockResolvedValue({ data: { body: editedBody } });
    vi.mocked(createOctokit).mockReturnValue(octokit as unknown as ReturnType<typeof createOctokit>);

    const { runPublishStep } = await import('../../src/steps.js');
    vi.mocked(runPublishStep).mockResolvedValue({ publishSucceeded: true } as unknown as Awaited<
      ReturnType<typeof runPublishStep>
    >);

    await publishFromManifest(42, { projectDir: '/test', verbose: false, quiet: false, json: false });

    expect(vi.mocked(runPublishStep)).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ '@scope/core': '- hand-crafted release note' }),
      expect.anything(),
    );
  });

  it('falls back to manifest notes for packages missing from edited section', async () => {
    const { loadConfig } = await import('@releasekit/config');
    vi.mocked(loadConfig).mockReturnValue({
      ci: { standingPr: { branch: 'release/next', deleteBranchOnMerge: true, editableNotes: true } },
      git: { branch: 'main' },
    } as ReturnType<typeof loadConfig>);

    // editedBody has no package headings at all
    const editedBody = [
      '<!-- releasekit-editable-start -->',
      '### Release Notes',
      '',
      'Some text without package headings.',
      '<!-- releasekit-editable-end -->',
    ].join('\n');

    const { createOctokit } = await import('../../src/github.js');
    const { mocks, octokit } = createMockOctokit();
    const manifestBody = serializeManifest(baseManifest);
    mocks.paginate.iterator.mockReturnValue({
      async *[Symbol.asyncIterator]() {
        yield { data: [{ id: 1, body: manifestBody }] };
      },
    });
    mocks.pullsGet.mockResolvedValue({ data: { body: editedBody } });
    vi.mocked(createOctokit).mockReturnValue(octokit as unknown as ReturnType<typeof createOctokit>);

    const { runPublishStep } = await import('../../src/steps.js');
    vi.mocked(runPublishStep).mockResolvedValue({ publishSucceeded: true } as unknown as Awaited<
      ReturnType<typeof runPublishStep>
    >);

    await publishFromManifest(42, { projectDir: '/test', verbose: false, quiet: false, json: false });

    // Should still use original manifest notes since edited section has no pkg headings
    expect(vi.mocked(runPublishStep)).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ '@scope/core': baseManifest.releaseNotes['@scope/core'] }),
      expect.anything(),
    );
  });
});

describe('runStandingPRMerge', () => {
  const originalEnv = { ...process.env };

  beforeEach(async () => {
    vi.resetAllMocks();
    process.env.GITHUB_REPOSITORY = 'owner/repo';
    process.env.GITHUB_TOKEN = 'test-token';

    const { loadConfig } = await import('@releasekit/config');
    vi.mocked(loadConfig).mockReturnValue({
      ci: {
        standingPr: { branch: 'release/next', mergeMethod: 'merge', deleteBranchOnMerge: true },
      },
      git: { branch: 'main' },
    } as ReturnType<typeof loadConfig>);

    const { execSync } = await import('node:child_process');
    vi.mocked(execSync).mockReturnValue('abc123\n');
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('should return null when no GitHub context available', async () => {
    delete process.env.GITHUB_REPOSITORY;
    delete process.env.GITHUB_TOKEN;

    const result = await runStandingPRMerge(
      { projectDir: '/test', verbose: false, quiet: false, json: false },
      { publish: false },
    );

    expect(result).toBeNull();
  });

  it('should return null when no open standing PR found', async () => {
    const { createOctokit } = await import('../../src/github.js');
    const { mocks, octokit } = createMockOctokit();
    mocks.pullsList.mockResolvedValue({ data: [] });
    vi.mocked(createOctokit).mockReturnValue(octokit as unknown as ReturnType<typeof createOctokit>);

    const result = await runStandingPRMerge(
      { projectDir: '/test', verbose: false, quiet: false, json: false },
      { publish: false },
    );

    expect(result).toBeNull();
    expect(mocks.pullsMerge).not.toHaveBeenCalled();
  });

  it('should call pulls.merge with mergeMethod from config', async () => {
    const { loadConfig } = await import('@releasekit/config');
    vi.mocked(loadConfig).mockReturnValue({
      ci: {
        standingPr: { branch: 'release/next', mergeMethod: 'squash', deleteBranchOnMerge: true },
      },
      git: { branch: 'main' },
    } as ReturnType<typeof loadConfig>);

    const { createOctokit } = await import('../../src/github.js');
    const { mocks, octokit } = createMockOctokit();
    mocks.pullsList.mockResolvedValue({
      data: [{ number: 42, html_url: 'https://github.com/owner/repo/pull/42' }],
    });
    vi.mocked(createOctokit).mockReturnValue(octokit as unknown as ReturnType<typeof createOctokit>);

    await runStandingPRMerge({ projectDir: '/test', verbose: false, quiet: false, json: false }, { publish: false });

    expect(mocks.pullsMerge).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: 'owner',
        repo: 'repo',
        pull_number: 42,
        merge_method: 'squash',
      }),
    );
  });

  it('should default to merge method when config omits mergeMethod', async () => {
    const { loadConfig } = await import('@releasekit/config');
    vi.mocked(loadConfig).mockReturnValue({
      ci: {
        standingPr: { branch: 'release/next' }, // no mergeMethod
      },
      git: { branch: 'main' },
    } as ReturnType<typeof loadConfig>);

    const { createOctokit } = await import('../../src/github.js');
    const { mocks, octokit } = createMockOctokit();
    mocks.pullsList.mockResolvedValue({
      data: [{ number: 42, html_url: 'https://github.com/owner/repo/pull/42' }],
    });
    vi.mocked(createOctokit).mockReturnValue(octokit as unknown as ReturnType<typeof createOctokit>);

    await runStandingPRMerge({ projectDir: '/test', verbose: false, quiet: false, json: false }, { publish: false });

    expect(mocks.pullsMerge).toHaveBeenCalledWith(
      expect.objectContaining({
        merge_method: 'merge',
      }),
    );
  });

  it('should throw clear error message on 405 response', async () => {
    const { createOctokit } = await import('../../src/github.js');
    const { mocks, octokit } = createMockOctokit();
    mocks.pullsList.mockResolvedValue({
      data: [{ number: 42, html_url: 'https://github.com/owner/repo/pull/42' }],
    });
    mocks.pullsMerge.mockRejectedValue({
      status: 405,
      response: { data: { message: 'Required status checks have not passed' } },
    });
    vi.mocked(createOctokit).mockReturnValue(octokit as unknown as ReturnType<typeof createOctokit>);

    await expect(
      runStandingPRMerge({ projectDir: '/test', verbose: false, quiet: false, json: false }, { publish: false }),
    ).rejects.toThrow(/GitHub rejected the merge/);

    await expect(
      runStandingPRMerge({ projectDir: '/test', verbose: false, quiet: false, json: false }, { publish: false }),
    ).rejects.toThrow(/Required status checks have not passed/);
  });

  it('should re-throw non-405 errors unchanged', async () => {
    const { createOctokit } = await import('../../src/github.js');
    const { mocks, octokit } = createMockOctokit();
    mocks.pullsList.mockResolvedValue({
      data: [{ number: 42, html_url: 'https://github.com/owner/repo/pull/42' }],
    });
    const originalError = new Error('Network error');
    mocks.pullsMerge.mockRejectedValue(originalError);
    vi.mocked(createOctokit).mockReturnValue(octokit as unknown as ReturnType<typeof createOctokit>);

    await expect(
      runStandingPRMerge({ projectDir: '/test', verbose: false, quiet: false, json: false }, { publish: false }),
    ).rejects.toThrow('Network error');
  });

  it('should return null without publishing when publish flag is false', async () => {
    const { createOctokit } = await import('../../src/github.js');
    const { mocks, octokit } = createMockOctokit();
    mocks.pullsList.mockResolvedValue({
      data: [{ number: 42, html_url: 'https://github.com/owner/repo/pull/42' }],
    });
    vi.mocked(createOctokit).mockReturnValue(octokit as unknown as ReturnType<typeof createOctokit>);

    const result = await runStandingPRMerge(
      { projectDir: '/test', verbose: false, quiet: false, json: false },
      { publish: false },
    );

    expect(result).toBeNull();
  });

  it('should call publishFromManifest when publish flag is true and manifest exists', async () => {
    const { createOctokit } = await import('../../src/github.js');
    const { mocks, octokit } = createMockOctokit();
    mocks.pullsList.mockResolvedValue({
      data: [{ number: 42, html_url: 'https://github.com/owner/repo/pull/42' }],
    });
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

    const result = await runStandingPRMerge(
      { projectDir: '/test', verbose: false, quiet: false, json: false },
      { publish: true },
    );

    expect(result).not.toBeNull();
    expect(vi.mocked(runPublishStep)).toHaveBeenCalledWith(
      expect.objectContaining({ updates: baseManifest.versionOutput.updates }),
      expect.objectContaining({ skipGitCommit: true }),
      baseManifest.releaseNotes,
      baseManifest.notesFiles,
    );
  });

  it('should delete branch after publish when deleteBranchOnMerge is true', async () => {
    const { createOctokit } = await import('../../src/github.js');
    const { mocks, octokit } = createMockOctokit();
    mocks.pullsList.mockResolvedValue({
      data: [{ number: 42, html_url: 'https://github.com/owner/repo/pull/42' }],
    });
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

    await runStandingPRMerge({ projectDir: '/test', verbose: false, quiet: false, json: false }, { publish: true });

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

    const { createOctokit } = await import('../../src/github.js');
    const { mocks, octokit } = createMockOctokit();
    mocks.pullsList.mockResolvedValue({
      data: [{ number: 42, html_url: 'https://github.com/owner/repo/pull/42' }],
    });
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

    await runStandingPRMerge({ projectDir: '/test', verbose: false, quiet: false, json: false }, { publish: true });

    const deleteCalls = vi
      .mocked(execSync)
      .mock.calls.filter((c) => typeof c[0] === 'string' && c[0].includes('--delete'));
    expect(deleteCalls).toHaveLength(0);
  });

  it('should delete branch even when publish flag is false and deleteBranchOnMerge is true', async () => {
    const { createOctokit } = await import('../../src/github.js');
    const { mocks, octokit } = createMockOctokit();
    mocks.pullsList.mockResolvedValue({
      data: [{ number: 42, html_url: 'https://github.com/owner/repo/pull/42' }],
    });
    vi.mocked(createOctokit).mockReturnValue(octokit as unknown as ReturnType<typeof createOctokit>);

    const { execSync } = await import('node:child_process');

    await runStandingPRMerge({ projectDir: '/test', verbose: false, quiet: false, json: false }, { publish: false });

    const deleteCalls = vi
      .mocked(execSync)
      .mock.calls.filter((c) => typeof c[0] === 'string' && c[0].includes('--delete'));
    expect(deleteCalls).toHaveLength(1);
    expect(deleteCalls[0][0]).toContain('release/next');
  });
});
