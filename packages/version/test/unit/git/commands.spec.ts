import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GitError, GitErrorCode } from '../../../src/errors/gitError.js';
import * as commandExecutor from '../../../src/git/commandExecutor.js';
// Import types only to avoid conflicts
import type { GitCommitOptions, GitProcessOptions, GitTagOptions } from '../../../src/git/commands.js';
import * as repository from '../../../src/git/repository.js';
import * as jsonOutput from '../../../src/utils/jsonOutput.js';
import * as logging from '../../../src/utils/logging.js';

// Mock dependencies
vi.mock('../../../src/git/commandExecutor.js');
vi.mock('../../../src/git/repository.js');
vi.mock('../../../src/utils/logging.js');
vi.mock('../../../src/utils/jsonOutput.js');
vi.mock('node:process', () => ({
  cwd: () => '/fake/path',
}));

// Import the actual commands module
import * as commands from '../../../src/git/commands.js';

describe('Git Commands', () => {
  beforeEach(() => {
    vi.resetAllMocks();

    // Mock repository check to return true by default
    vi.mocked(repository.isGitRepository, { partial: true }).mockReturnValue(true);
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  describe('Basic git operations', () => {
    it('executes gitAdd with correct command', async () => {
      const files = ['file1.js', 'file2.js'];
      const mockExecResult = { stdout: 'success', stderr: '' };

      vi.mocked(commandExecutor.execAsync, { partial: true }).mockResolvedValue(mockExecResult);

      const result = await commands.gitAdd(files);

      expect(commandExecutor.execAsync).toHaveBeenCalledWith('git add file1.js file2.js');
      expect(result).toBe(mockExecResult);
    });

    it('executes gitCommit with correct command and options', async () => {
      const options: GitCommitOptions = {
        message: 'test commit',
        skipHooks: true,
      };

      vi.mocked(commandExecutor.execAsync, { partial: true }).mockResolvedValue({
        stdout: '',
        stderr: '',
      });

      await commands.gitCommit(options);

      expect(commandExecutor.execAsync).toHaveBeenCalledWith('git commit --no-verify -m "test commit"');
    });

    it('executes createGitTag with correct command', async () => {
      const options: GitTagOptions = {
        tag: 'v1.0.0',
        message: 'Version 1.0.0',
      };

      vi.mocked(commandExecutor.execAsync, { partial: true }).mockResolvedValue({
        stdout: '',
        stderr: '',
      });

      await commands.createGitTag(options);

      expect(commandExecutor.execAsync).toHaveBeenCalledWith('git tag -a -m "Version 1.0.0" v1.0.0 ');
    });

    it('throws TAG_ALREADY_EXISTS error when tag already exists', async () => {
      const options: GitTagOptions = {
        tag: 'v1.0.0',
        message: 'Version 1.0.0',
      };

      const mockError = new Error("fatal: tag 'v1.0.0' already exists");
      vi.mocked(commandExecutor.execAsync, { partial: true }).mockRejectedValue(mockError);

      const { GitError, GitErrorCode } = await import('../../../src/errors/gitError.js');

      await expect(commands.createGitTag(options)).rejects.toThrow(GitError);
      await expect(commands.createGitTag(options)).rejects.toMatchObject({
        code: GitErrorCode.TAG_ALREADY_EXISTS,
        message: expect.stringContaining("Tag 'v1.0.0' already exists in the repository"),
      });
    });
  });

  describe('gitProcess', () => {
    it('checks for git repository', async () => {
      vi.mocked(repository.isGitRepository, { partial: true }).mockReturnValue(false);

      const options: GitProcessOptions = {
        files: ['file1.js'],
        nextTag: 'v1.0.0',
        commitMessage: 'test commit',
      };

      await expect(commands.gitProcess(options)).rejects.toThrow(GitError);
      await expect(commands.gitProcess(options)).rejects.toMatchObject({
        code: GitErrorCode.NOT_GIT_REPO,
      });
    });

    it('logs actions in dry run mode', async () => {
      const options: GitProcessOptions = {
        files: ['file1.js'],
        nextTag: 'v1.0.0',
        commitMessage: 'test commit',
        dryRun: true,
      };

      await commands.gitProcess(options);

      expect(logging.log).toHaveBeenCalledWith('[DRY RUN] Would add files:', 'info');
      expect(logging.log).toHaveBeenCalledWith('  - file1.js', 'info');
      expect(logging.log).toHaveBeenCalledWith('[DRY RUN] Would commit with message: "test commit"', 'info');
      expect(logging.log).toHaveBeenCalledWith('[DRY RUN] Would create tag: v1.0.0', 'info');
    });
  });

  describe('createGitCommitAndTag', () => {
    it('throws error if no files provided', async () => {
      await expect(commands.createGitCommitAndTag([], 'v1.0.0', 'test commit')).rejects.toThrow(
        /No files specified for commit/,
      );
    });

    it('throws error if no commit message provided', async () => {
      await expect(commands.createGitCommitAndTag(['file1.js'], 'v1.0.0', '')).rejects.toThrow(
        /Commit message is required/,
      );
    });

    it('logs success message when tag is created', async () => {
      // Mock gitProcess to prevent actual execution
      const originalGitProcess = commands.gitProcess;
      vi.spyOn(commands, 'gitProcess').mockImplementation(() => Promise.resolve());

      try {
        await commands.createGitCommitAndTag(['file1.js'], 'v1.0.0', 'test commit');

        expect(jsonOutput.setCommitMessage).toHaveBeenCalledWith('test commit');
        expect(jsonOutput.addTag).toHaveBeenCalledWith('v1.0.0');
        expect(logging.log).toHaveBeenCalledWith('Created tag: v1.0.0', 'success');
      } finally {
        // Restore the original function
        vi.spyOn(commands, 'gitProcess').mockImplementation(originalGitProcess);
      }
    });

    it('does not log success message in dry run mode', async () => {
      // Mock gitProcess to prevent actual execution
      const originalGitProcess = commands.gitProcess;
      vi.spyOn(commands, 'gitProcess').mockImplementation(() => Promise.resolve());

      try {
        await commands.createGitCommitAndTag(['file1.js'], 'v1.0.0', 'test commit', false, true);

        expect(logging.log).not.toHaveBeenCalledWith('Created tag: v1.0.0', 'success');
      } finally {
        // Restore the original function
        vi.spyOn(commands, 'gitProcess').mockImplementation(originalGitProcess);
      }
    });
  });
});
