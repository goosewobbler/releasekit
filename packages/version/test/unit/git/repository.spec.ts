import * as fs from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as commandExecutor from '../../../src/git/commandExecutor.js';
import { getCurrentBranch, isGitRepository } from '../../../src/git/repository.js';

// Mock the dependencies
vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  statSync: vi.fn(() => ({
    isDirectory: vi.fn(),
  })),
}));

vi.mock('../../../src/git/commandExecutor.js', () => ({
  execSync: vi.fn(),
}));

describe('repository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('isGitRepository', () => {
    const testDir = '/path/to/repo';
    const gitDir = join(testDir, '.git');

    it('should return false if .git directory does not exist', () => {
      // Setup
      vi.mocked(fs.existsSync, { partial: true }).mockReturnValue(false);

      // Execute
      const result = isGitRepository(testDir);

      // Verify
      expect(result).toBe(false);
      expect(fs.existsSync).toHaveBeenCalledWith(gitDir);
      expect(fs.statSync).not.toHaveBeenCalled();
      expect(commandExecutor.execSync).not.toHaveBeenCalled();
    });

    it('should return false if .git is not a directory', () => {
      // Setup
      vi.mocked(fs.existsSync, { partial: true }).mockReturnValue(true);
      const mockStatSync = vi.mocked(fs.statSync);
      mockStatSync.mockImplementation(() => {
        return {
          isDirectory: () => false,
        } as unknown as fs.Stats;
      });

      // Execute
      const result = isGitRepository(testDir);

      // Verify
      expect(result).toBe(false);
      expect(fs.existsSync).toHaveBeenCalledWith(gitDir);
      expect(fs.statSync).toHaveBeenCalledWith(gitDir);
      expect(commandExecutor.execSync).not.toHaveBeenCalled();
    });

    it('should return false if git command fails', () => {
      // Setup
      vi.mocked(fs.existsSync, { partial: true }).mockReturnValue(true);
      vi.mocked(fs.statSync, { partial: true }).mockImplementation(() => {
        return {
          isDirectory: () => true,
        } as unknown as fs.Stats;
      });
      vi.mocked(commandExecutor.execSync, { partial: true }).mockImplementation(() => {
        throw new Error('git command failed');
      });

      // Execute
      const result = isGitRepository(testDir);

      // Verify
      expect(result).toBe(false);
      expect(fs.existsSync).toHaveBeenCalledWith(gitDir);
      expect(fs.statSync).toHaveBeenCalledWith(gitDir);
      expect(commandExecutor.execSync).toHaveBeenCalledWith('git rev-parse --is-inside-work-tree', {
        cwd: testDir,
      });
    });

    it('should return true if directory is a git repository', () => {
      // Setup
      vi.mocked(fs.existsSync, { partial: true }).mockReturnValue(true);
      vi.mocked(fs.statSync, { partial: true }).mockImplementation(() => {
        return {
          isDirectory: () => true,
        } as unknown as fs.Stats;
      });
      vi.mocked(commandExecutor.execSync, { partial: true }).mockReturnValue(Buffer.from('true'));

      // Execute
      const result = isGitRepository(testDir);

      // Verify
      expect(result).toBe(true);
      expect(fs.existsSync).toHaveBeenCalledWith(gitDir);
      expect(fs.statSync).toHaveBeenCalledWith(gitDir);
      expect(commandExecutor.execSync).toHaveBeenCalledWith('git rev-parse --is-inside-work-tree', {
        cwd: testDir,
      });
    });
  });

  describe('getCurrentBranch', () => {
    it('should return the current branch name', () => {
      // Setup
      vi.mocked(commandExecutor.execSync, { partial: true }).mockReturnValue(Buffer.from('main\n'));

      // Execute
      const result = getCurrentBranch();

      // Verify
      expect(result).toBe('main');
      expect(commandExecutor.execSync).toHaveBeenCalledWith('git rev-parse --abbrev-ref HEAD');
    });
  });
});
