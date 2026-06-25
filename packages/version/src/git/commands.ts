import { cwd } from 'node:process';
import { createGitCli, type Git } from '@releasekit/git';
import { createGitError, GitError, GitErrorCode } from '../errors/gitError.js';
import { addTag, setCommitMessage } from '../utils/jsonOutput.js';
import { log } from '../utils/logging.js';
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
 * @param git Injected git seam (defaults to the real CLI adapter)
 */
export async function gitAdd(files: string[], git: Git = createGitCli()): Promise<void> {
  await git.add(files);
}

/**
 * Create a git commit
 * @param options Commit options
 * @param git Injected git seam (defaults to the real CLI adapter)
 *
 * NOTE: `amend`/`author`/`date` are not expressible through the Git seam's commit options (only
 * message, skipHooks, and paths are). No call path ever sets them — `gitProcess` only passes
 * `message` + `skipHooks` — so this preserves behaviour. If a future caller sets one, fail loudly
 * rather than silently dropping it.
 */
export async function gitCommit(options: GitCommitOptions, git: Git = createGitCli()): Promise<void> {
  if (options.amend || options.author || options.date) {
    throw createGitError(
      GitErrorCode.GIT_ERROR,
      'gitCommit: amend/author/date are not supported by the git seam; remove them or extend the seam.',
    );
  }
  await git.commit(options.message, { skipHooks: options.skipHooks });
}

/**
 * Create a git tag
 * @param options Tag options
 * @param git Injected git seam (defaults to the real CLI adapter)
 */
export async function createGitTag(options: GitTagOptions, git: Git = createGitCli()): Promise<void> {
  const { tag, message = '' } = options;

  try {
    // Annotated tag (`tag -a -m <message>`), matching the original `tag -a -m <msg> <tag>`.
    await git.tag(tag, { message });
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
export async function gitProcess(options: GitProcessOptions, git: Git = createGitCli()) {
  const { files, nextTag, commitMessage, skipHooks, dryRun } = options;

  if (!(await isGitRepository(cwd(), git))) {
    throw createGitError(GitErrorCode.NOT_GIT_REPO);
  }

  try {
    if (!dryRun) {
      await gitAdd(files, git);

      await gitCommit(
        {
          message: commitMessage,
          skipHooks,
        },
        git,
      );

      if (nextTag) {
        const tagMessage = `New Version ${nextTag} generated at ${new Date().toISOString()}`;
        await createGitTag(
          {
            tag: nextTag,
            message: tagMessage,
          },
          git,
        );
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
  git: Git = createGitCli(),
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

    await gitProcess(
      {
        files,
        nextTag,
        commitMessage,
        skipHooks,
        dryRun,
      },
      git,
    );

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
