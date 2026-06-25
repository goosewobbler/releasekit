import * as fs from 'node:fs';
import { join } from 'node:path';
import { createFakeGit } from '@releasekit/git';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getCurrentBranch, isGitRepository } from '../../../src/git/repository.js';

// Mock fs so the `.git` directory pre-checks are controllable; the git call itself goes to a FakeGit.
vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  statSync: vi.fn(() => ({
    isDirectory: vi.fn(),
  })),
}));

describe('repository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('isGitRepository', () => {
    const testDir = '/path/to/repo';
    const gitDir = join(testDir, '.git');

    it('should return false if .git directory does not exist', async () => {
      vi.mocked(fs.existsSync, { partial: true }).mockReturnValue(false);

      const result = await isGitRepository(testDir, createFakeGit({ isRepo: true }));

      expect(result).toBe(false);
      expect(fs.existsSync).toHaveBeenCalledWith(gitDir);
      expect(fs.statSync).not.toHaveBeenCalled();
    });

    it('should return false if .git is not a directory', async () => {
      vi.mocked(fs.existsSync, { partial: true }).mockReturnValue(true);
      vi.mocked(fs.statSync).mockImplementation(() => ({ isDirectory: () => false }) as unknown as fs.Stats);

      const result = await isGitRepository(testDir, createFakeGit({ isRepo: true }));

      expect(result).toBe(false);
      expect(fs.existsSync).toHaveBeenCalledWith(gitDir);
      expect(fs.statSync).toHaveBeenCalledWith(gitDir);
    });

    it('should return false if git reports not inside a work tree', async () => {
      vi.mocked(fs.existsSync, { partial: true }).mockReturnValue(true);
      vi.mocked(fs.statSync).mockImplementation(() => ({ isDirectory: () => true }) as unknown as fs.Stats);

      const result = await isGitRepository(testDir, createFakeGit({ isRepo: false }));

      expect(result).toBe(false);
      expect(fs.existsSync).toHaveBeenCalledWith(gitDir);
      expect(fs.statSync).toHaveBeenCalledWith(gitDir);
    });

    it('should return true if directory is a git repository', async () => {
      vi.mocked(fs.existsSync, { partial: true }).mockReturnValue(true);
      vi.mocked(fs.statSync).mockImplementation(() => ({ isDirectory: () => true }) as unknown as fs.Stats);

      const result = await isGitRepository(testDir, createFakeGit({ isRepo: true }));

      expect(result).toBe(true);
      expect(fs.existsSync).toHaveBeenCalledWith(gitDir);
      expect(fs.statSync).toHaveBeenCalledWith(gitDir);
    });
  });

  describe('getCurrentBranch', () => {
    it('should return the current branch name', async () => {
      const result = await getCurrentBranch(createFakeGit({ currentBranch: 'main' }));

      expect(result).toBe('main');
    });
  });
});
