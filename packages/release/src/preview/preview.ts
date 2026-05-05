import * as fs from 'node:fs';
import type { CIConfig } from '@releasekit/config';
import { loadCIConfig, loadConfig } from '@releasekit/config';
import { info, success, warn } from '@releasekit/core';
import { evaluatePR } from '../gate/evaluate-pr.js';
import { createOctokit, fetchPRLabels, postOrUpdateComment } from '../github.js';
import { DEFAULT_LABELS, detectLabelConflicts } from '../label-utils.js';
import { runRelease } from '../release.js';
import { fetchStandingPRSnapshot, type StandingPRSnapshot } from '../standing-pr/standing-pr.js';
import type { PreviewContext } from './context.js';
import { resolvePreviewContext } from './context.js';
import { detectPrerelease } from './detect.js';
import type { LabelContext } from './format.js';
import { formatPreviewComment } from './format.js';
import { type MergedRow, mergeForPreview } from './merge.js';

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

  // For standing-pr strategy, fetch a read-only snapshot of the current standing PR (link,
  // queued packages, minAge gate state) so the preview can render a true release preview.
  // When `release:immediate` is set, skip the fetch — the preview reflects a direct release,
  // not a queued-state outcome.
  let standingPrSnapshot: StandingPRSnapshot | undefined;
  if (strategy === 'standing-pr' && !labelContext.immediate && context && octokit) {
    try {
      standingPrSnapshot = (await fetchStandingPRSnapshot(octokit, context.owner, context.repo, ciConfig)) ?? undefined;
    } catch {
      // Non-fatal: preview still renders without the snapshot
    }
  }

  // In advisory standing-pr mode, scope the version analysis to only this PR's commits by
  // using the PR's base SHA as the revision range start. Extracted from the GitHub Actions
  // event payload (pull_request.base.sha) — non-fatal if unavailable.
  let prBaseSha: string | undefined;
  if (labelContext.advisoryInStandingPr) {
    const eventPath = process.env.GITHUB_EVENT_PATH;
    if (eventPath && fs.existsSync(eventPath)) {
      try {
        const event = JSON.parse(fs.readFileSync(eventPath, 'utf-8'));
        prBaseSha = event.pull_request?.base?.sha as string | undefined;
      } catch {
        // Non-fatal: fall back to full commit history
      }
    }
  }

  // Run version analysis unless release is skipped or in label mode with no bump label
  let result = null;
  if (!labelContext.skip && !labelContext.noBumpLabel) {
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
      baseRef: prBaseSha,
    });
  } else {
    info('No release label detected — skipping version analysis');
  }

  // Compute the merge prediction when we have both a standing PR snapshot and a current-PR result.
  let mergedRows: MergedRow[] | undefined;
  if (standingPrSnapshot && result) {
    // Scope the current-PR changelogs to packages the standing PR already tracks. Without this,
    // packages this PR touches but the standing PR skips/excludes would appear as new-from-pr rows
    // — a misleading prediction since the standing PR may not release those packages.
    const standingScope = new Set([
      ...standingPrSnapshot.manifest.versionOutput.updates.map((u) => u.packageName),
      ...standingPrSnapshot.manifest.versionOutput.changelogs.map((cl) => cl.packageName),
    ]);
    const currentForMerge = result.versionOutput.changelogs.filter((cl) => standingScope.has(cl.packageName));
    mergedRows = mergeForPreview(standingPrSnapshot.manifest.versionOutput.changelogs, currentForMerge);
  }

  // Format the comment
  const commentBody = formatPreviewComment(result, {
    strategy,
    standingPrNumber: standingPrSnapshot?.number,
    standingPrSnapshot,
    mergedRows,
    labelContext,
  });

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
 * - No bump label → no release (noBumpLabel = true)
 * - `stable`/`prerelease` labels → modifier overrides on top
 * - `skip` label → ignored (redundant, no bump label already means no release)
 * - `scope:*` labels → filter packages by configured scope patterns
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

  const inStandingPr = (ciConfig?.releaseStrategy ?? 'direct') === 'standing-pr';
  const hasImmediate = inStandingPr && prLabels.includes(labels.immediate);
  // In standing-pr mode without `release:immediate`, all bump/scope/channel labels are advisory:
  // they're rendered in the banner but do not drive runRelease. Bumps come from conventional
  // commits in the standing PR; overrides happen by editing labels on the standing PR itself.
  const advisoryInStandingPr = inStandingPr && !hasImmediate;

  const result = { ...options };
  const labelContext: LabelContext = {
    trigger,
    skip: false,
    noBumpLabel: false,
    bumpConflict: false,
    prereleaseConflict: false,
    labels,
    scopeLabels: [],
    advisoryInStandingPr,
    immediate: hasImmediate,
  };

  // Scope labels — multi-scope is supported in preview (gate picks one; preview shows all).
  // Track label names (for the banner) and patterns (for runRelease target) separately so the
  // advisory banner shows e.g. `scope:docs` rather than the configured glob `packages/docs/**`.
  const matchedScopeLabelNames: string[] = [];
  const matchedScopePatterns: string[] = [];
  for (const [labelName, packagePattern] of Object.entries(scopeLabels)) {
    if (prLabels.includes(labelName)) {
      if (advisoryInStandingPr) {
        info(`PR label "${labelName}" seen — advisory in standing-pr mode, no scope filter applied`);
      } else {
        info(`PR label "${labelName}" detected — limiting release to packages matching "${packagePattern}"`);
      }
      matchedScopeLabelNames.push(labelName);
      matchedScopePatterns.push(packagePattern);
    }
  }
  labelContext.scopeLabels = matchedScopeLabelNames;

  // Only propagate scope to the runRelease target when it would actually drive a release.
  // In advisory-standing-pr mode, the labels are recorded for display only.
  if (!advisoryInStandingPr && matchedScopePatterns.length > 0) {
    result.target = matchedScopePatterns.join(', ');
  } else if (!advisoryInStandingPr && !hasImmediate && !options.target && matchedScopePatterns.length === 0) {
    // Only require a scope target when a release is actually going to happen.
    // In label mode with no qualifying labels, release is skipped — no scope needed.
    const willRelease =
      trigger !== 'label' ||
      prLabels.includes(labels.patch) ||
      prLabels.includes(labels.minor) ||
      prLabels.includes(labels.major) ||
      prLabels.includes(labels.stable);

    if (willRelease) {
      const scopeLabelsConfigured = Object.keys(scopeLabels).length > 0;
      throw new Error(
        scopeLabelsConfigured
          ? 'No scope specified. Use --target flag to specify packages, or include a scope label in a merged PR.'
          : 'No scope specified. Use --target flag to specify which packages to release.',
      );
    }
  }

  // In advisory-standing-pr mode, record any bump/channel labels for the banner only —
  // do not propagate to `result`. Version analysis still runs (commit-driven) so the
  // preview can show this PR's contribution to the standing PR via the merge table.
  if (advisoryInStandingPr) {
    if (prLabels.includes(labels.major)) labelContext.bumpLabel = 'major';
    else if (prLabels.includes(labels.minor)) labelContext.bumpLabel = 'minor';
    else if (prLabels.includes(labels.patch)) labelContext.bumpLabel = 'patch';
    if (prLabels.includes(labels.stable)) labelContext.stable = true;
    if (prLabels.includes(labels.prerelease)) labelContext.prerelease = true;
    return { options: result, labelContext };
  }

  if (trigger === 'label') {
    // Single source of truth: the gate's per-PR evaluation. Preview shows exactly the
    // verdict the gate would produce for THIS PR's labels — never lies.
    const evaluation = evaluatePR(context.prNumber, prLabels, labels, ciConfig);
    const conflict = detectLabelConflicts(prLabels, labels);

    if (!evaluation.shouldRelease) {
      labelContext.noBumpLabel = true;
      labelContext.gateReason = evaluation.reason;
      labelContext.bumpConflict = conflict.bumpConflict;
      labelContext.prereleaseConflict = conflict.prereleaseConflict;
      if (conflict.bumpConflict) {
        warn(`Conflicting bump labels detected (${conflict.bumpLabelsPresent.join(', ')}) — release blocked`);
      }
      if (conflict.prereleaseConflict) {
        warn(`Conflicting labels "${labels.stable}" and "${labels.prerelease}" detected — release blocked`);
      }
    } else {
      // Releasing — translate evaluation.bump to PreviewOptions + bumpLabel for the banner.
      const magnitude = magnitudeFromBump(evaluation.bump);
      if (magnitude) {
        info(`PR label "bump:${magnitude}" detected — ${magnitude} release`);
        labelContext.bumpLabel = magnitude;
        result.bump = magnitude;
      }
      if (evaluation.stable) {
        labelContext.stable = true;
        result.stable = true;
      } else if (prLabels.includes(labels.prerelease)) {
        labelContext.prerelease = true;
        result.prerelease = true;
      }
    }

    // Skip label is a no-op in label mode; warn for clarity.
    if (prLabels.includes(labels.skip)) {
      warn(
        `PR label "${labels.skip}" has no effect in label trigger mode — skipping is controlled by not adding bump labels`,
      );
    }

    return { options: result, labelContext };
  }

  // Commit mode — preserve existing override behaviour (skip + major).
  const conflict = detectLabelConflicts(prLabels, labels);

  if (conflict.prereleaseConflict) {
    warn(`Conflicting labels "${labels.stable}" and "${labels.prerelease}" detected — release blocked`);
    labelContext.noBumpLabel = true;
    labelContext.prereleaseConflict = true;
  }

  if (prLabels.includes(labels.skip)) {
    info(`PR label "${labels.skip}" detected — release will be skipped`);
    labelContext.skip = true;
  }

  if (!labelContext.skip && prLabels.includes(labels.major)) {
    info(`PR label "${labels.major}" detected — forcing major release`);
    labelContext.bumpLabel = 'major';
    result.bump = 'major';
  }

  // Stable/prerelease modifiers (commit mode only — label mode handles them in evaluation).
  if (!options.stable && options.prerelease === undefined) {
    if (!(conflict.hasStable && conflict.hasPrerelease)) {
      if (conflict.hasStable) {
        info(`PR label "${labels.stable}" detected — using stable release preview`);
        result.stable = true;
        labelContext.stable = true;
      } else if (conflict.hasPrerelease) {
        info(`PR label "${labels.prerelease}" detected — using prerelease preview`);
        result.prerelease = true;
        labelContext.prerelease = true;
      }
    }
  }

  return { options: result, labelContext };
}

/**
 * Extract the magnitude (major/minor/patch) from a gate bump value. The gate may emit
 * `preminor`, `prepatch`, `premajor`, or `prerelease` — only the first three carry a magnitude.
 */
function magnitudeFromBump(bump: string | undefined): string | undefined {
  if (!bump) return undefined;
  if (bump === 'major' || bump === 'minor' || bump === 'patch') return bump;
  if (bump === 'premajor') return 'major';
  if (bump === 'preminor') return 'minor';
  if (bump === 'prepatch') return 'patch';
  return undefined;
}
