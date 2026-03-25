import type { CIConfig } from '@releasekit/config';
import { loadCIConfig, loadConfig } from '@releasekit/config';
import { info, success, warn } from '@releasekit/core';
import type { PreviewContext } from './preview-context.js';
import { resolvePreviewContext } from './preview-context.js';
import { detectPrerelease } from './preview-detect.js';
import type { LabelContext } from './preview-format.js';
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
  bump?: string;
}

interface LabelOverrideResult {
  options: PreviewOptions;
  labelContext: LabelContext;
}

const DEFAULT_LABELS = {
  stable: 'release:stable',
  prerelease: 'release:prerelease',
  skip: 'release:skip',
  major: 'release:major',
  minor: 'release:minor',
  patch: 'release:patch',
};

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

  // Apply label-driven overrides
  const { options: effectiveOptions, labelContext } = await applyLabelOverrides(options, ciConfig, context);

  const strategy = ciConfig?.releaseStrategy ?? 'direct';

  // Run version analysis unless in label mode with no bump label. When no
  // bump label is present, skip the analysis but still format and post/print
  // the comment so the PR receives an actionable "add a label" note.
  let result = null;
  if (!labelContext.noBumpLabel) {
    // Determine prerelease mode
    const releaseConfig = loadConfig({ cwd: effectiveOptions.projectDir, configPath: effectiveOptions.config });
    const prereleaseFlag = resolvePrerelease(
      effectiveOptions,
      releaseConfig.version?.packages ?? [],
      effectiveOptions.projectDir,
    );

    info('Analyzing release...');
    result = await runRelease({
      config: effectiveOptions.config,
      dryRun: true,
      sync: false,
      bump: effectiveOptions.bump,
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
  } else {
    info('No release label detected — skipping version analysis');
  }

  // Format the comment
  const commentBody = formatPreviewComment(result, { strategy, labelContext });

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
 * Behavior depends on `releaseTrigger`:
 *
 * **commit mode** (default):
 * - `skip` label → marks release as skipped (preview still shows what would release)
 * - `major` label → forces major bump override
 * - `stable`/`prerelease` labels → modifier overrides (when CLI flags unset)
 *
 * **label mode**:
 * - `major`/`minor`/`patch` labels → required to trigger release, determines bump type
 * - No bump label → no release (noBumpLabel = true)
 * - `stable`/`prerelease` labels → modifier overrides on top
 * - `skip` label → ignored (redundant, no bump label already means no release)
 *
 * CLI flags always take highest priority over labels.
 */
async function applyLabelOverrides(
  options: PreviewOptions,
  ciConfig: CIConfig | undefined,
  context: PreviewContext | undefined,
): Promise<LabelOverrideResult> {
  const trigger = ciConfig?.releaseTrigger ?? 'label';
  const labels = ciConfig?.labels ?? DEFAULT_LABELS;
  const defaultLabelContext: LabelContext = { trigger, skip: false, noBumpLabel: false };

  if (!context) {
    return {
      options,
      labelContext: { ...defaultLabelContext, noBumpLabel: trigger === 'label', labels },
    };
  }

  let prLabels: string[];
  try {
    const octokit = createOctokit(context.token);
    prLabels = await fetchPRLabels(octokit, context.owner, context.repo, context.prNumber);
  } catch {
    warn('Could not fetch PR labels — skipping label-driven overrides');
    return {
      options,
      labelContext: { ...defaultLabelContext, noBumpLabel: trigger === 'label', labels },
    };
  }

  const result = { ...options };
  const labelContext: LabelContext = { trigger, skip: false, noBumpLabel: false, labels };

  if (trigger === 'commit') {
    // Skip label check
    if (prLabels.includes(labels.skip)) {
      info(`PR label "${labels.skip}" detected — release will be skipped`);
      labelContext.skip = true;
    }

    // Major label override (only if not skipped)
    if (!labelContext.skip && prLabels.includes(labels.major)) {
      info(`PR label "${labels.major}" detected — forcing major release`);
      labelContext.bumpLabel = 'major';
      result.bump = 'major';
    }
  } else {
    // Label mode: bump label required
    if (prLabels.includes(labels.major)) {
      info(`PR label "${labels.major}" detected — major release`);
      labelContext.bumpLabel = 'major';
      result.bump = 'major';
    } else if (prLabels.includes(labels.minor)) {
      info(`PR label "${labels.minor}" detected — minor release`);
      labelContext.bumpLabel = 'minor';
      result.bump = 'minor';
    } else if (prLabels.includes(labels.patch)) {
      info(`PR label "${labels.patch}" detected — patch release`);
      labelContext.bumpLabel = 'patch';
      result.bump = 'patch';
    } else {
      labelContext.noBumpLabel = true;
    }
  }

  // Stable/prerelease label modifiers (both modes, only when CLI flags unset)
  if (!options.stable && options.prerelease === undefined) {
    if (prLabels.includes(labels.stable)) {
      info(`PR label "${labels.stable}" detected — using stable release preview`);
      result.stable = true;
    } else if (prLabels.includes(labels.prerelease)) {
      info(`PR label "${labels.prerelease}" detected — using prerelease preview`);
      result.prerelease = true;
    }
  }

  return { options: result, labelContext: { ...labelContext, labels } };
}
