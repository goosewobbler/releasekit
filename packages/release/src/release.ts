import type { CIConfig, ReleaseConfig } from '@releasekit/config';
import { loadConfig as loadReleaseKitConfig } from '@releasekit/config';
import type { VersionOutput } from '@releasekit/core';
import { error, info, setJsonMode, setLogLevel, setQuietMode, success, warn } from '@releasekit/core';
import type { Forge } from '@releasekit/forge';
import { PipelineError } from '@releasekit/publish';
import { postFailureReport, resolveFailureReportIfPresent } from './failure-report/post.js';
import { getGitHubContext, getHeadCommitMessage, matchesSkipPattern } from './git.js';
import { fetchPRLabels, findMergedPRsForCommit, forgeFor } from './github.js';
import { DEFAULT_LABELS, detectLabelConflicts } from './label-utils.js';
import { runNotesStep, runPublishStep, runVersionStep } from './steps.js';
import type { ReleaseOptions, ReleaseOutput } from './types.js';
import { publishableUpdates } from './version-display.js';

/**
 * Resolve the release-driving PR + mode for the failure report. Direct/label mode: the merged
 * feature PR that triggered the release (discovered from the HEAD commit). Manual dispatch (no
 * PR): mode 'manual' with no PR number — the report goes to the workflow step summary.
 */
async function resolveReleaseReportTarget(): Promise<{
  forge: Forge;
  prNumber?: number;
  mode: 'direct' | 'manual';
} | null> {
  const githubContext = getGitHubContext();
  if (!githubContext?.token) return null;
  const forge = forgeFor({ token: githubContext.token, owner: githubContext.owner, repo: githubContext.repo });
  const { sha } = githubContext;

  const isManualDispatch = process.env.GITHUB_EVENT_NAME === 'workflow_dispatch';
  let prNumber: number | undefined;
  if (sha && !isManualDispatch) {
    const prs = await findMergedPRsForCommit(forge, sha);
    prNumber = prs[0];
  }

  return { forge, prNumber, mode: prNumber !== undefined ? 'direct' : 'manual' };
}

/**
 * Post a partial-publish failure report for a direct/label-mode or manual-dispatch release.
 * Best-effort: never throws (the caller re-throws the original pipeline error).
 */
async function reportReleaseFailure(versionOutput: VersionOutput, err: PipelineError): Promise<void> {
  try {
    const target = await resolveReleaseReportTarget();
    if (!target) {
      warn('No GitHub context — publish-failure report not surfaced');
      return;
    }
    await postFailureReport(
      {
        forge: target.forge,
        mode: target.mode,
        prNumber: target.prNumber,
      },
      versionOutput,
      err,
    );
  } catch (reportErr) {
    warn(
      `Failed to surface publish-failure report: ${reportErr instanceof Error ? reportErr.message : String(reportErr)}`,
    );
  }
}

export function resolveScopeToTarget(scopeName: string, scopeLabels: Record<string, string>): string {
  const prefixed = `scope:${scopeName}`;
  if (scopeLabels[prefixed]) return scopeLabels[prefixed];
  if (scopeLabels[scopeName]) return scopeLabels[scopeName];
  const available = Object.keys(scopeLabels).join(', ');
  throw new Error(`Scope "${scopeName}" not found in ci.scopeLabels. Available: ${available}`);
}

interface PRLabelsResult {
  target: string | undefined;
  scopeLabels: string[];
  labels: string[];
  blocked?: boolean;
  skipped?: boolean;
}

