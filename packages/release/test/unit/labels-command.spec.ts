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
  forgeFor: vi.fn(),
}));

import { EXIT_CODES } from '@releasekit/core';
import { createFakeForge } from '@releasekit/forge';
import { runLabelsSync } from '../../src/commands/labels-command.js';
import { forgeFor } from '../../src/github.js';

/** A forge whose repo already has `existingLabels` — `createLabel` resolves 'exists' for those. */
function mockForge(existingLabels: string[] = []) {
  const forge = createFakeForge({ labelNames: existingLabels });
  vi.mocked(forgeFor).mockReturnValue(forge);
  return forge;
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
    const forge = mockForge([]);

    await runLabelsSync({ repo: 'owner/repo' });

    // Default config implies the 8 reserved labels + the default 'release' standing-PR label.
    expect(forge.createdLabels.length).toBeGreaterThan(0);
    const created = forge.createdLabels.map((l) => l.name);
    expect(created).toEqual(expect.arrayContaining(['bump:minor', 'release:graduate', 'release:skip', 'release']));
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('should be idempotent — 422 already-exists does not fail the run', async () => {
    // The forge resolves an existing label to 'exists' rather than throwing — the run succeeds.
    mockForge(['bump:minor']);

    await expect(runLabelsSync({ repo: 'owner/repo' })).resolves.toBeUndefined();
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('should exit non-zero in --check mode when labels are missing', async () => {
    const forge = mockForge([]); // repo has no labels → all missing

    await runLabelsSync({ repo: 'owner/repo', check: true });

    expect(exitSpy).toHaveBeenCalledWith(EXIT_CODES.GENERAL_ERROR);
    // --check performs NO mutations.
    expect(forge.createdLabels).toHaveLength(0);
  });

  it('should not exit in --check mode when all labels are present', async () => {
    const forge = mockForge([
      'bump:patch',
      'bump:minor',
      'bump:major',
      'release:graduate',
      'channel:prerelease',
      'release:skip',
      'release:immediate',
      'release:retry',
      'release:preview-notes',
      'release:with-prerequisites',
      'release',
    ]);

    await runLabelsSync({ repo: 'owner/repo', check: true });

    expect(exitSpy).not.toHaveBeenCalled();
    expect(forge.createdLabels).toHaveLength(0);
  });

  it('should throw when no GitHub token is available', async () => {
    delete process.env.GITHUB_TOKEN;
    delete process.env.GH_TOKEN;

    await expect(runLabelsSync({ repo: 'owner/repo' })).rejects.toThrow(/token/i);
  });
});
