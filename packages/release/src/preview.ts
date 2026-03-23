import { loadCIConfig } from '@releasekit/config';
import { info, success, warn } from '@releasekit/core';
import type { PreviewContext } from './preview-context.js';
import { resolvePreviewContext } from './preview-context.js';
import { formatPreviewComment } from './preview-format.js';
import { createOctokit, postOrUpdateComment } from './preview-github.js';
import { runRelease } from './release.js';

export interface PreviewOptions {
  config?: string;
  projectDir: string;
  pr?: string;
  repo?: string;
  dryRun: boolean;
}

export async function runPreview(options: PreviewOptions): Promise<void> {
  // Check if preview is enabled in config
  const ciConfig = loadCIConfig({ cwd: options.projectDir, configPath: options.config });
  if (ciConfig?.prPreview === false) {
    info('PR preview is disabled in config (ci.prPreview: false)');
    return;
  }

  // Run a release dry-run to get the preview data
  info('Analyzing release...');
  const result = await runRelease({
    config: options.config,
    dryRun: true,
    sync: false,
    skipNotes: true,
    skipPublish: true,
    skipGit: true,
    skipGithubRelease: true,
    skipVerification: true,
    json: false,
    verbose: false,
    quiet: true,
    projectDir: options.projectDir,
  });

  // Format the comment
  const commentBody = formatPreviewComment(result);

  if (options.dryRun) {
    // Print to stdout instead of posting
    console.log(commentBody);
    return;
  }

  // Resolve GitHub context and post/update comment
  let context: PreviewContext;
  try {
    context = resolvePreviewContext({ pr: options.pr, repo: options.repo });
  } catch (error) {
    warn(`Cannot post PR comment: ${error instanceof Error ? error.message : String(error)}`);
    // Still print the comment so it's visible in CI logs
    console.log(commentBody);
    return;
  }

  info(`Posting preview comment on PR #${context.prNumber}...`);
  const octokit = createOctokit(context.token);
  await postOrUpdateComment(octokit, context.owner, context.repo, context.prNumber, commentBody);
  success(`Preview comment posted on PR #${context.prNumber}`);
}
