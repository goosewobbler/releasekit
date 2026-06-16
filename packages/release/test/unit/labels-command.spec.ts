import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@releasekit/config', () => ({
  loadCIConfig: vi.fn().mockReturnValue(undefined),
}));
vi.mock('@releasekit/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@releasekit/core')>();
  return {
    ...actual,
    info: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
  };
});
vi.mock('../../src/github.js', () => ({
  createOctokit: vi.fn(),
}));

import { EXIT_CODES } from '@releasekit/core';
import { runLabelsSync } from '../../src/commands/labels-command.js';
import { createOctokit } from '../../src/github.js';

function mockOctokit(existingLabels: string[] = [], failures: Record<string, number> = {}) {
  const createLabel = vi.fn(async ({ name }: { name: string }) => {
    const status = failures[name];
    if (status) {
      const err = new Error(`HTTP ${status}`) as Error & {
        status: number;
        response?: { data: { errors?: { code: string }[] } };
      };
      err.status = status;
      // GitHub's 422 for "already exists" carries errors[0].code === 'already_exists';
      // other 422s are real validation failures and must surface. Mock both as 422-with-body
      // so the test exercises the existing/regression path the same way the real API would.
      if (status === 422) {
        err.response = { data: { errors: [{ code: 'already_exists' }] } };
      }
      throw err;
    }
    return { data: {} };
  });
  const iterator = vi.fn().mockReturnValue({
    async *[Symbol.asyncIterator]() {
      yield { data: existingLabels.map((name) => ({ name })) };
    },
  });
  return {
    octokit: {
      paginate: { iterator },
      rest: { issues: { createLabel, listLabelsForRepo: vi.fn() } },
    },
    createLabel,
  };
}

describe('runLabelsSync', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    process.env.GITHUB_TOKEN = 'token';
    process.env.GITHUB_REPOSITORY = 'owner/repo';
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
  });

  afterEach(() => {
    vi.clearAllMocks();
    exitSpy.mockRestore();
    delete process.env.GITHUB_TOKEN;
    delete process.env.GITHUB_REPOSITORY;
    delete process.env.GH_TOKEN;
  });

  it('should create missing labels in sync mode', async () => {
    const { octokit, createLabel } = mockOctokit([]);
    vi.mocked(createOctokit).mockReturnValue(octokit as never);

    await runLabelsSync({ repo: 'owner/repo' });

    // Default config implies the 8 reserved labels + the default 'release' standing-PR label.
    expect(createLabel).toHaveBeenCalled();
    const created = createLabel.mock.calls.map((c) => (c[0] as { name: string }).name);
    expect(created).toEqual(expect.arrayContaining(['bump:minor', 'channel:stable', 'release:skip', 'release']));
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('should be idempotent — 422 already-exists does not fail the run', async () => {
    const { octokit } = mockOctokit([], { 'bump:minor': 422 });
    vi.mocked(createOctokit).mockReturnValue(octokit as never);

    await expect(runLabelsSync({ repo: 'owner/repo' })).resolves.toBeUndefined();
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('should exit non-zero in --check mode when labels are missing', async () => {
    const { octokit, createLabel } = mockOctokit([]); // repo has no labels → all missing
    vi.mocked(createOctokit).mockReturnValue(octokit as never);

    await runLabelsSync({ repo: 'owner/repo', check: true });

    expect(exitSpy).toHaveBeenCalledWith(EXIT_CODES.GENERAL_ERROR);
    // --check performs NO mutations.
    expect(createLabel).not.toHaveBeenCalled();
  });

  it('should not exit in --check mode when all labels are present', async () => {
    const { octokit, createLabel } = mockOctokit([
      'bump:patch',
      'bump:minor',
      'bump:major',
      'channel:stable',
      'channel:prerelease',
      'release:skip',
      'release:immediate',
      'release:retry',
      'release:preview-notes',
      'release',
    ]);
    vi.mocked(createOctokit).mockReturnValue(octokit as never);

    await runLabelsSync({ repo: 'owner/repo', check: true });

    expect(exitSpy).not.toHaveBeenCalled();
    expect(createLabel).not.toHaveBeenCalled();
  });

  it('should throw when no GitHub token is available', async () => {
    delete process.env.GITHUB_TOKEN;
    delete process.env.GH_TOKEN;

    await expect(runLabelsSync({ repo: 'owner/repo' })).rejects.toThrow(/token/i);
  });
});
