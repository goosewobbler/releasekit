import { cwd } from 'node:process';
import { inspect } from 'node:util';
import { createGitCli, type Git } from '@releasekit/git';
import { createGitError, GitError, GitErrorCode } from '../errors/gitError.js';
import { addTag, setCommitMessage } from '../utils/jsonOutput.js';
import { log } from '../utils/logging.js';
import { isGitRepository } from './repository.js';

export type GitTagOptions = {
  tag: string;
  message?: string;
  annotated?: boolean;
  args?: string;
};

export type GitCommitOptions = {
  message: string;
  amend?: boolean;
  author?: string;
  date?: string;
  skipHooks?: boolean;
};

export type GitProcessOptions = {
  files: string[];
  nextTag: string;
  commitMessage: string;
  skipHooks?: boolean;
  dryRun?: boolean;
};

export async function gitAdd(files: string[], git: Git = createGitCli()): Promise<void> {
  await git.add(files);
}

/** The git seam can't express `amend`/`author`/`date`, so they throw rather than being silently dropped. */
export async function gitCommit(options: GitCommitOptions, git: Git = createGitCli()): Promise<void> {
  if (options.amend || options.author || options.date) {
    throw createGitError(
      GitErrorCode.GIT_ERROR,
      'gitCommit: amend/author/date are not supported by the git seam; remove them or extend the seam.',
    );
  }
  await git.commit(options.message, { skipHooks: options.skipHooks });
}

export async function createGitTag(options: GitTagOptions, git: Git = createGitCli()): Promise<void> {
  const { tag, message = '' } = options;

  try {
    // Annotated tag (`tag -a -m <message>`).
    await git.tag(tag, { message });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    if (errorMessage.includes('already exists')) {
      throw createGitError(
        GitErrorCode.TAG_ALREADY_EXISTS,
        `Tag '${tag}' already exists in the repository. Please use a different version or delete the existing tag first.`,
      );
    }

    throw createGitError(GitErrorCode.GIT_ERROR, errorMessage);
  }
}

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

    if (errorMessage.includes('already exists') && nextTag) {
      log(`Tag '${nextTag}' already exists in the repository.`, 'error');
      throw createGitError(
        GitErrorCode.TAG_ALREADY_EXISTS,
        `Tag '${nextTag}' already exists in the repository. Please use a different version or delete the existing tag first.`,
      );
    }

    log(`Git process error: ${errorMessage}`, 'error');

    if (err instanceof Error && err.stack) {
      log('Git process stack trace:', 'error');
      log(err.stack, 'error');
    }

    throw createGitError(GitErrorCode.GIT_PROCESS_ERROR, errorMessage);
  }
}

export async function createGitCommitAndTag(
  files: string[],
  nextTag: string,
  commitMessage: string,
  skipHooks?: boolean,
  dryRun?: boolean,
  git: Git = createGitCli(),
): Promise<void> {
  try {
    if (!files || files.length === 0) {
      throw createGitError(GitErrorCode.NO_FILES);
    }

    if (!commitMessage) {
      throw createGitError(GitErrorCode.NO_COMMIT_MESSAGE);
    }

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
    if (error instanceof GitError) {
      throw error;
    }

    const errorMessage = error instanceof Error ? error.message : String(error);
    log(`Failed to create git commit and tag: ${errorMessage}`, 'error');

    if (error instanceof Error) {
      log('Git operation error details:', 'error');
      log(error.stack || error.message, 'error');

      if (errorMessage.includes('Command failed:')) {
        const cmdOutput = errorMessage.split('Command failed:')[1];
        if (cmdOutput) {
          log(`Git command output: ${cmdOutput.trim()}`, 'error');
        }
      }
    } else {
      log(`Unknown git error: ${inspect(error)}`, 'error');
    }

    throw new GitError(`Git operation failed: ${errorMessage}`, GitErrorCode.GIT_ERROR);
  }
}
