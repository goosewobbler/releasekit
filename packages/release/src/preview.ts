import type { CIConfig } from '@releasekit/config';
import { loadCIConfig, loadConfig } from '@releasekit/config';
import { info, success, warn } from '@releasekit/core';
import { DEFAULT_LABELS, detectLabelConflicts } from './label-utils.js';
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
  target?: string;
}

interface LabelOverrideResult {
  options: PreviewOptions;
  labelContext: LabelContext;
}

export async function runPreview(options: PreviewOptions): Promise<void> {
  // Check if preview is enabled in config
  const ciConfig = loadCIConfig({ cwd: options.projectDir, configPath: options.config });
  if (ciConfig?.prPreview === false) {
    info('PR preview is disabled in config (ci.prPreview: false)');
    return;
  }

  // Resolve GitHub context early so we can fetch PR labels
  // Note: We create Octokit here and reuse it in applyLabelOverrides to avoid creating multiple instances
  let context: PreviewContext | undefined;
  let octokit: ReturnType<typeof createOctokit> | undefined;
  if (!options.dryRun) {
    try {
      context = resolvePreviewContext({ pr: options.pr, repo: options.repo });
      octokit = createOctokit(context.token);
    } catch (error) {
      warn(`Cannot post PR comment: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // Apply label-driven overrides (pass octokit to avoid creating a second instance)
  const { options: effectiveOptions, labelContext } = await applyLabelOverrides(options, ciConfig, context, octokit);

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
      stable: effectiveOptions.stable,
      skipNotes: true,
      skipPublish: true,
      skipGit: true,
      skipGithubRelease: true,
      skipVerification: true,
      json: false,
      verbose: false,
      quiet: true,
      projectDir: effectiveOptions.projectDir,
      target: effectiveOptions.target,
    });
  } else {
    info('No release label detected — skipping version analysis');
  }

  // Format the comment
  const commentBody = formatPreviewComment(result, { strategy, labelContext });

  if (!context || !octokit) {
    // Dry-run mode or GitHub context unavailable — print to stdout
    console.log(commentBody);
    return;
  }

  info(`Posting preview comment on PR #${context.prNumber}...`);
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
 * - `scope:*` labels → filter packages by configured scope patterns
 *
 * **label mode**:
 * - `major`/`minor`/`patch` labels → required to trigger release, determines bump type
 * - No bump label → no release (noBumpLabel = true), UNLESS scope:* labels are present (then use conventional commits)
 * - `stable`/`prerelease` labels → modifier overrides on top
 * - `skip` label → ignored (redundant, no bump label already means no release)
 * - `scope:*` labels → filter packages by configured scope patterns (allows conventional commits bump)
 *
 * CLI flags always take highest priority over labels.
 */
async function applyLabelOverrides(
  options: PreviewOptions,
  ciConfig: CIConfig | undefined,
  context: PreviewContext | undefined,
  existingOctokit?: ReturnType<typeof createOctokit>,
): Promise<LabelOverrideResult> {
  const trigger = ciConfig?.releaseTrigger ?? 'label';
  const labels = ciConfig?.labels ?? DEFAULT_LABELS;
  const scopeLabels = ciConfig?.scopeLabels ?? {};
  const defaultLabelContext: LabelContext = {
    trigger,
    skip: false,
    noBumpLabel: false,
    bumpConflict: false,
    prereleaseConflict: false,
  };

  if (!context) {
    // No GitHub context (dry-run or unavailable). If the caller explicitly supplied --bump,
    // honour it so that `releasekit preview --dry-run --bump minor` still produces useful output.
    return {
      options,
      labelContext: { ...defaultLabelContext, noBumpLabel: trigger === 'label' && !options.bump, labels },
    };
  }

  let prLabels: string[];
  const octokitToUse = existingOctokit ?? createOctokit(context.token);
  try {
    prLabels = await fetchPRLabels(octokitToUse, context.owner, context.repo, context.prNumber);
  } catch {
    warn('Could not fetch PR labels — skipping label-driven overrides');
    return {
      options,
      labelContext: { ...defaultLabelContext, noBumpLabel: trigger === 'label', labels },
    };
  }

  const result = { ...options };
  const labelContext: LabelContext = {
    trigger,
    skip: false,
    noBumpLabel: false,
    bumpConflict: false,
    prereleaseConflict: false,
    labels,
    scopeLabels: [],
  };

  // Handle scope labels - build list of matched scope patterns
  const matchedScopePatterns: string[] = [];
  for (const [labelName, packagePattern] of Object.entries(scopeLabels)) {
    if (prLabels.includes(labelName)) {
      info(`PR label "${labelName}" detected — limiting release to packages matching "${packagePattern}"`);
      matchedScopePatterns.push(packagePattern);
    }
  }
  labelContext.scopeLabels = matchedScopePatterns;

  // Apply scope filter if any scope labels matched, otherwise use defaultScope if configured
  if (matchedScopePatterns.length > 0) {
    result.target = matchedScopePatterns.join(', ');
  } else if (ciConfig?.defaultScope && scopeLabels[ciConfig.defaultScope]) {
    const defaultPattern = scopeLabels[ciConfig.defaultScope];
    info(`No scope label found — using default scope "${ciConfig.defaultScope}" (${defaultPattern})`);
    result.target = defaultPattern;
  }

  // Detect label conflicts using shared utility
  const conflict = detectLabelConflicts(prLabels, labels);

  // Bump conflicts only matter in label mode (in commit mode only release:major is meaningful)
  if (trigger === 'label' && conflict.bumpConflict) {
    warn(`Conflicting bump labels detected (${conflict.bumpLabelsPresent.join(', ')}) — release blocked`);
    labelContext.noBumpLabel = true;
    labelContext.bumpConflict = true;
  }

  if (conflict.prereleaseConflict) {
    warn(`Conflicting labels "${labels.stable}" and "${labels.prerelease}" detected — release blocked`);
    labelContext.noBumpLabel = true;
    labelContext.prereleaseConflict = true;
  }

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
    // Skip processing individual labels if there's a conflict
    if (conflict.bumpConflict || conflict.prereleaseConflict) {
      // Already warned and set noBumpLabel = true above
    } else if (prLabels.includes(labels.major)) {
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
    } else if (matchedScopePatterns.length === 0) {
      // No bump label AND no scope labels → require release label in label mode
      // But allow if stable/prerelease label is present
      const hasStableOrPrerelease = conflict.hasStable || conflict.hasPrerelease;
      if (!hasStableOrPrerelease) {
        labelContext.noBumpLabel = true;
      }
    }
    // If scope labels are present but no release label, we don't set noBumpLabel = true
    // This allows conventional commits to determine the bump
  }

  // Stable/prerelease label modifiers (both modes, only when CLI flags unset)
  if (!options.stable && options.prerelease === undefined) {
    if (conflict.hasStable && conflict.hasPrerelease) {
      // Already handled in conflict detection above
    } else if (conflict.hasStable) {
      info(`PR label "${labels.stable}" detected — using stable release preview`);
      result.stable = true;
    } else if (conflict.hasPrerelease) {
      info(`PR label "${labels.prerelease}" detected — using prerelease preview`);
      result.prerelease = true;
      // Default to patch bump when only prerelease label is present
      if (!result.bump) {
        info('No bump label found — defaulting to patch bump for prerelease release');
        result.bump = 'patch';
        labelContext.bumpLabel = 'patch';
      }
    }
  }

  return { options: result, labelContext: { ...labelContext, labels } };
}
