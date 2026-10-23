import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@releasekit/version', () => ({ loadConfig: vi.fn() }));
vi.mock('@releasekit/notes', () => ({
  loadConfig: vi.fn(() => ({ releaseNotes: false })),
  runPipeline: vi.fn(),
  versionOutputToChangelogInput: vi.fn(),
}));
vi.mock('@releasekit/publish', () => ({ loadConfig: vi.fn(() => ({ githubRelease: {} })) }));

import { loadConfig as loadPublishConfig } from '@releasekit/publish';
import { createBackfillCommand } from '../../../src/commands/backfill-command.js';

describe('backfill command', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should load the publish config from --config', async () => {
    vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('exit');
    });

    await expect(createBackfillCommand().parseAsync(['--config', 'custom.json'], { from: 'user' })).rejects.toThrow(
      'exit',
    );

    expect(loadPublishConfig).toHaveBeenCalledWith({ cwd: process.cwd(), configPath: 'custom.json' });
  });
});
