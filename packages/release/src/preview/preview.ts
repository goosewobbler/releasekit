import * as fs from 'node:fs';
import type { CIConfig } from '@releasekit/config';
import { loadCIConfig, loadConfig } from '@releasekit/config';
import { info, success, warn } from '@releasekit/core';
import type { Forge } from '@releasekit/forge';
import { createGitCli } from '@releasekit/git';
import { renderSupersedeWarning } from '../failure-report/failure-report.js';
import { detectUnresolvedFailure } from '../failure-report/post.js';
import { evaluatePR } from '../gate/evaluate-pr.js';
import { getHeadParents } from '../git.js';
import { fetchPRLabels, forgeFor, postOrUpdateComment } from '../github.js';
import { composeBumpFromLabels, DEFAULT_LABELS, detectLabelConflicts } from '../label-utils.js';
import { runRelease } from '../release.js';
import { type ChangelogRenderOptions, changelogRenderOptions } from '../standing-pr/changelog-region.js';
import {
  fetchStandingPRSnapshot,
  findLatestMergedStandingPR,
  type StandingPRSnapshot,
} from '../standing-pr/standing-pr.js';
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

interface PullRequestEvent {
  pull_request?: { number?: number; head?: { ref?: string; sha?: string }; base?: { ref?: string; sha?: string } };
}

function readEventPayload(): PullRequestEvent | undefined {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath || !fs.existsSync(eventPath)) {
    return undefined;
  }
  try {
    return JSON.parse(fs.readFileSync(eventPath, 'utf-8')) as PullRequestEvent;
  } catch {
    return undefined;
  }
}

