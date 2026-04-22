import { info, success } from '@releasekit/core';
import { createPublishError, PublishError, PublishErrorCode } from '../errors/index.js';
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

export interface PushSetup {
  pushRemote: string;
  remote: string;
  branch?: string;
  dryRun: boolean;
}

/**
 * Prepare push setup (method detection, auth, branch resolution) once to avoid redundant network probes.
 * Reuse this for all per-package pushes.
 */
export async function preparePushSetup(ctx: PipelineContext): Promise<PushSetup | null> {
  const { config, cliOptions, cwd, output } = ctx;

  if (!config.git.push) return null;

  const { remote } = config.git;
  const dryRun = cliOptions.dryRun;

  let pushMethod = config.git.pushMethod;
  if (pushMethod === 'auto') {
    try {
      pushMethod = await detectGitPushMethod(remote, cwd);
    } catch {
      pushMethod = 'https';
    }
  }

  const httpsToken = config.git.httpsTokenEnv ? process.env[config.git.httpsTokenEnv] : undefined;

  let pushRemote: string = remote;
  if (pushMethod === 'https' && httpsToken) {
    const remoteUrlResult = await execCommand('git', ['remote', 'get-url', remote], { cwd, dryRun: false });
    const authed = toGithubAuthedUrl(remoteUrlResult.stdout.trim(), httpsToken);
    if (authed) pushRemote = authed;
  }

  let branch: string | undefined;
  if (output.git.committed) {
    branch = config.git.branch;
    if (!branch) {
      const revResult = await execCommand('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd, dryRun: false });
      branch = revResult.stdout.trim();
      if (branch === 'HEAD') {
        throw createPublishError(
          PublishErrorCode.GIT_PUSH_ERROR,
          'Cannot push: repository is in a detached HEAD state. Set git.branch in your config or pass --branch <name>.',
        );
      }
    }
  }

  return { pushRemote, remote, branch, dryRun };
}

/**
 * Push a single package tag and (idempotently) the branch after a package publishes.
 * Safe to call once per package — branch push is a no-op when already up-to-date.
 * Pass precomputed setup to avoid redundant method detection and branch resolution.
 * Error strategy: THROWS.
 */
export async function pushPackageTag(tag: string, ctx: PipelineContext, setup?: PushSetup): Promise<void> {
  const { config, cliOptions, cwd, output } = ctx;
  const dryRun = cliOptions.dryRun;

  if (!config.git.push) return;

  const resolvedSetup =
    setup ||
    ((await preparePushSetup(ctx)) ??
      (() => {
        throw createPublishError(PublishErrorCode.GIT_PUSH_ERROR, 'Git push disabled');
      })());

  const { pushRemote, branch } = resolvedSetup;

  // Push the specific tag ref (carries the underlying commit with it)
  await execCommand('git', ['push', pushRemote, `refs/tags/${tag}`], {
    cwd,
    dryRun,
    label: `git push ${pushRemote} refs/tags/${tag}`,
  });
  output.git.tags.push(tag);

  // Push the branch (idempotent — no-op if remote is already up-to-date)
  if (output.git.committed && branch) {
    await execCommand('git', ['push', pushRemote, branch], {
      cwd,
      dryRun,
      label: `git push ${pushRemote} ${branch}`,
    });
  }

  output.git.pushed = true;
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

    // Push commits — branch resolution is deferred to here so a tags-only push
    // never triggers the detached-HEAD guard unnecessarily.
    let branch: string | undefined;
    if (output.git.committed) {
      branch = config.git.branch;
      if (!branch) {
        const revResult = await execCommand('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd, dryRun: false });
        branch = revResult.stdout.trim();
        if (branch === 'HEAD') {
          throw createPublishError(
            PublishErrorCode.GIT_PUSH_ERROR,
            'Cannot push: repository is in a detached HEAD state. Set git.branch in your config or pass --branch <name>.',
          );
        }
      }
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
      success(`Pushed to ${remote}${branch ? `/${branch}` : ''}`);
    }
  } catch (error) {
    if (error instanceof PublishError) {
      throw error;
    }
    throw createPublishError(
      PublishErrorCode.GIT_PUSH_ERROR,
      `${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
