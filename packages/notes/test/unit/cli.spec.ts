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
import { warn } from '@releasekit/core';
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

    it('should keep changelog disabled when --no-changelog and --template are combined', async () => {
      vi.mocked(loadConfig).mockReturnValue(undefined as never);

      await createNotesCommand().parse([
        'node',
        'test',
        'generate',
        '-i',
        'input.json',
        '--no-changelog',
        '--template',
        'my-template',
      ]);

      expect(runPipeline).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ changelog: false }), false);
    });

    it('should keep changelog disabled when --no-changelog and --engine are combined', async () => {
      vi.mocked(loadConfig).mockReturnValue(undefined as never);

      await createNotesCommand().parse([
        'node',
        'test',
        'generate',
        '-i',
        'input.json',
        '--no-changelog',
        '--engine',
        'handlebars',
      ]);

      expect(runPipeline).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ changelog: false }), false);
    });

    it('should warn when --template is ignored due to --no-changelog', async () => {
      vi.mocked(loadConfig).mockReturnValue(undefined as never);

      await createNotesCommand().parse([
        'node',
        'test',
        'generate',
        '-i',
        'input.json',
        '--no-changelog',
        '--template',
        'my-template',
      ]);

      expect(vi.mocked(warn)).toHaveBeenCalledWith(expect.stringContaining('--template'));
      expect(vi.mocked(warn)).toHaveBeenCalledWith(expect.stringContaining('--no-changelog'));
    });

    it('should warn when --engine is ignored due to --no-changelog', async () => {
      vi.mocked(loadConfig).mockReturnValue(undefined as never);

      await createNotesCommand().parse([
        'node',
        'test',
        'generate',
        '-i',
        'input.json',
        '--no-changelog',
        '--engine',
        'handlebars',
      ]);

      expect(vi.mocked(warn)).toHaveBeenCalledWith(expect.stringContaining('--engine'));
      expect(vi.mocked(warn)).toHaveBeenCalledWith(expect.stringContaining('--no-changelog'));
    });

    it('should not warn when --template is used without --no-changelog', async () => {
      vi.mocked(loadConfig).mockReturnValue(undefined as never);

      await createNotesCommand().parse(['node', 'test', 'generate', '-i', 'input.json', '--template', 'my-template']);

      expect(vi.mocked(warn)).not.toHaveBeenCalledWith(expect.stringContaining('--template'));
    });

    it('should default changelog mode to root when only --changelog-file is set', async () => {
      vi.mocked(loadConfig).mockReturnValue(undefined as never);

      await createNotesCommand().parse([
        'node',
        'test',
        'generate',
        '-i',
        'input.json',
        '--changelog-file',
        'CHANGES.md',
      ]);

      expect(runPipeline).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ changelog: expect.objectContaining({ mode: 'root', file: 'CHANGES.md' }) }),
        false,
      );
    });

    it('should default release notes mode to root when only --release-notes-file is set', async () => {
      vi.mocked(loadConfig).mockReturnValue(undefined as never);

      await createNotesCommand().parse([
        'node',
        'test',
        'generate',
        '-i',
        'input.json',
        '--release-notes-file',
        'NOTES.md',
      ]);

      expect(runPipeline).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ releaseNotes: expect.objectContaining({ mode: 'root', file: 'NOTES.md' }) }),
        false,
      );
    });

    it('should preserve --changelog-mode when combined with --changelog-file', async () => {
      vi.mocked(loadConfig).mockReturnValue(undefined as never);

      await createNotesCommand().parse([
        'node',
        'test',
        'generate',
        '-i',
        'input.json',
        '--changelog-mode',
        'packages',
        '--changelog-file',
        'CHANGES.md',
      ]);

      expect(runPipeline).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ changelog: expect.objectContaining({ mode: 'packages', file: 'CHANGES.md' }) }),
        false,
      );
    });

    it('should preserve --release-notes-mode when combined with --release-notes-file', async () => {
      vi.mocked(loadConfig).mockReturnValue(undefined as never);

      await createNotesCommand().parse([
        'node',
        'test',
        'generate',
        '-i',
        'input.json',
        '--release-notes-mode',
        'packages',
        '--release-notes-file',
        'NOTES.md',
      ]);

      expect(runPipeline).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ releaseNotes: expect.objectContaining({ mode: 'packages', file: 'NOTES.md' }) }),
        false,
      );
    });

    it('should set updateStrategy to regenerate with --regenerate', async () => {
      vi.mocked(loadConfig).mockReturnValue(undefined as never);

      await createNotesCommand().parse(['node', 'test', 'generate', '-i', 'input.json', '--regenerate']);

      expect(runPipeline).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ updateStrategy: 'regenerate' }),
        false,
      );
    });

    it('should wire --monorepo mode through to changelog mode', async () => {
      vi.mocked(loadConfig).mockReturnValue(undefined as never);

      await createNotesCommand().parse(['node', 'test', 'generate', '-i', 'input.json', '--monorepo', 'packages']);

      expect(runPipeline).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ changelog: expect.objectContaining({ mode: 'packages' }) }),
        false,
      );
    });

    it('should let --changelog-mode override --monorepo when both are set', async () => {
      vi.mocked(loadConfig).mockReturnValue(undefined as never);

      await createNotesCommand().parse([
        'node',
        'test',
        'generate',
        '-i',
        'input.json',
        '--monorepo',
        'packages',
        '--changelog-mode',
        'root',
      ]);

      expect(runPipeline).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ changelog: expect.objectContaining({ mode: 'root' }) }),
        false,
      );
    });

    it('should not enable releaseNotes when --monorepo is set but releaseNotes is not configured', async () => {
      vi.mocked(loadConfig).mockReturnValue(undefined as never);

      await createNotesCommand().parse(['node', 'test', 'generate', '-i', 'input.json', '--monorepo', 'packages']);

      expect(runPipeline).toHaveBeenCalledWith(
        expect.anything(),
        expect.not.objectContaining({ releaseNotes: expect.objectContaining({ mode: expect.anything() }) }),
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
