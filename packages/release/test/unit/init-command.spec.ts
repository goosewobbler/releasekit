import * as fs from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:fs');
vi.mock('@releasekit/core');
vi.mock('@releasekit/notes', () => ({
  detectMonorepo: vi.fn(),
}));

import { EXIT_CODES } from '@releasekit/core';
import { detectMonorepo } from '@releasekit/notes';
import { createInitCommand } from '../../src/commands/init-command.js';

function parseInit(args: string[] = []) {
  return createInitCommand().parseAsync(['node', 'init', ...args]);
}

describe('createInitCommand', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('monorepo detection', () => {
    it('should write mode: root for a single-package repo', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      vi.mocked(fs.readFileSync).mockReturnValue('{"name":"my-pkg"}' as never);
      vi.mocked(fs.writeFileSync).mockImplementation(() => undefined);
      vi.mocked(detectMonorepo).mockReturnValue({ isMonorepo: false, packagesPath: '' });

      await parseInit();

      const written = vi.mocked(fs.writeFileSync).mock.calls[0]?.[1] as string;
      expect(JSON.parse(written)).toMatchObject({ notes: { changelog: { mode: 'root' } } });
    });

    it('should write mode: packages for a monorepo', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      vi.mocked(fs.readFileSync).mockReturnValue('{"name":"my-pkg"}' as never);
      vi.mocked(fs.writeFileSync).mockImplementation(() => undefined);
      vi.mocked(detectMonorepo).mockReturnValue({ isMonorepo: true, packagesPath: 'packages' });

      await parseInit();

      const written = vi.mocked(fs.writeFileSync).mock.calls[0]?.[1] as string;
      expect(JSON.parse(written)).toMatchObject({ notes: { changelog: { mode: 'packages' } } });
    });

    it('should write mode: root when detection throws', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      vi.mocked(fs.readFileSync).mockReturnValue('{"name":"my-pkg"}' as never);
      vi.mocked(fs.writeFileSync).mockImplementation(() => undefined);
      vi.mocked(detectMonorepo).mockImplementation(() => {
        throw new Error('fs error');
      });

      await parseInit();

      const written = vi.mocked(fs.writeFileSync).mock.calls[0]?.[1] as string;
      expect(JSON.parse(written)).toMatchObject({ notes: { changelog: { mode: 'root' } } });
    });
  });

  describe('npm access', () => {
    it('should include access: public for a scoped package', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      vi.mocked(fs.readFileSync).mockReturnValue('{"name":"@scope/my-pkg"}' as never);
      vi.mocked(fs.writeFileSync).mockImplementation(() => undefined);
      vi.mocked(detectMonorepo).mockReturnValue({ isMonorepo: false, packagesPath: '' });

      await parseInit();

      const written = vi.mocked(fs.writeFileSync).mock.calls[0]?.[1] as string;
      expect(JSON.parse(written)).toMatchObject({ publish: { npm: { access: 'public' } } });
    });

    it('should omit access for an unscoped package', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      vi.mocked(fs.readFileSync).mockReturnValue('{"name":"my-pkg"}' as never);
      vi.mocked(fs.writeFileSync).mockImplementation(() => undefined);
      vi.mocked(detectMonorepo).mockReturnValue({ isMonorepo: false, packagesPath: '' });

      await parseInit();

      const written = vi.mocked(fs.writeFileSync).mock.calls[0]?.[1] as string;
      expect(JSON.parse(written).publish.npm).not.toHaveProperty('access');
    });

    it('should omit access when package.json is unreadable', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      vi.mocked(fs.readFileSync).mockImplementation(() => {
        throw new Error('ENOENT');
      });
      vi.mocked(fs.writeFileSync).mockImplementation(() => undefined);
      vi.mocked(detectMonorepo).mockReturnValue({ isMonorepo: false, packagesPath: '' });

      await parseInit();

      const written = vi.mocked(fs.writeFileSync).mock.calls[0]?.[1] as string;
      expect(JSON.parse(written).publish.npm).not.toHaveProperty('access');
    });
  });

  describe('existing config', () => {
    it('should exit with an error when config already exists and --force is not set', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

      createInitCommand().parse(['node', 'init']);

      expect(mockExit).toHaveBeenCalledWith(EXIT_CODES.GENERAL_ERROR);
      expect(vi.mocked(fs.writeFileSync)).not.toHaveBeenCalled();
      mockExit.mockRestore();
    });

    it('should overwrite when --force is set', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue('{"name":"my-pkg"}' as never);
      vi.mocked(fs.writeFileSync).mockImplementation(() => undefined);
      vi.mocked(detectMonorepo).mockReturnValue({ isMonorepo: false, packagesPath: '' });

      await parseInit(['--force']);

      expect(vi.mocked(fs.writeFileSync)).toHaveBeenCalled();
    });
  });
});
