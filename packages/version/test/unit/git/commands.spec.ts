import { createFakeGit, FakeGit, type Git } from '@releasekit/git';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GitError, GitErrorCode } from '../../../src/errors/gitError.js';
// Import types only to avoid conflicts
import type { GitCommitOptions, GitProcessOptions, GitTagOptions } from '../../../src/git/commands.js';
import * as repository from '../../../src/git/repository.js';
import * as jsonOutput from '../../../src/utils/jsonOutput.js';
import * as logging from '../../../src/utils/logging.js';

// Mock dependencies. The repository check is mocked so command tests don't touch the filesystem;
// the actual git mutations are driven through an injected FakeGit and asserted on its recorders.
vi.mock('../../../src/git/repository.js');
vi.mock('../../../src/utils/logging.js');
vi.mock('../../../src/utils/jsonOutput.js');
vi.mock('node:process', () => ({
  cwd: () => '/fake/path',
}));

// Import the actual commands module
import * as commands from '../../../src/git/commands.js';

/** A Git whose tag() rejects, to exercise the TAG_ALREADY_EXISTS specialization. */
function gitThatFailsTagWith(message: string): Git {
  const git = createFakeGit();
  git.tag = async () => {
    throw new Error(message);
  };
  return git;
}

describe('Git Commands', () => {
  beforeEach(() => {
    vi.resetAllMocks();

    // Mock repository check to return true by default
    vi.mocked(repository.isGitRepository, { partial: true }).mockResolvedValue(true);
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  describe('Basic git operations', () => {
    it('should execute gitAdd with correct files', async () => {
      const files = ['file1.js', 'file2.js'];
      const git = createFakeGit();

      await commands.gitAdd(files, git);

      expect(git.added).toEqual([['file1.js', 'file2.js']]);
    });

    it('should execute gitCommit with correct message and options', async () => {
      const options: GitCommitOptions = {
        message: 'test commit',
        skipHooks: true,
      };
      const git = createFakeGit();

      await commands.gitCommit(options, git);

      expect(git.committed).toEqual([{ message: 'test commit', paths: undefined, skipHooks: true }]);
    });

    it('should reject unsupported amend/author/date commit options', async () => {
      const git = createFakeGit();

      await expect(commands.gitCommit({ message: 'm', amend: true }, git)).rejects.toThrow(GitError);
      expect(git.committed).toEqual([]);
    });

    it('should execute createGitTag with an annotated message', async () => {
      const options: GitTagOptions = {
        tag: 'v1.0.0',
        message: 'Version 1.0.0',
      };
      const git = createFakeGit();

      await commands.createGitTag(options, git);

      expect(git.tagged).toEqual([{ name: 'v1.0.0', message: 'Version 1.0.0' }]);
    });

    it('should throw TAG_ALREADY_EXISTS error when tag already exists', async () => {
      const options: GitTagOptions = {
        tag: 'v1.0.0',
        message: 'Version 1.0.0',
      };
      const git = gitThatFailsTagWith("fatal: tag 'v1.0.0' already exists");

      await expect(commands.createGitTag(options, git)).rejects.toThrow(GitError);
      await expect(commands.createGitTag(options, git)).rejects.toMatchObject({
        code: GitErrorCode.TAG_ALREADY_EXISTS,
        message: expect.stringContaining("Tag 'v1.0.0' already exists in the repository"),
      });
    });

    it('should re-throw other tag failures as a generic git error', async () => {
      const git = gitThatFailsTagWith('fatal: some other failure');

      await expect(commands.createGitTag({ tag: 'v1.0.0', message: 'm' }, git)).rejects.toMatchObject({
        code: GitErrorCode.GIT_ERROR,
      });
    });
  });

  describe('gitProcess', () => {
    it('should check for git repository', async () => {
      vi.mocked(repository.isGitRepository, { partial: true }).mockResolvedValue(false);

      const options: GitProcessOptions = {
        files: ['file1.js'],
        nextTag: 'v1.0.0',
        commitMessage: 'test commit',
      };

      await expect(commands.gitProcess(options, createFakeGit())).rejects.toThrow(GitError);
      await expect(commands.gitProcess(options, createFakeGit())).rejects.toMatchObject({
        code: GitErrorCode.NOT_GIT_REPO,
      });
    });

    it('should add, commit, and tag when not a dry run', async () => {
      const git = createFakeGit();
      const options: GitProcessOptions = {
        files: ['file1.js'],
        nextTag: 'v1.0.0',
        commitMessage: 'test commit',
      };

      await commands.gitProcess(options, git);

      expect(git.added).toEqual([['file1.js']]);
      expect(git.committed).toEqual([{ message: 'test commit', paths: undefined, skipHooks: undefined }]);
      expect(git.tagged).toEqual([{ name: 'v1.0.0', message: expect.stringContaining('New Version v1.0.0') }]);
    });

    it('should log actions in dry run mode without writing', async () => {
      const git = createFakeGit();
      const options: GitProcessOptions = {
        files: ['file1.js'],
        nextTag: 'v1.0.0',
        commitMessage: 'test commit',
        dryRun: true,
      };

      await commands.gitProcess(options, git);

      // Dry run: nothing is written through the seam.
      expect(git.added).toEqual([]);
      expect(git.committed).toEqual([]);
      expect(git.tagged).toEqual([]);

      expect(logging.log).toHaveBeenCalledWith('[DRY RUN] Would add files:', 'info');
      expect(logging.log).toHaveBeenCalledWith('  - file1.js', 'info');
      expect(logging.log).toHaveBeenCalledWith('[DRY RUN] Would commit with message: "test commit"', 'info');
      expect(logging.log).toHaveBeenCalledWith('[DRY RUN] Would create tag: v1.0.0', 'info');
    });
  });

  describe('createGitCommitAndTag', () => {
    it('should throw error if no files provided', async () => {
      await expect(commands.createGitCommitAndTag([], 'v1.0.0', 'test commit')).rejects.toThrow(
        /No files specified for commit/,
      );
    });

    it('should throw error if no commit message provided', async () => {
      await expect(commands.createGitCommitAndTag(['file1.js'], 'v1.0.0', '')).rejects.toThrow(
        /Commit message is required/,
      );
    });

    it('should record commit message and tag for JSON output and write through the seam', async () => {
      const git = createFakeGit();

      await commands.createGitCommitAndTag(['file1.js'], 'v1.0.0', 'test commit', false, false, git);

      expect(jsonOutput.setCommitMessage).toHaveBeenCalledWith('test commit');
      expect(jsonOutput.addTag).toHaveBeenCalledWith('v1.0.0');
      expect(logging.log).toHaveBeenCalledWith('Created tag: v1.0.0', 'success');
      expect(git.committed).toHaveLength(1);
      expect(git.tagged).toEqual([{ name: 'v1.0.0', message: expect.stringContaining('New Version v1.0.0') }]);
    });

    it('should not write or log success in dry run mode', async () => {
      const git = createFakeGit();

      await commands.createGitCommitAndTag(['file1.js'], 'v1.0.0', 'test commit', false, true, git);

      expect(logging.log).not.toHaveBeenCalledWith('Created tag: v1.0.0', 'success');
      expect(git.added).toEqual([]);
      expect(git.committed).toEqual([]);
      expect(git.tagged).toEqual([]);
    });
  });

  it('should expose a FakeGit usable as the injected seam', () => {
    expect(createFakeGit()).toBeInstanceOf(FakeGit);
  });
});
