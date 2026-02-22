import { info, success } from '@releasekit/core';
import { createPublishError, PublishErrorCode } from '../errors/index.js';
import type { PipelineContext } from '../types.js';
import { detectGitPushMethod } from '../utils/auth.js';
import { execCommand } from '../utils/exec.js';

/** Error strategy: THROWS. Push after publish. */
export async function runGitPushStage(ctx: PipelineContext): Promise<void> {
  const { config, cliOptions, cwd, output } = ctx;
  const dryRun = cliOptions.dryRun;

  if (!config.git.push) {
    info('Git push disabled in config, skipping');
    return;
  }

  if (!output.git.committed && output.git.tags.length === 0) {
    info('Nothing to push (no commits or tags created)');
    return;
  }

  const { remote, branch } = config.git;

  // Auto-detect push method if needed
  let pushMethod = config.git.pushMethod;
  if (pushMethod === 'auto') {
    try {
      pushMethod = await detectGitPushMethod(remote, cwd);
    } catch {
      pushMethod = 'https';
    }
  }

  try {
    // Push commits
    if (output.git.committed) {
      await execCommand('git', ['push', remote, branch], {
        cwd,
        dryRun,
        label: `git push ${remote} ${branch}`,
      });
    }

    // Push tags
    if (output.git.tags.length > 0) {
      await execCommand('git', ['push', remote, '--tags'], {
        cwd,
        dryRun,
        label: `git push ${remote} --tags`,
      });
    }

    ctx.output.git.pushed = true;
    if (!dryRun) {
      success(`Pushed to ${remote}/${branch}`);
    }
  } catch (error) {
    throw createPublishError(
      PublishErrorCode.GIT_PUSH_ERROR,
      `${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
