import * as path from 'node:path';
import { info, success } from '@releasekit/core';
import { createPublishError, PublishErrorCode } from '../errors/index.js';
import type { PipelineContext } from '../types.js';
import { execCommand, execCommandSafe } from '../utils/exec.js';

/** Error strategy: THROWS. Git is a prerequisite — failure halts pipeline. */
export async function runGitCommitStage(ctx: PipelineContext): Promise<void> {
  const { input, config, cliOptions, cwd } = ctx;
  const dryRun = cliOptions.dryRun;
  const skipHooks = config.git.skipHooks ?? false;
  const skipCommit = cliOptions.skipGitCommit ?? false;

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
      await execCommand('git', ['add', ...filePaths], {
        cwd,
        dryRun,
        label: `git add ${filePaths.length} file(s)`,
      });
    } catch (error) {
      throw createPublishError(
        PublishErrorCode.GIT_COMMIT_ERROR,
        `git add failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    // Create commit
    const commitArgs = ['commit'];
    if (skipHooks) {
      commitArgs.push('--no-verify');
    }
    commitArgs.push('-m', input.commitMessage);

    try {
      await execCommand('git', commitArgs, {
        cwd,
        dryRun,
        label: `git commit -m "${input.commitMessage}"`,
      });
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
      const checkResult = await execCommandSafe('git', ['rev-parse', '-q', '--verify', `refs/tags/${tag}`], { cwd });
      if (checkResult.exitCode === 0) {
        const [tagDerefResult, headResult] = await Promise.all([
          execCommandSafe('git', ['rev-parse', `refs/tags/${tag}^{}`], { cwd }),
          execCommandSafe('git', ['rev-parse', 'HEAD'], { cwd }),
        ]);
        const tagCommitSha = tagDerefResult.stdout.trim();
        const headSha = headResult.stdout.trim();
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
      await execCommand('git', ['tag', '-a', tag, '-m', tagMessage], {
        cwd,
        dryRun,
        label: `git tag ${tag}`,
      });
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