async function applyScopeLabelsFromPR(
  ciConfig: CIConfig | undefined,
  options: ReleaseOptions,
): Promise<PRLabelsResult> {
  const scopeLabels = ciConfig?.scopeLabels ?? {};

  const githubContext = getGitHubContext();
  if (!githubContext?.sha) {
    return { target: options.target, scopeLabels: [], labels: [] };
  }

  const token = githubContext.token;
  if (!token) {
    warn('No GITHUB_TOKEN available — skipping scope label detection');
    return { target: options.target, scopeLabels: [], labels: [] };
  }

  // Skip scope label check for manual workflow_dispatch events
  const githubEventName = process.env.GITHUB_EVENT_NAME;
  if (githubEventName === 'workflow_dispatch') {
    info('Manual workflow_dispatch release — skipping scope label check');
    return { target: options.target, scopeLabels: [], labels: [] };
  }

  const forge = forgeFor({ token, owner: githubContext.owner, repo: githubContext.repo });

  const prNumbers = await findMergedPRsForCommit(forge, githubContext.sha);
  const allLabels: string[] = [];
  const perPRLabels: Map<number, string[]> = new Map();

  for (const prNumber of prNumbers) {
    const labels = await fetchPRLabels(forge, prNumber);
    allLabels.push(...labels);
    perPRLabels.set(prNumber, labels);
  }

  // Check for label conflicts per-PR (not aggregated across PRs)
  // Labels from different PRs don't conflict with each other
  const labels = ciConfig?.labels ?? DEFAULT_LABELS;
  for (const [prNumber, prLabels] of perPRLabels) {
    const conflict = detectLabelConflicts(prLabels, labels);

    // Check for release:skip label (only in commit trigger mode)
    if ((ciConfig?.releaseTrigger ?? 'label') === 'commit' && prLabels.includes(labels.skip)) {
      info(`PR #${prNumber} has "${labels.skip}" label — skipping release`);
      return { target: options.target, scopeLabels: [], labels: [], skipped: true };
    }

    // Warn if skip label is used in label mode (not effective)
    if (prLabels.includes(labels.skip)) {
      warn(`PR #${prNumber} has "${labels.skip}" label — this has no effect in label trigger mode`);
    }

    if (conflict.prereleaseConflict) {
      warn(`PR #${prNumber} has conflicting labels "${labels.stable}" and "${labels.prerelease}" — release blocked`);
      return { target: options.target, scopeLabels: [], labels: [], blocked: true };
    }
    if (conflict.bumpConflict && (ciConfig?.releaseTrigger ?? 'label') === 'label') {
      warn(`PR #${prNumber} has conflicting bump labels (${conflict.bumpLabelsPresent.join(', ')}) — release blocked`);
      return { target: options.target, scopeLabels: [], labels: [], blocked: true };
    }
  }

  if (prNumbers.length === 0) {
    // Manual release (no PR context) - allow releasing all packages if no target specified
    info(`No merged PRs found — ${options.target ? `using target: ${options.target}` : 'releasing all packages'}`);
    return { target: options.target, scopeLabels: [], labels: allLabels };
  }

  const matchedScopePatterns: string[] = [];
  for (const [labelName, packagePattern] of Object.entries(scopeLabels)) {
    if (allLabels.includes(labelName)) {
      info(`Scope label "${labelName}" detected — limiting release to packages matching "${packagePattern}"`);
      matchedScopePatterns.push(packagePattern);
    }
  }

  let finalTarget = options.target;
  if (matchedScopePatterns.length > 0) {
    finalTarget = matchedScopePatterns.join(', ');
  } else if (!options.target) {
    const scopeLabelsConfigured = Object.keys(scopeLabels).length > 0;
    throw new Error(
      scopeLabelsConfigured
        ? 'No scope specified. Use --target flag to specify packages, or include a scope label in a merged PR.'
        : 'No scope specified. Use --target flag to specify which packages to release.',
    );
  }

  return { target: finalTarget, scopeLabels: matchedScopePatterns, labels: allLabels };
}

/**
 * Apply config-driven step overrides to the options object.
 * Priority order: CLI flags (already set on options) > release.ci overrides > release.steps.
 * The CLI always wins because both checks guard with !options.skipX before setting.
 */
function applyStepOverrides(options: ReleaseOptions, releaseConfig: ReleaseConfig | undefined): void {
  // Steps array: a step absent from the list is skipped unless CLI already set the flag.
  if (releaseConfig?.steps) {
    if (!releaseConfig.steps.includes('notes') && !options.skipNotes) options.skipNotes = true;
    if (!releaseConfig.steps.includes('publish') && !options.skipPublish) options.skipPublish = true;
  }

  // ci overrides: can suppress a step even when it appears in 'steps'.
  if (releaseConfig?.ci?.notes === false && !options.skipNotes) options.skipNotes = true;
  if (releaseConfig?.ci?.githubRelease === false && !options.skipGithubRelease) options.skipGithubRelease = true;
}

