import type { CIConfig } from '@releasekit/config';
import { loadCIConfig, loadConfig } from '@releasekit/config';
import { info, success, warn } from '@releasekit/core';
import type { PreviewContext } from './preview-context.js';
import { resolvePreviewContext } from './preview-context.js';
import { detectPrerelease } from './preview-detect.js';
import { formatPreviewComment } from './preview-format.js';
import { createOctokit, fetchPRLabels, postOrUpdateComment } from './preview-github.js';
import { runRelease } from './release.js';

export interface PreviewOptions {
  config?: string;
  projectDir: string;
  pr?: string;
  repo?: string;
  dryRun: boolean;
  prerelease?: string | boolean;
  stable?: boolean;
}

export async function runPreview(options: PreviewOptions): Promise<void> {
  // Check if preview is enabled in config
  const ciConfig = loadCIConfig({ cwd: options.projectDir, configPath: options.config });
  if (ciConfig?.prPreview === false) {
    info('PR preview is disabled in config (ci.prPreview: false)');
    return;
  }

  // Resolve GitHub context early so we can fetch PR labels
  let context: PreviewContext | undefined;
  if (!options.dryRun) {
    try {
      context = resolvePreviewContext({ pr: options.pr, repo: options.repo });
    } catch (error) {
      warn(`Cannot post PR comment: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // Apply label-driven overrides (only when we have GitHub context and no explicit CLI flags)
  const effectiveOptions = await applyLabelOverrides(options, ciConfig, context);

  // Determine prerelease mode
  const releaseConfig = loadConfig({ cwd: effectiveOptions.projectDir, configPath: effectiveOptions.config });
  const prereleaseFlag = resolvePrerelease(
    effectiveOptions,
    releaseConfig.version?.packages ?? [],
    effectiveOptions.projectDir,
  );

  // Run a release dry-run to get the preview data
  info('Analyzing release...');
  const result = await runRelease({
    config: effectiveOptions.config,
    dryRun: true,
    sync: false,
    prerelease: prereleaseFlag,
    skipNotes: true,
    skipPublish: true,
    skipGit: true,
    skipGithubRelease: true,
    skipVerification: true,
    json: false,
    verbose: false,
    quiet: true,
    projectDir: effectiveOptions.projectDir,
  });

  // Format the comment
  const strategy = ciConfig?.releaseStrategy ?? 'manual';
  const commentBody = formatPreviewComment(result, { strategy });

  if (!context) {
    // Dry-run mode or GitHub context unavailable — print to stdout
    console.log(commentBody);
    return;
  }

  info(`Posting preview comment on PR #${context.prNumber}...`);
  const octokit = createOctokit(context.token);
  await postOrUpdateComment(octokit, context.owner, context.repo, context.prNumber, commentBody);
  success(`Preview comment posted on PR #${context.prNumber}`);
}

/**
 * Determine the prerelease flag to pass to runRelease.
 *
 * Priority:
 * 1. --stable → no prerelease (graduation)
 * 2. --prerelease [identifier] → explicit prerelease
 * 3. Auto-detect from current package versions
 */
function resolvePrerelease(
  options: PreviewOptions,
  packagePaths: string[],
  projectDir: string,
): string | boolean | undefined {
  if (options.stable) {
    return undefined;
  }

  if (options.prerelease !== undefined) {
    return options.prerelease;
  }

  // Auto-detect: if current versions are prerelease, default to prerelease preview
  const detected = detectPrerelease(packagePaths, projectDir);
  if (detected.isPrerelease) {
    info(`Detected prerelease version (identifier: ${detected.identifier})`);
    return detected.identifier;
  }

  return undefined;
}

/**
 * Apply PR label-driven overrides to preview options.
 *
 * Label overrides only apply when:
 * - We have a GitHub context (can fetch labels)
 * - The corresponding CLI flag was NOT explicitly set
 *
 * Priority (highest to lowest):
 * 1. CLI flags (--stable, --prerelease)
 * 2. PR labels (ci.labels.stable, ci.labels.prerelease)
 * 3. Auto-detection from package versions
 */
async function applyLabelOverrides(
  options: PreviewOptions,
  ciConfig: CIConfig | undefined,
  context: PreviewContext | undefined,
): Promise<PreviewOptions> {
  if (!context) {
    return options;
  }

  // If both --stable and --prerelease are unset, check PR labels
  if (options.stable || options.prerelease !== undefined) {
    return options;
  }

  const labels = ciConfig?.labels ?? {
    stable: 'release:stable',
    prerelease: 'release:prerelease',
    skip: 'release:skip',
    major: 'release:major',
  };

  let prLabels: string[];
  try {
    const octokit = createOctokit(context.token);
    prLabels = await fetchPRLabels(octokit, context.owner, context.repo, context.prNumber);
  } catch {
    warn('Could not fetch PR labels — skipping label-driven overrides');
    return options;
  }

  const result = { ...options };

  if (prLabels.includes(labels.stable)) {
    info(`PR label "${labels.stable}" detected — using stable release preview`);
    result.stable = true;
  } else if (prLabels.includes(labels.prerelease)) {
    info(`PR label "${labels.prerelease}" detected — using prerelease preview`);
    result.prerelease = true;
  }

  return result;
}
