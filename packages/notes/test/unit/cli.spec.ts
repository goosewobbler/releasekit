import * as fs from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:fs');
vi.mock('@releasekit/config');
vi.mock('../../src/core/pipeline.js');
vi.mock('../../src/input/version-output.js');
vi.mock('@releasekit/core');
vi.mock('../../src/monorepo/aggregator.js', () => ({
  detectMonorepo: vi.fn(),
}));

import { loadConfig } from '@releasekit/config';
import { createNotesCommand } from '../../src/cli.js';
import { runPipeline } from '../../src/core/pipeline.js';
import { parseVersionOutput } from '../../src/input/version-output.js';
import { detectMonorepo } from '../../src/monorepo/aggregator.js';

describe('createNotesCommand', () => {
  beforeEach(() => {
    vi.mocked(runPipeline).mockResolvedValue({ packageNotes: {}, files: [] });
    vi.mocked(loadConfig).mockReturnValue({} as never);
    vi.mocked(fs.readFileSync).mockImplementation(() => '{"packages": []}' as never);
    vi.mocked(parseVersionOutput).mockReturnValue({ source: 'version', packages: [] });
    vi.mocked(detectMonorepo).mockReturnValue({ isMonorepo: false, packagesPath: '' });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('generate command', () => {
    it('should pass empty config when no config file exists and no flags set', async () => {
      vi.mocked(loadConfig).mockReturnValue(undefined as never);

      await createNotesCommand().parse(['node', 'test', 'generate', '-i', 'input.json']);

      expect(runPipeline).toHaveBeenCalledWith(expect.anything(), {}, false);
    });

    it('should disable changelog with --no-changelog', async () => {
      vi.mocked(loadConfig).mockReturnValue(undefined as never);

      await createNotesCommand().parse(['node', 'test', 'generate', '-i', 'input.json', '--no-changelog']);

      expect(runPipeline).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ changelog: false }), false);
    });

    it('should set changelog mode with --changelog-mode', async () => {
      vi.mocked(loadConfig).mockReturnValue(undefined as never);

      await createNotesCommand().parse(['node', 'test', 'generate', '-i', 'input.json', '--changelog-mode', 'root']);

      expect(runPipeline).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ changelog: expect.objectContaining({ mode: 'root' }) }),
        false,
      );
    });

    it('should set release notes mode with --release-notes-mode', async () => {
      vi.mocked(loadConfig).mockReturnValue(undefined as never);

      await createNotesCommand().parse([
        'node',
        'test',
        'generate',
        '-i',
        'input.json',
        '--release-notes-mode',
        'root',
      ]);

      expect(runPipeline).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ releaseNotes: expect.objectContaining({ mode: 'root' }) }),
        false,
      );
    });

    it('should pass --dry-run flag to pipeline', async () => {
      vi.mocked(loadConfig).mockReturnValue(undefined as never);

      await createNotesCommand().parse(['node', 'test', 'generate', '-i', 'input.json', '--dry-run']);

      expect(runPipeline).toHaveBeenCalledWith(expect.anything(), expect.anything(), true);
    });
  });

  describe('init subcommand', () => {
    it('should write mode: root for a single-package repo', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      vi.mocked(fs.writeFileSync).mockImplementation(() => undefined);
      vi.mocked(detectMonorepo).mockReturnValue({ isMonorepo: false, packagesPath: '' });

      await createNotesCommand().parseAsync(['node', 'test', 'init']);

      const written = vi.mocked(fs.writeFileSync).mock.calls[0]?.[1] as string;
      expect(JSON.parse(written)).toMatchObject({ notes: { changelog: { mode: 'root' } } });
    });

    it('should write mode: packages for a monorepo', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      vi.mocked(fs.writeFileSync).mockImplementation(() => undefined);
      vi.mocked(detectMonorepo).mockReturnValue({ isMonorepo: true, packagesPath: 'packages' });

      await createNotesCommand().parseAsync(['node', 'test', 'init']);

      const written = vi.mocked(fs.writeFileSync).mock.calls[0]?.[1] as string;
      expect(JSON.parse(written)).toMatchObject({ notes: { changelog: { mode: 'packages' } } });
    });

    it('should write mode: root when detection throws', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      vi.mocked(fs.writeFileSync).mockImplementation(() => undefined);
      vi.mocked(detectMonorepo).mockImplementation(() => {
        throw new Error('fs error');
      });

      await createNotesCommand().parseAsync(['node', 'test', 'init']);

      const written = vi.mocked(fs.writeFileSync).mock.calls[0]?.[1] as string;
      expect(JSON.parse(written)).toMatchObject({ notes: { changelog: { mode: 'root' } } });
    });

    it('should exit with an error when config already exists and --force is not set', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

      createNotesCommand().parse(['node', 'test', 'init']);

      expect(mockExit).toHaveBeenCalledWith(expect.any(Number));
      mockExit.mockRestore();
    });
  });
});
