import * as path from 'node:path';
import { info, success } from '@releasekit/core';
import { createGitCli, type Git } from '@releasekit/git';
import { createPublishError, PublishErrorCode } from '../errors/index.js';
import type { PipelineContext } from '../types.js';
import { runGit } from '../utils/git.js';

async function hasStagedChanges(git: Git, cwd: string): Promise<boolean> {
  try {
    return await git.hasStagedChanges(cwd);
  } catch (error) {
    throw createPublishError(
      PublishErrorCode.GIT_COMMIT_ERROR,
      `git diff --cached failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/** The subject `git log --format=%s` shows for this message: its first paragraph, with the lines joined by spaces. */
function subjectOf(message: string): string {
  const lines = message.split('\n').map((line) => line.trimEnd());
  const start = lines.findIndex((line) => line !== '');
  const paragraph = start === -1 ? [] : lines.slice(start);
  const end = paragraph.indexOf('');
  return (end === -1 ? paragraph : paragraph.slice(0, end)).join(' ').trim();
}

async function assertHeadIsReleaseCommit(git: Git, commitMessage: string, cwd: string): Promise<void> {
  const subject = subjectOf(commitMessage);
  const headSubject = await git
    .log({ range: 'HEAD', format: '%s', extraArgs: ['-1'], cwd })
    .then((out) => out.trim())
    .catch(() => '');
  if (headSubject !== subject) {
    throw createPublishError(
      PublishErrorCode.GIT_COMMIT_ERROR,
      `Nothing to commit, and HEAD ("${headSubject}") is not the release commit ("${subject}")`,
    );
  }
}

/** Error strategy: THROWS. Git is a prerequisite - failure halts pipeline. */
export async function runGitCommitStage(ctx: PipelineContext): Promise<void> {
  const { input, config, cliOptions, cwd } = ctx;
  const dryRun = cliOptions.dryRun;
  const skipHooks = config.git.skipHooks ?? false;
  const skipCommit = cliOptions.skipGitCommit ?? false;
  const git = createGitCli();

  if (!input.commitMessage) {
    info('No commit message provided, skipping git commit');
    return;
  }

  if (!skipCommit) {
    const filePaths = input.updates.map((u) => path.resolve(cwd, u.filePath));
    if (ctx.additionalFiles) {
      filePaths.push(...ctx.additionalFiles.map((f) => path.resolve(cwd, f)));
    }

    if (filePaths.length === 0) {
      info('No files to commit');
      return;
    }

    try {
      await runGit(dryRun, `git add ${filePaths.length} file(s)`, () => git.add(filePaths, cwd));
    } catch (error) {
      throw createPublishError(
        PublishErrorCode.GIT_COMMIT_ERROR,
        `git add failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    // A dry run stages nothing, so the index can't be checked; assume there's something to commit.
    if (dryRun || (await hasStagedChanges(git, cwd))) {
      try {
        await runGit(dryRun, `git commit -m "${input.commitMessage}"`, () =>
          git.commit(input.commitMessage as string, { cwd, skipHooks }),
        );
        ctx.output.git.committed = true;
        if (!dryRun) {
          success('Created git commit');
        }
      } catch (error) {
        throw createPublishError(
          PublishErrorCode.GIT_COMMIT_ERROR,
          `git commit failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    } else {
      await assertHeadIsReleaseCommit(git, input.commitMessage, cwd);
      ctx.releaseCommitReused = true;
      info('Nothing to commit: HEAD is already the release commit, reusing it');
    }
  }

  // Baseline tags share the release commit but stay separate on VersionOutput so github-release can skip them.
  const allTags = [...input.tags, ...(input.baselineTags ?? [])];
  for (const tag of allTags) {
    if (!dryRun) {
      if (await git.refExists(`refs/tags/${tag}`, cwd)) {
        // The seam can't resolve a tag's commit directly, so go via log. A log failure resolves to '' and
        // falls through to the GIT_TAG_ERROR throw rather than letting a raw GitError escape the
        // PublishError contract.
        const [tagCommitSha, headSha] = await Promise.all([
          git
            .log({ range: tag, format: '%H', extraArgs: ['-1'], cwd })
            .then((out) => out.trim())
            .catch(() => ''),
          git.headSha(cwd),
        ]);
        if (tagCommitSha === headSha) {
          info(`Tag ${tag} already exists at current commit, skipping`);
          ctx.output.git.tags.push(tag);
          continue;
        }
        throw createPublishError(
          PublishErrorCode.GIT_TAG_ERROR,
          `Tag ${tag} already exists at a different commit (${tagCommitSha}) than current HEAD (${headSha})`,
        );
      }
    }

    try {
      const tagMessage = `Release ${tag}`;
      await runGit(dryRun, `git tag ${tag}`, () => git.tag(tag, { message: tagMessage, cwd }));
      ctx.output.git.tags.push(tag);
      if (!dryRun) {
        success(`Created tag: ${tag}`);
      }
    } catch (error) {
      throw createPublishError(
        PublishErrorCode.GIT_TAG_ERROR,
        `Failed to create tag ${tag}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