export async function runPreview(options: PreviewOptions): Promise<void> {
  const ciConfig = loadCIConfig({ cwd: options.projectDir, configPath: options.config });
  if (ciConfig?.prPreview?.enabled === false) {
    info('PR preview is disabled in config (ci.prPreview.enabled: false)');
    return;
  }

  const strategy = ciConfig?.releaseStrategy ?? 'direct';
  const event = readEventPayload();

  // The standing PR's head already carries the release-prep bump, so re-analysing it would double-count the version.
  if (
    strategy === 'standing-pr' &&
    event?.pull_request?.head?.ref === (ciConfig?.standingPr?.branch ?? 'release/next')
  ) {
    info('Skipping preview: this PR is the standing release PR (its manifest comment is authoritative).');
    return;
  }

  let context: PreviewContext | undefined;
  let forge: Forge | undefined;
  if (!options.dryRun) {
    try {
      context = resolvePreviewContext({ pr: options.pr, repo: options.repo });
      forge = forgeFor(context);
    } catch (error) {
      warn(`Cannot post PR comment: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const { options: effectiveOptions, labelContext } = await applyLabelOverrides(options, ciConfig, context, forge);

  // With `release:immediate` the preview reflects a direct release, not the queued standing PR.
  let standingPrSnapshot: StandingPRSnapshot | undefined;
  let supersedeWarning: string[] | undefined;
  if (strategy === 'standing-pr' && !labelContext.immediate && context && forge) {
    try {
      standingPrSnapshot = (await fetchStandingPRSnapshot(forge, ciConfig)) ?? undefined;
    } catch {
      // Non-fatal: preview still renders without the snapshot
    }

    try {
      const branch = ciConfig?.standingPr?.branch ?? 'release/next';
      const latestMerged = await findLatestMergedStandingPR(forge, branch);
      if (latestMerged !== null) {
        const unresolved = await detectUnresolvedFailure(forge, latestMerged);
        if (unresolved) {
          supersedeWarning = renderSupersedeWarning({
            previousLabel: unresolved.previousLabel,
            published: unresolved.published,
            total: unresolved.total,
            standingPrNumber: unresolved.prNumber,
            retryLabelAvailable: true,
          });
        }
      }
    } catch {
      // Non-fatal: preview still renders without the warning
    }
  }

  let result = null;
  let changelogRender: ChangelogRenderOptions | undefined;
  if (!labelContext.skip && !labelContext.noBumpLabel) {
    const releaseConfig = loadConfig({ cwd: effectiveOptions.projectDir, configPath: effectiveOptions.config });
    // Advisory mode scopes the analysis to this PR's commits.
    const prBaseSha = labelContext.advisoryInStandingPr
      ? await resolvePRBase(
          event,
          context?.prNumber,
          effectiveOptions.projectDir,
          releaseConfig.git?.remote ?? 'origin',
        )
      : undefined;
    changelogRender = changelogRenderOptions(releaseConfig);
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

  let mergedRows: MergedRow[] | undefined;
  if (standingPrSnapshot && result) {
    // Only packages the standing PR tracks; ones it skips would otherwise show as misleading new-from-pr rows.
    const standingScope = new Set([
      ...standingPrSnapshot.manifest.versionOutput.updates.map((u) => u.packageName),
      ...standingPrSnapshot.manifest.versionOutput.changelogs.map((cl) => cl.packageName),
    ]);
    const currentForMerge = result.versionOutput.changelogs.filter((cl) => standingScope.has(cl.packageName));
    mergedRows = mergeForPreview(standingPrSnapshot.manifest.versionOutput.changelogs, currentForMerge);
  }

  const commentBody = formatPreviewComment(result, {
    strategy,
    standingPrNumber: standingPrSnapshot?.number,
    standingPrSnapshot,
    mergedRows,
    labelContext,
    supersedeWarning,
    ...changelogRender,
  });

  if (!context || !forge) {
    // biome-ignore lint/suspicious/noConsole: no PR to post to (dry run or no GitHub context), so print it
    console.log(commentBody);
    return;
  }

  info(`Posting preview comment on PR #${context.prNumber}...`);
  await postOrUpdateComment(forge, context.prNumber, commentBody);
  success(`Preview comment posted on PR #${context.prNumber}`);
}

/** `pull_request.base.sha` can lag the base branch, so commits merged there after it would count as this PR's. */
async function resolvePRBase(
  event: PullRequestEvent | undefined,
  prNumber: number | undefined,
  projectDir: string,
  remote: string,
): Promise<string | undefined> {
  const pr = event?.pull_request;
  // With `--pr`, the run's event may be another PR's, or not a PR event at all.
  if (!pr || (pr.number !== undefined && prNumber !== undefined && pr.number !== prNumber)) {
    warn(
      `This run has no pull_request event for ${prNumber ? `PR #${prNumber}` : 'the PR'}, so the preview counts every unreleased commit on the base branch, not just the PR's own.`,
    );
    return undefined;
  }
  if (pr.head?.sha) {
    const parents = await getHeadParents(projectDir);
    // GitHub's merge ref: the base branch tip merged with the PR head.
    if (parents.length === 2 && parents[1] === pr.head.sha) {
      return parents[0];
    }
  }
  // actions/checkout always names its remote `origin`, whatever `git.remote` pushes to.
  const remotes = [...new Set([remote, 'origin'])];
  if (pr.base?.ref) {
    for (const name of remotes) {
      const base = await createGitCli().mergeBase('HEAD', `refs/remotes/${name}/${pr.base.ref}`, projectDir);
      if (base) {
        return newerBase(base, pr.base.sha, projectDir);
      }
    }
  }
  if (!pr.base?.sha) {
    return undefined;
  }
  const baseRef = pr.base.ref;
  const mergeRef = pr.head?.sha ? "HEAD isn't its merge ref" : 'the event names no head commit';
  const mergeBase = baseRef
    ? `HEAD has no merge base with ${remotes.map((name) => `${name}/${baseRef}`).join(' or ')} (not fetched, or the history is too shallow)`
    : 'the event names no base branch';
  warn(
    `Could not find this PR's base commit: ${mergeRef}, and ${mergeBase}. The preview scopes from where HEAD meets pull_request.base.sha, which can lag the base branch and count commits merged there as this PR's.`,
  );
  // On a PR-head checkout base.sha can be newer than where the PR branched, and the version engine reads a base
  // outside HEAD's history as "all history".
  return (await createGitCli().mergeBase('HEAD', pr.base.sha, projectDir)) ?? pr.base.sha;
}

/** A fork's or out-of-date `origin/<base>` gives a merge base older than `base.sha`. */
async function newerBase(mergeBase: string, eventBase: string | undefined, projectDir: string): Promise<string> {
  if (!eventBase || eventBase === mergeBase) {
    return mergeBase;
  }
  const git = createGitCli();
  const eventBaseIsNewer =
    (await git.isAncestor(mergeBase, eventBase, projectDir)) && (await git.isAncestor(eventBase, 'HEAD', projectDir));
  return eventBaseIsNewer ? eventBase : mergeBase;
}

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

  const detected = detectPrerelease(packagePaths, projectDir);
  if (detected.isPrerelease) {
    info(`Detected prerelease version (identifier: ${detected.identifier})`);
    return detected.identifier;
  }

  return undefined;
}

async function applyLabelOverrides(
  options: PreviewOptions,
  ciConfig: CIConfig | undefined,
  context: PreviewContext | undefined,
  existingForge?: Forge,
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
    // Honour an explicit --bump so `preview --dry-run --bump minor` still produces useful output.
    return {
      options,
      labelContext: { ...defaultLabelContext, noBumpLabel: trigger === 'label' && !options.bump, labels },
    };
  }

  let prLabels: string[];
  const forgeToUse = existingForge ?? forgeFor(context);
  try {
    prLabels = await fetchPRLabels(forgeToUse, context.prNumber);
  } catch {
    warn('Could not fetch PR labels — skipping label-driven overrides');
    return {
      options,
      labelContext: { ...defaultLabelContext, noBumpLabel: trigger === 'label', labels },
    };
  }

  const inStandingPr = (ciConfig?.releaseStrategy ?? 'direct') === 'standing-pr';
  const hasImmediate = inStandingPr && prLabels.includes(labels.immediate);
  // Without `release:immediate`, feeder labels are advisory: shown in the banner but not driving runRelease, since
  // overrides belong on the standing PR itself.
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

  // The gate picks one scope but preview shows all. Names are tracked apart from patterns so the banner shows
  // `scope:docs`, not `packages/docs/**`.
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

  if (!advisoryInStandingPr && matchedScopePatterns.length > 0) {
    result.target = matchedScopePatterns.join(', ');
  } else if (!advisoryInStandingPr && !hasImmediate && !options.target && matchedScopePatterns.length === 0) {
    const willRelease =
      trigger !== 'label' ||
      prLabels.includes(labels.patch) ||
      prLabels.includes(labels.minor) ||
      prLabels.includes(labels.major) ||
      prLabels.includes(labels.graduate);

    if (willRelease) {
      const scopeLabelsConfigured = Object.keys(scopeLabels).length > 0;
      throw new Error(
        scopeLabelsConfigured
          ? 'No scope specified. Use --target flag to specify packages, or include a scope label in a merged PR.'
          : 'No scope specified. Use --target flag to specify which packages to release.',
      );
    }
  }

  // Banner only; analysis still runs commit-driven so the merge table can show this PR's contribution.
  if (advisoryInStandingPr) {
    if (prLabels.includes(labels.major)) {
      labelContext.bumpLabel = 'major';
    } else if (prLabels.includes(labels.minor)) {
      labelContext.bumpLabel = 'minor';
    } else if (prLabels.includes(labels.patch)) {
      labelContext.bumpLabel = 'patch';
    }
    if (prLabels.includes(labels.graduate)) {
      labelContext.stable = true;
    }
    if (prLabels.includes(labels.prerelease)) {
      labelContext.prerelease = true;
    }
    return { options: result, labelContext };
  }

  // A direct release needs no bump label: commits drive the bump, as merging the standing PR would. Explicit bump and
  // channel labels still override.
  if (hasImmediate) {
    const conflict = detectLabelConflicts(prLabels, labels);
    if (conflict.bumpConflict) {
      labelContext.bumpConflict = true;
      labelContext.noBumpLabel = true;
      warn(`Conflicting bump labels detected (${conflict.bumpLabelsPresent.join(', ')}) — release blocked`);
    }
    if (conflict.prereleaseConflict) {
      labelContext.prereleaseConflict = true;
      labelContext.noBumpLabel = true;
      warn(`Conflicting labels "${labels.graduate}" and "${labels.prerelease}" detected — release blocked`);
    }
    if (!labelContext.noBumpLabel) {
      // The composed bump (e.g. premajor), so major & prerelease escalates to a fresh line rather than an increment.
      const composedBump = composeBumpFromLabels(prLabels, labels);
      const magnitude = magnitudeFromBump(composedBump);
      if (magnitude) {
        labelContext.bumpLabel = magnitude;
        result.bump = composedBump;
      }
      if (prLabels.includes(labels.graduate)) {
        labelContext.stable = true;
        result.stable = true;
      } else if (prLabels.includes(labels.prerelease)) {
        labelContext.prerelease = true;
        result.prerelease = true;
      }
    }
    return { options: result, labelContext };
  }

  if (trigger === 'label') {
    // The gate's own evaluation, so the preview shows exactly its verdict for this PR.
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
        warn(`Conflicting labels "${labels.graduate}" and "${labels.prerelease}" detected — release blocked`);
      }
    } else {
      const magnitude = magnitudeFromBump(evaluation.bump);
      if (magnitude) {
        info(`PR label "bump:${magnitude}" detected — ${magnitude} release`);
        labelContext.bumpLabel = magnitude;
        result.bump = evaluation.bump;
      }
      if (evaluation.stable) {
        labelContext.stable = true;
        result.stable = true;
      } else if (prLabels.includes(labels.prerelease)) {
        labelContext.prerelease = true;
        result.prerelease = true;
      }
    }

    if (prLabels.includes(labels.skip)) {
      warn(
        `PR label "${labels.skip}" has no effect in label trigger mode — skipping is controlled by not adding bump labels`,
      );
    }

    return { options: result, labelContext };
  }

  const conflict = detectLabelConflicts(prLabels, labels);

  if (conflict.prereleaseConflict) {
    warn(`Conflicting labels "${labels.graduate}" and "${labels.prerelease}" detected — release blocked`);
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

  if (!options.stable && options.prerelease === undefined) {
    if (!(conflict.hasGraduate && conflict.hasPrerelease)) {
      if (conflict.hasGraduate) {
        info(`PR label "${labels.graduate}" detected — using stable release preview`);
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

function magnitudeFromBump(bump: string | undefined): string | undefined {
  if (!bump) {
    return undefined;
  }
  if (bump === 'major' || bump === 'minor' || bump === 'patch') {
    return bump;
  }
  if (bump === 'premajor') {
    return 'major';
  }
  if (bump === 'preminor') {
    return 'minor';
  }
  if (bump === 'prepatch') {
    return 'patch';
  }
  return undefined;
}
