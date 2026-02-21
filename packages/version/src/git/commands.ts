import { cwd } from 'node:process';
import { createGitError, GitError, GitErrorCode } from '../errors/gitError.js';
import { addTag, setCommitMessage } from '../utils/jsonOutput.js';
import { log } from '../utils/logging.js';
import { execAsync } from './commandExecutor.js';
import { isGitRepository } from './repository.js';

/**
 * Options for git tag command
 */
export type GitTagOptions = {
  tag: string;
  message?: string;
  annotated?: boolean;
  args?: string;
};

/**
 * Options for git commit command
 */
export type GitCommitOptions = {
  message: string;
  amend?: boolean;
  author?: string;
  date?: string;
  skipHooks?: boolean;
};

/**
 * Options for git process
 */
export type GitProcessOptions = {
  files: string[];
  nextTag: string;
  commitMessage: string;
  skipHooks?: boolean;
  dryRun?: boolean;
};

/**
 * Add files to git staging
 * @param files Files to add
 * @returns Promise with exec result
 */
export async function gitAdd(files: string[]) {
  const command = `git add ${files.join(' ')}`;
  return execAsync(command);
}

/**
 * Create a git commit
 * @param options Commit options
 * @returns Promise with exec result
 */
export async function gitCommit(options: GitCommitOptions) {
  const command = ['commit'];
  if (options.amend) {
    command.push('--amend');
  }
  if (options.author) {
    command.push(`--author="${options.author}"`);
  }
  if (options.date) {
    command.push(`--date="${options.date}"`);
  }
  if (options.skipHooks) {
    command.push('--no-verify');
  }
  command.push(`-m "${options.message}"`);

  return execAsync(`git ${command.join(' ')}`);
}

/**
 * Create a git tag
 * @param options Tag options
 * @returns Promise with exec result
 */
export async function createGitTag(options: GitTagOptions) {
  const { tag, message = '', args = '' } = options;
  const command = `git tag -a -m "${message}" ${tag} ${args}`;

  try {
    return await execAsync(command);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    // Check if the error is due to tag already existing
    if (errorMessage.includes('already exists')) {
      throw createGitError(
        GitErrorCode.TAG_ALREADY_EXISTS,
        `Tag '${tag}' already exists in the repository. Please use a different version or delete the existing tag first.`,
      );
    }

    // Re-throw other errors as generic git errors
    throw createGitError(GitErrorCode.GIT_ERROR, errorMessage);
  }
}

/**
 * Execute git add, commit, and tag in a single process
 * @param options Git process options
 */
export async function gitProcess(options: GitProcessOptions) {
  const { files, nextTag, commitMessage, skipHooks, dryRun } = options;

  if (!isGitRepository(cwd())) {
    throw createGitError(GitErrorCode.NOT_GIT_REPO);
  }

  try {
    if (!dryRun) {
      await gitAdd(files);

      await gitCommit({
        message: commitMessage,
        skipHooks,
      });

      if (nextTag) {
        const tagMessage = `New Version ${nextTag} generated at ${new Date().toISOString()}`;
        await createGitTag({
          tag: nextTag,
          message: tagMessage,
        });
      }
    } else {
      log('[DRY RUN] Would add files:', 'info');
      for (const file of files) {
        log(`  - ${file}`, 'info');
      }
      log(`[DRY RUN] Would commit with message: "${commitMessage}"`, 'info');
      if (nextTag) {
        log(`[DRY RUN] Would create tag: ${nextTag}`, 'info');
      }
    }
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);

    // Check if this is a tag already exists error
    if (errorMessage.includes('already exists') && nextTag) {
      log(`Tag '${nextTag}' already exists in the repository.`, 'error');
      throw createGitError(
        GitErrorCode.TAG_ALREADY_EXISTS,
        `Tag '${nextTag}' already exists in the repository. Please use a different version or delete the existing tag first.`,
      );
    }

    // Log detailed error information
    log(`Git process error: ${errorMessage}`, 'error');

    if (err instanceof Error && err.stack) {
      console.error('Git process stack trace:');
      console.error(err.stack);
    }

    throw createGitError(GitErrorCode.GIT_PROCESS_ERROR, errorMessage);
  }
}

/**
 * Create git commit and tag with detailed output tracking
 * @param files List of files to commit
 * @param nextTag Tag to create
 * @param commitMessage Message for the commit
 * @param skipHooks Whether to skip git hooks
 * @param dryRun Whether to perform a dry run (no actual changes)
 */
export async function createGitCommitAndTag(
  files: string[],
  nextTag: string,
  commitMessage: string,
  skipHooks?: boolean,
  dryRun?: boolean,
): Promise<void> {
  try {
    // Validate inputs
    if (!files || files.length === 0) {
      throw createGitError(GitErrorCode.NO_FILES);
    }

    if (!commitMessage) {
      throw createGitError(GitErrorCode.NO_COMMIT_MESSAGE);
    }

    // Track commit message and tag for JSON output
    setCommitMessage(commitMessage);
    if (nextTag) {
      addTag(nextTag);
    }

    await gitProcess({
      files,
      nextTag,
      commitMessage,
      skipHooks,
      dryRun,
    });

    if (!dryRun) {
      log(`Created tag: ${nextTag}`, 'success');
    }
  } catch (error) {
    // If it's already a GitError, re-throw it to preserve the specific error type
    if (error instanceof GitError) {
      throw error;
    }

    const errorMessage = error instanceof Error ? error.message : String(error);
    log(`Failed to create git commit and tag: ${errorMessage}`, 'error');

    // Enhanced error logging
    if (error instanceof Error) {
      // Log the full stack trace for debugging
      console.error('Git operation error details:');
      console.error(error.stack || error.message);

      // Extract and log command output if available
      if (errorMessage.includes('Command failed:')) {
        const cmdOutput = errorMessage.split('Command failed:')[1];
        if (cmdOutput) {
          console.error('Git command output:', cmdOutput.trim());
        }
      }
    } else {
      console.error('Unknown git error:', error);
    }

    throw new GitError(`Git operation failed: ${errorMessage}`, GitErrorCode.GIT_ERROR);
  }
}
