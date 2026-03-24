import { info, success } from '@releasekit/core';
import { createPublishError, PublishErrorCode } from '../errors/index.js';
import type { PipelineContext } from '../types.js';
import { detectGitPushMethod } from '../utils/auth.js';
import { execCommand } from '../utils/exec.js';

function toGithubAuthedUrl(remoteUrl: string, token: string): string | undefined {
  // Only rewrite standard GitHub HTTPS URLs.
  // Avoid logging token by never returning it via logs.
  try {
    const url = new URL(remoteUrl);
    if (url.protocol !== 'https:') return undefined;
    if (url.host !== 'github.com') return undefined;

    // Use the recommended username for GitHub token auth in HTTPS URLs.
    url.username = 'x-access-token';
    url.password = token;
    return url.toString();
  } catch {
    return undefined;
  }
}

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

  const { remote } = config.git;

  // Resolve branch: explicit config/CLI value wins, otherwise detect from current HEAD
  let branch = config.git.branch;
  if (!branch) {
    const revResult = await execCommand('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd, dryRun: false });
    branch = revResult.stdout.trim();
  }

  // Auto-detect push method if needed
  let pushMethod = config.git.pushMethod;
  if (pushMethod === 'auto') {
    try {
      pushMethod = await detectGitPushMethod(remote, cwd);
    } catch {
      pushMethod = 'https';
    }
  }

  // Only attempt token-based HTTPS auth when explicitly configured.
  const httpsTokenEnv = config.git.httpsTokenEnv;
  const httpsToken = httpsTokenEnv ? process.env[httpsTokenEnv] : undefined;

  try {
    // If using HTTPS and a token is available, push directly to an authed URL.
    // This avoids requiring workflow-specific remote rewriting.
    let pushRemote: string = remote;
    if (pushMethod === 'https' && httpsToken) {
      const remoteUrlResult = await execCommand('git', ['remote', 'get-url', remote], { cwd, dryRun: false });
      const authed = toGithubAuthedUrl(remoteUrlResult.stdout.trim(), httpsToken);
      if (authed) {
        pushRemote = authed;
      }
    }

    // Push commits
    if (output.git.committed) {
      await execCommand('git', ['push', pushRemote, branch], {
        cwd,
        dryRun,
        label: `git push ${remote} ${branch}`,
      });
    }

    // Push tags
    if (output.git.tags.length > 0) {
      await execCommand('git', ['push', pushRemote, '--tags'], {
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