export async function runRelease(inputOptions: ReleaseOptions): Promise<ReleaseOutput | null> {
  // Work on a copy so config-driven overrides never mutate the caller's object
  const options = { ...inputOptions };

  if (options.verbose) setLogLevel('debug');
  if (options.quiet) setQuietMode(true);
  if (options.json) setJsonMode(true);

  // Load release config for automation behavior
  let releaseKitConfig: ReturnType<typeof loadReleaseKitConfig>;
  try {
    releaseKitConfig = loadReleaseKitConfig({ cwd: options.projectDir, configPath: options.config });
  } catch (err) {
    error(`Failed to load release config: ${err instanceof Error ? err.message : String(err)}`);
    throw err;
  }
  const releaseConfig = releaseKitConfig.release;
  const ciConfig = releaseKitConfig.ci;

  // Resolve --scope flag to target packages if provided
  if (options.scope) {
    if (!ciConfig?.scopeLabels || Object.keys(ciConfig.scopeLabels).length === 0) {
      throw new Error(`--scope "${options.scope}" provided but ci.scopeLabels is not configured`);
    }
    const resolvedTarget = resolveScopeToTarget(options.scope, ciConfig.scopeLabels);
    info(`Scope "${options.scope}" resolved to target: ${resolvedTarget}`);
    options.target = resolvedTarget;
  }

  // Apply scope labels from PR labels (if GitHub context available)
  // Skip in dry-run mode since preview.ts already handles scope labels

  // Determine effective target: CLI target can be overridden by scope labels
  let effectiveTarget = options.target;

  // Only apply scope labels in non-dry-run (release) mode
  // In dry-run/preview mode, preview.ts already handles scope labels via applyLabelOverrides
  // However, we still call applyScopeLabelsFromPR to detect label conflicts (e.g., channel:stable + channel:prerelease)
  const scopeResult = await applyScopeLabelsFromPR(ciConfig, options);
  if (scopeResult.blocked) {
    info('Release blocked due to conflicting PR labels');
    return null;
  }
  if (scopeResult.skipped) {
    info('Release skipped due to release:skip label');
    return null;
  }
  // Only update effectiveTarget in real (non-dry-run) mode;
  // preview.ts already handles scope label targeting in dry-run mode.
  if (!options.dryRun && scopeResult.target !== options.target) {
    info(`Scope labels override target: ${options.target} → ${scopeResult.target}`);
    effectiveTarget = scopeResult.target;
  }

  // Apply skipPatterns: exit early if HEAD commit matches a skip pattern
  if (releaseConfig?.ci?.skipPatterns?.length) {
    const headCommit = await getHeadCommitMessage(options.projectDir);
    if (headCommit) {
      const matchedPattern = matchesSkipPattern(headCommit, releaseConfig.ci.skipPatterns);
      if (matchedPattern) {
        info(`Skipping release: commit message matches skip pattern "${matchedPattern}"`);
        return null;
      }
    }
  }

  applyStepOverrides(options, releaseConfig);

  // --- Step 1: Version ---
  // Always run the version engine with dryRun:true so no files are written yet.
  // File writes are captured as pending writes instead of going to disk, allowing
  // all early-exit guards to be evaluated before the repository is modified.
  info('Running version analysis...');
  const versionOutput = await runVersionStep({ ...options, target: effectiveTarget, dryRun: true });
  // The preflight always runs with dryRun:true, so _jsonData.dryRun is always
  // true in the snapshot. Restore the caller's actual intent before forwarding
  // to downstream steps (notes, publish) that inspect this flag.
  versionOutput.dryRun = options.dryRun ?? false;

  if (versionOutput.updates.length === 0) {
    info('No releasable changes found');
    return null;
  }

  // Apply minChanges threshold before modifying any files. Counts publishable packages only —
  // the root lockstep bump (sync mode) would otherwise inflate the count by one.
  const publishableCount = publishableUpdates(versionOutput).length;
  if (releaseConfig?.ci?.minChanges !== undefined && publishableCount < releaseConfig.ci.minChanges) {
    info(`Skipping release: ${publishableCount} package(s) to update, minimum is ${releaseConfig.ci.minChanges}`);
    return null;
  }

  // All guards passed. For a real (non-dry) run, flush the pending writes captured
  // during the dryRun pass above so version bumps land on disk exactly once.
  if (!options.dryRun) {
    const { flushPendingWrites } = await import('@releasekit/version');
    flushPendingWrites();
  }

  info(`Found ${versionOutput.updates.length} package update(s)`);
  for (const update of versionOutput.updates) {
    // Annotate the resolved version action when present (#420). Absent on manifests produced
    // before the field existed — render nothing rather than an empty parenthetical.
    const annotation = update.action ? ` (${update.action})` : '';
    info(`  ${update.packageName} → ${update.newVersion}${annotation}`);
  }

  // --- Step 2: Notes ---
  let notesGenerated = false;
  let packageNotes: Record<string, string> | undefined;
  let releaseNotes: Record<string, string> | undefined;
  let notesFiles: string[] = [];
  if (!options.skipNotes) {
    info('Generating release notes...');
    const notesResult = await runNotesStep(versionOutput, options);
    packageNotes = notesResult.packageNotes;
    releaseNotes = notesResult.releaseNotes;
    notesFiles = notesResult.files;
    notesGenerated = true;
    success('Release notes generated');
  }

  // --- Step 3: Publish ---
  // The publish step's git-commit stage commits version bumps + changelogs + tags.
  let publishOutput: ReleaseOutput['publishOutput'];
  if (!options.skipPublish) {
    info('Publishing...');
    try {
      publishOutput = await runPublishStep(versionOutput, options, releaseNotes, notesFiles);
    } catch (err) {
      // On a partial-publish failure the pipeline throws a PipelineError carrying the per-package
      // ledger. Surface a failure report on the release-driving PR (or the step summary), then
      // re-throw so the workflow still fails. Skip in dry-run — no real publish happened.
      if (err instanceof PipelineError && !options.dryRun) {
        await reportReleaseFailure(versionOutput, err);
      }
      throw err;
    }
    success('Publish complete');

    // A successful publish clears any prior failure report for this release (resolves it and the
    // supersede warning). Only meaningful for a direct-mode release with a triggering PR.
    if (!options.dryRun) {
      try {
        const target = await resolveReleaseReportTarget();
        if (target?.prNumber !== undefined) {
          await resolveFailureReportIfPresent(target.forge, target.prNumber, versionOutput);
        }
      } catch (resolveErr) {
        warn(
          `Failed to resolve prior publish-failure report: ${resolveErr instanceof Error ? resolveErr.message : String(resolveErr)}`,
        );
      }
    }
  }

  return { versionOutput, notesGenerated, packageNotes, releaseNotes, publishOutput };
}
