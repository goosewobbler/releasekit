import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runRefreshAfterRelease } from '../../src/preview/refresh.js';

const mockLoadCIConfig = vi.fn();

vi.mock('@releasekit/config', () => ({
  loadCIConfig: (...args: unknown[]) => mockLoadCIConfig(...args),
}));

vi.mock('@releasekit/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@releasekit/core')>();
  return { ...actual, info: vi.fn(), warn: vi.fn() };
});

const mockRunStandingPRUpdate = vi.fn();

vi.mock('../../src/standing-pr/standing-pr.js', () => ({
  runStandingPRUpdate: (...args: unknown[]) => mockRunStandingPRUpdate(...args),
}));

describe('runRefreshAfterRelease', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRunStandingPRUpdate.mockResolvedValue({ action: 'noop' });
  });

  it('should do nothing outside the standing-pr strategy', async () => {
    mockLoadCIConfig.mockReturnValue({
      releaseStrategy: 'direct',
      prPreview: { enabled: true, markStaleAfterRelease: true },
    });

    await runRefreshAfterRelease({ projectDir: '/p' });

    expect(mockRunStandingPRUpdate).not.toHaveBeenCalled();
  });

  it('should reconcile the standing PR', async () => {
    mockLoadCIConfig.mockReturnValue({
      releaseStrategy: 'standing-pr',
      prPreview: { enabled: true, markStaleAfterRelease: true },
    });

    await runRefreshAfterRelease({ projectDir: '/p' });

    expect(mockRunStandingPRUpdate).toHaveBeenCalledWith(expect.objectContaining({ reconcile: true }));
  });

  it('should propagate a reconcile failure', async () => {
    mockLoadCIConfig.mockReturnValue({ releaseStrategy: 'standing-pr' });
    mockRunStandingPRUpdate.mockRejectedValue(new Error('reconcile failed'));

    await expect(runRefreshAfterRelease({ projectDir: '/p' })).rejects.toThrow('reconcile failed');
  });
});
