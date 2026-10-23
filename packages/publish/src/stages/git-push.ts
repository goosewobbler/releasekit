import { info, success } from '@releasekit/core';
import { createGitCli } from '@releasekit/git';
import { createPublishError, PublishError, PublishErrorCode } from '../errors/index.js';
import type { PipelineContext } from '../types.js';
import { detectGitPushMethod } from '../utils/auth.js';
import { runGit } from '../utils/git.js';

function toGithubAuthedUrl(remoteUrl: string, token: string): string | undefined {
  try {
    const url = new URL(remoteUrl);
    if (url.protocol !== 'https:') {
      return undefined;
    }
    if (url.host !== 'github.com') {
      return undefined;
    }

    // GitHub's recommended username for token auth.
    url.username = 'x-access-token';
    url.password = token;
    return url.toString();
  } catch {
    return undefined;
  }
}

function pushesBranch(ctx: PipelineContext): boolean {
  return ctx.output.git.committed || ctx.releaseCommitReused === true;
}

export interface PushSetup {
  remote: string;
  pushRemote: string;
  branch?: string;
}

export async function preparePushSetup(ctx: PipelineContext): Promise<PushSetup | null> {
  const { config, cwd } = ctx;

  if (!config.git.push) {
    return null;
  }

  const { remote } = config.git;
  const git = createGitCli();

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
    const remoteUrl = (await git.remoteUrl(remote, cwd)) ?? '';
    const authed = toGithubAuthedUrl(remoteUrl, httpsToken);
    if (authed) {
      pushRemote = authed;
    }
  }

  let branch: string | undefined;
  if (pushesBranch(ctx)) {
    branch = config.git.branch;
    if (!branch) {
      branch = await git.currentBranch(cwd);
      if (branch === 'HEAD') {
        throw createPublishError(
          PublishErrorCode.GIT_PUSH_ERROR,
          'Cannot push: repository is in a detached HEAD state. Set git.branch in your config or pass --branch <name>.',
        );
      }
    }
  }

  return { remote, pushRemote, branch };
}

export async function pushPackageTag(tag: string, ctx: PipelineContext, setup?: PushSetup): Promise<void> {
  const { config, cliOptions, cwd, output } = ctx;
  const dryRun = cliOptions.dryRun;

  if (!config.git.push) {
    return;
  }

  const git = createGitCli();

  const resolvedSetup =
    setup ||
    ((await preparePushSetup(ctx)) ??
      (() => {
        throw createPublishError(PublishErrorCode.GIT_PUSH_ERROR, 'Git push disabled');
      })());

  const { remote, pushRemote, branch } = resolvedSetup;

  try {
    if (pushesBranch(ctx) && branch) {
      await runGit(dryRun, `git push ${remote} ${branch}`, () => git.push({ remote: pushRemote, ref: branch, cwd }));
    }

    await runGit(dryRun, `git push ${remote} refs/tags/${tag}`, () =>
      git.push({ remote: pushRemote, ref: `refs/tags/${tag}`, cwd }),
    );
    output.git.tags.push(tag);

    output.git.pushed = true;
  } catch (error) {
    if (error instanceof PublishError) {
      throw error;
    }
    // Wrapped so the failure report labels the stage `git-push`, not `unknown`.
    throw createPublishError(PublishErrorCode.GIT_PUSH_ERROR, error instanceof Error ? error.message : String(error));
  }
}

/** Error strategy: THROWS. */
export async function runGitPushStage(ctx: PipelineContext): Promise<void> {
  const { config, cliOptions, cwd, output } = ctx;
  const dryRun = cliOptions.dryRun;

  if (!config.git.push) {
    info('Git push disabled in config, skipping');
    return;
  }

  if (!pushesBranch(ctx) && output.git.tags.length === 0) {
    info('Nothing to push (no commits or tags created)');
    return;
  }

  const { remote } = config.git;
  const git = createGitCli();

  let pushMethod = config.git.pushMethod;
  if (pushMethod === 'auto') {
    try {
      pushMethod = await detectGitPushMethod(remote, cwd);
    } catch {
      pushMethod = 'https';
    }
  }

  const httpsTokenEnv = config.git.httpsTokenEnv;
  const httpsToken = httpsTokenEnv ? process.env[httpsTokenEnv] : undefined;

  try {
    // An authed push URL avoids workflow-specific remote rewriting.
    let pushRemote: string = remote;
    if (pushMethod === 'https' && httpsToken) {
      const remoteUrl = (await git.remoteUrl(remote, cwd)) ?? '';
      const authed = toGithubAuthedUrl(remoteUrl, httpsToken);
      if (authed) {
        pushRemote = authed;
      }
    }

    // Branch before tags, so a tag never points at a commit absent from the branch and a branch rejected by a
    // concurrent push or ruleset aborts before any tag lands (orphan tags with `git.pushed` false get no GitHub
    // release). Standing-PR mode pushes tags only. Branch resolution lives inside the guard so a tags-only push
    // never trips the detached-HEAD check.
    let branch: string | undefined;
    if (pushesBranch(ctx)) {
      branch = config.git.branch;
      if (!branch) {
        branch = await git.currentBranch(cwd);
        if (branch === 'HEAD') {
          throw createPublishError(
            PublishErrorCode.GIT_PUSH_ERROR,
            'Cannot push: repository is in a detached HEAD state. Set git.branch in your config or pass --branch <name>.',
          );
        }
      }
      await runGit(dryRun, `git push ${remote} ${branch}`, () => git.push({ remote: pushRemote, ref: branch, cwd }));
    }

    for (const tag of new Set(output.git.tags)) {
      await runGit(dryRun, `git push ${remote} refs/tags/${tag}`, () =>
        git.push({ remote: pushRemote, ref: `refs/tags/${tag}`, cwd }),
      );
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
