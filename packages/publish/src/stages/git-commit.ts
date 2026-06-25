import * as path from 'node:path';
import { info, success } from '@releasekit/core';
import { createGitCli } from '@releasekit/git';
import { createPublishError, PublishErrorCode } from '../errors/index.js';
import type { PipelineContext } from '../types.js';
import { runGit } from '../utils/git.js';

/** Error strategy: THROWS. Git is a prerequisite — failure halts pipeline. */
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
    // Stage all updated files (version bumps + any additional files like changelogs)
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

    // Create commit
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
  }

  // Create tags. Baseline tags (when present) are created at the same commit as consumer
  // tags but flagged separately on VersionOutput so the github-release stage can skip them.
  const allTags = [...input.tags, ...(input.baselineTags ?? [])];
  for (const tag of allTags) {
    if (!dryRun) {
      // Check if tag already exists before creating
      if (await git.refExists(`refs/tags/${tag}`, cwd)) {
        // The seam has no "resolve a tag's commit", so resolve the tag's commit via log and
        // compare to HEAD (mirrors release/standing-pr's createReleaseTags idempotency check).
        const [tagCommitSha, headSha] = await Promise.all([
          git.log({ range: tag, format: '%H', extraArgs: ['-1'], cwd }).then((out) => out.trim()),
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
