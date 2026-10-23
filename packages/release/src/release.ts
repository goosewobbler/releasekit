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
import { refreshFeederPreviews } from './preview/refresh.js';
import { mergeNotesRegions } from './standing-pr/notes-region.js';
import { runNotesStep, runPublishStep, runVersionStep } from './steps.js';
import type { ReleaseOptions, ReleaseOutput } from './types.js';
import { publishableUpdates } from './version-display.js';

/** With no triggering PR (e.g. manual dispatch) the report goes to the workflow step summary. */
async function resolveReleaseReportTarget(): Promise<{
  forge: Forge;
  prNumber?: number;
  mode: 'direct' | 'manual';
} | null> {
  const githubContext = getGitHubContext();
  if (!githubContext?.token) {
    return null;
  }
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

/** Never throws: the caller re-throws the original pipeline error. */
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
  if (scopeLabels[prefixed]) {
    return scopeLabels[prefixed];
  }
  if (scopeLabels[scopeName]) {
    return scopeLabels[scopeName];
  }
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

  // Per PR: labels from different PRs don't conflict.
  const labels = ciConfig?.labels ?? DEFAULT_LABELS;
  for (const [prNumber, prLabels] of perPRLabels) {
    const conflict = detectLabelConflicts(prLabels, labels);

    if ((ciConfig?.releaseTrigger ?? 'label') === 'commit' && prLabels.includes(labels.skip)) {
      info(`PR #${prNumber} has "${labels.skip}" label — skipping release`);
      return { target: options.target, scopeLabels: [], labels: [], skipped: true };
    }

    if (prLabels.includes(labels.skip)) {
      warn(`PR #${prNumber} has "${labels.skip}" label — this has no effect in label trigger mode`);
    }

    if (conflict.prereleaseConflict) {
      warn(`PR #${prNumber} has conflicting labels "${labels.graduate}" and "${labels.prerelease}" — release blocked`);
      return { target: options.target, scopeLabels: [], labels: [], blocked: true };
    }
    if (conflict.bumpConflict && (ciConfig?.releaseTrigger ?? 'label') === 'label') {
      warn(`PR #${prNumber} has conflicting bump labels (${conflict.bumpLabelsPresent.join(', ')}) — release blocked`);
      return { target: options.target, scopeLabels: [], labels: [], blocked: true };
    }
  }

  if (prNumbers.length === 0) {
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

/** Config can only add skips, never undo a CLI flag. */
function applyStepOverrides(options: ReleaseOptions, releaseConfig: ReleaseConfig | undefined): void {
  if (releaseConfig?.steps) {
    if (!releaseConfig.steps.includes('notes') && !options.skipNotes) {
      options.skipNotes = true;
    }
    if (!releaseConfig.steps.includes('publish') && !options.skipPublish) {
      options.skipPublish = true;
    }
  }

  if (releaseConfig?.ci?.notes === false && !options.skipNotes) {
    options.skipNotes = true;
  }
  if (releaseConfig?.ci?.githubRelease === false && !options.skipGithubRelease) {
    options.skipGithubRelease = true;
  }
}

export async function runRelease(inputOptions: ReleaseOptions): Promise<ReleaseOutput | null> {
  // A copy, so config-driven overrides never mutate the caller's object.
  const options = { ...inputOptions };

  if (options.verbose) {
    setLogLevel('debug');
  }
  if (options.quiet) {
    setQuietMode(true);
  }
  if (options.json) {
    setJsonMode(true);
  }

  let releaseKitConfig: ReturnType<typeof loadReleaseKitConfig>;
  try {
    releaseKitConfig = loadReleaseKitConfig({ cwd: options.projectDir, configPath: options.config });
  } catch (err) {
    error(`Failed to load release config: ${err instanceof Error ? err.message : String(err)}`);
    throw err;
  }
  const releaseConfig = releaseKitConfig.release;
  const ciConfig = releaseKitConfig.ci;

  if (options.scope) {
    if (!ciConfig?.scopeLabels || Object.keys(ciConfig.scopeLabels).length === 0) {
      throw new Error(`--scope "${options.scope}" provided but ci.scopeLabels is not configured`);
    }
    const resolvedTarget = resolveScopeToTarget(options.scope, ciConfig.scopeLabels);
    info(`Scope "${options.scope}" resolved to target: ${resolvedTarget}`);
    options.target = resolvedTarget;
  }

  let effectiveTarget = options.target;

  // Runs in dry-run too, for its conflict detection, but only a real run takes its target: preview handles scope.
  const scopeResult = await applyScopeLabelsFromPR(ciConfig, options);
  if (scopeResult.blocked) {
    info('Release blocked due to conflicting PR labels');
    return null;
  }
  if (scopeResult.skipped) {
    info('Release skipped due to release:skip label');
    return null;
  }
  if (!options.dryRun && scopeResult.target !== options.target) {
    info(`Scope labels override target: ${options.target} → ${scopeResult.target}`);
    effectiveTarget = scopeResult.target;
  }

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

  // Always dryRun: writes are captured as pending so every early-exit guard runs before the repo is touched.
  info('Running version analysis...');
  const versionOutput = await runVersionStep({ ...options, target: effectiveTarget, dryRun: true });
  // Restore the caller's intent; notes and publish inspect this flag.
  versionOutput.dryRun = options.dryRun ?? false;

  if (versionOutput.updates.length === 0) {
    info('No releasable changes found');
    return null;
  }

  const publishableCount = publishableUpdates(versionOutput).length;
  if (releaseConfig?.ci?.minChanges !== undefined && publishableCount < releaseConfig.ci.minChanges) {
    info(`Skipping release: ${publishableCount} package(s) to update, minimum is ${releaseConfig.ci.minChanges}`);
    return null;
  }

  // All guards passed: land the captured writes exactly once.
  let versionFiles: string[] = [];
  if (!options.dryRun) {
    const { flushPendingWrites } = await import('@releasekit/version');
    versionFiles = flushPendingWrites();
  }

  info(`Found ${versionOutput.updates.length} package update(s)`);
  for (const update of versionOutput.updates) {
    const annotation = update.action ? ` (${update.action})` : '';
    info(`  ${update.packageName} → ${update.newVersion}${annotation}`);
  }

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

  // Draft-edited notes win per package; merged here so they reach both the publish step and the return value.
  if (options.editedNotes && Object.keys(options.editedNotes).length > 0) {
    releaseNotes = mergeNotesRegions(releaseNotes ?? {}, options.editedNotes);
    info(`Using human-edited release notes for ${Object.keys(options.editedNotes).length} package(s) from the draft.`);
  }

  let publishOutput: ReleaseOutput['publishOutput'];
  if (!options.skipPublish) {
    info('Publishing...');
    try {
      // Stage what `updates` misses, e.g. a hybrid's Cargo.toml.
      publishOutput = await runPublishStep(versionOutput, options, releaseNotes, [...versionFiles, ...notesFiles]);
    } catch (err) {
      if (err instanceof PipelineError && !options.dryRun) {
        await reportReleaseFailure(versionOutput, err);
      }
      throw err;
    }
    success('Publish complete');

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

      // The release moved `main`, so open feeder PRs' previews are stale.
      await refreshFeederPreviews({ config: options.config, projectDir: options.projectDir });
    }
  }

  return { versionOutput, notesGenerated, packageNotes, releaseNotes, publishOutput };
}
