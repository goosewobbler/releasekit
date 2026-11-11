import type { ReleaseConfig, ReleaseKitConfig } from '@releasekit/config';
import { assertLlmModel, loadConfig as loadReleaseKitConfig, runsLlmTasks } from '@releasekit/config';
import type { VersionOutput } from '@releasekit/core';
import { error, info, setJsonMode, setLogLevel, setQuietMode, success, warn } from '@releasekit/core';
import type { Forge } from '@releasekit/forge';
import { PipelineError } from '@releasekit/publish';
import { postFailureReport, resolveFailureReportIfPresent } from './failure-report/post.js';
import { decideFromMergedPRs, type GateOutput } from './gate/gate.js';
import { getGitHubContext, getHeadCommitMessage, matchesSkipPattern } from './git.js';
import { findMergedPRsForCommit, forgeFor, PRLookupError } from './github.js';
import { resolveScopeToTarget } from './label-utils.js';
import { markFeederPreviewsStale } from './preview/stale.js';
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
    try {
      prNumber = (await findMergedPRsForCommit(forge, sha))[0];
    } catch {
      // Without the PR the report still reaches the step summary.
    }
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

/** Null when no merged PR has a say, so commits and flags alone decide. */
async function decideFromPRs(releaseKitConfig: ReleaseKitConfig, projectDir: string): Promise<GateOutput | null> {
  const githubContext = getGitHubContext();
  if (!githubContext?.sha) {
    return null;
  }
  if (!githubContext.token) {
    warn('No GITHUB_TOKEN available, so merged PR labels are ignored');
    return null;
  }
  if (process.env.GITHUB_EVENT_NAME === 'workflow_dispatch') {
    info('Manual workflow_dispatch release: merged PR labels are ignored');
    return null;
  }

  const forge = forgeFor({ token: githubContext.token, owner: githubContext.owner, repo: githubContext.repo });
  let pushedPRs: number[];
  try {
    pushedPRs = await findMergedPRsForCommit(forge, githubContext.sha);
  } catch (err) {
    throw new PRLookupError(
      `Could not look up the PR for ${githubContext.sha}: ${err instanceof Error ? err.message : String(err)}. ` +
        'Grant the workflow token `pull-requests: read`.',
    );
  }
  // A direct push is released on its own say, not by labels on PRs that merged before it.
  if (pushedPRs.length === 0) {
    info('The pushed commit is not from a merged PR, so merged PR labels are ignored');
    return null;
  }
  // A failed lookup throws rather than releasing from commits: labels can block or change a release, and a re-run is
  // cheaper than a wrong version.
  const verdict = await decideFromMergedPRs({ forge, releaseKitConfig, projectDir });
  return verdict.prNumbers.length > 0 ? verdict : null;
}

/** CLI flags win: `--bump`, `--stable` or `--prerelease` replace the PR's bump and channel, `--target` its scope. */
function applyVerdict(options: ReleaseOptions, verdict: GateOutput): void {
  if (options.bump === undefined && !options.stable && options.prerelease === undefined) {
    options.bump = verdict.bump;
    options.stable = verdict.stable;
  }
  options.target ??= verdict.target;
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

  const verdict = options.skipGate ? null : await decideFromPRs(releaseKitConfig, options.projectDir);
  if (verdict?.blocked) {
    warn(`Release blocked: ${verdict.reason}`);
    return null;
  }
  const standingRefusal = verdict?.evaluations.find((e) => e.refusedStandingPr);
  if (standingRefusal) {
    // Fail rather than skip, so the job's next step doesn't reconcile the standing PR while it publishes.
    throw new Error(standingRefusal.reason);
  }
  if (verdict && !verdict.shouldRelease) {
    info(`Not releasing: ${verdict.reason}`);
    return null;
  }
  if (verdict) {
    applyVerdict(options, verdict);
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
  const versionOutput = await runVersionStep({ ...options, dryRun: true });
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

  // Before the writes land, so a missing model leaves the working tree untouched.
  const llm = releaseKitConfig.notes?.releaseNotes ? releaseKitConfig.notes.releaseNotes.llm : undefined;
  if (!options.skipNotes && llm && runsLlmTasks(llm, options.skipReleaseNotes)) {
    assertLlmModel(llm);
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

      const branch = publishOutput?.git.branch;
      if (branch) {
        await markFeederPreviewsStale({ ciConfig, branch });
      }
    }
  }

  return { versionOutput, notesGenerated, packageNotes, releaseNotes, publishOutput };
}
