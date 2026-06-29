import * as fs from 'node:fs';
import { type CIConfig, loadConfig as loadReleaseKitConfig } from '@releasekit/config';
import type { VersionOutput, VersionPackageUpdate } from '@releasekit/core';
import { deriveReleaseChannel, error, info, markerData, success, warn } from '@releasekit/core';
import { type Forge, forgeErrorStatus, type PullRequestDetails } from '@releasekit/forge';
import { createGitCli } from '@releasekit/git';
import { PipelineError } from '@releasekit/publish';
import { ATTRIBUTION_FOOTER } from '../attribution.js';
import { formatDuration, parseDuration } from '../duration.js';
import { renderSupersedeWarning } from '../failure-report/failure-report.js';
import { detectUnresolvedFailure, postFailureReport, resolveFailureReportIfPresent } from '../failure-report/post.js';
import { getGitHubContext, getHeadCommitMessage, matchesSkipPattern } from '../git.js';
import { forgeFor } from '../github.js';
import { deriveLabelDefinitions, syncLabels } from '../label-definitions.js';
import { DEFAULT_LABELS, graduatedPackageFromLabel, isGraduatePackageLabel } from '../label-utils.js';
import { refreshFeederPreviews } from '../preview/refresh.js';
import { runNotesStep, runPublishStep, runVersionStep } from '../steps.js';
import type { ReleaseOptions, ReleaseOutput } from '../types.js';
import { publishableUpdates, syncVersionDisplay } from '../version-display.js';
import { type EventActor, getEventActor, isAuthorizedActor, type StandingPrAuthorization } from './authorization.js';
import { makeRowChangelogRenderer, renderCombinedFooter } from './changelog-region.js';
import { extractNotesRegions, mergeNotesRegions, renderNotesRegion } from './notes-region.js';
import {
  cascadeDeselection,
  computeHierarchy,
  extractSelection,
  type PrimaryConfig,
  renderSelectionRegion,
  selectionWarnings,
  validatePrimaryPackages,
} from './selection-region.js';
import { postStandingPRStatusSafe } from './status.js';

export const MANIFEST_MARKER = '<!-- releasekit-manifest -->';
const MANIFEST_SCHEMA_VERSION = 2;
/** Marker for the idempotent "your selection change was ignored" notice posted to an unauthorized editor (#401). */
const SELECTION_DENIED_MARKER = '<!-- releasekit-selection-denied -->';
/** Marker for the idempotent "your release-label change was ignored" notice (#402). */
const LABEL_DENIED_MARKER = '<!-- releasekit-label-denied -->';
const MANIFEST_SCHEMA_MIN_VERSION = 1;

// The manifest payload rides as a base64 blob in its own marker; base64/JSON/schema decoding (with
// its specific error messages) stays in parseManifest below.
const MANIFEST_BASE64 = markerData<string>({
  open: '<!-- base64',
  serialize: (encoded) => encoded,
  deserialize: (payload) => payload || null,
});

export interface StandingPROptions {
  config?: string;
  projectDir: string;
  verbose: boolean;
  quiet: boolean;
  json: boolean;
  npmAuth?: string;
  /**
   * Bypass ONLY the skip-pattern guard at the top of `runStandingPRUpdate`. The guard exists to
   * stop push-triggered runs reacting to a release's own commits, but the post-release reconcile
   * flow deliberately runs `standing-pr update` right after a release — when HEAD is, by
   * definition, a release commit that matches the skip pattern. Reconcile callers explicitly
   * intend an update, so they opt out via this flag. All other guards/behaviour are unchanged.
   */
  reconcile?: boolean;
  /** Ad-hoc CLI override: release only these comma-split package patterns (supplements label overrides). */
  target?: string;
  /** Ad-hoc CLI override: also release the changed prerequisites (and group members) of the targets. */
  includePrerequisites?: boolean;
}

export interface StandingPRResult {
  action: 'created' | 'updated' | 'closed' | 'noop';
  prNumber?: number;
  prUrl?: string;
  versionOutput?: VersionOutput;
}

export interface StandingPRManifest {
  schemaVersion: 1 | 2;
  versionOutput: VersionOutput;
  releaseNotes: Record<string, string>;
  notesFiles: string[];
  createdAt: string;
  baseSha: string;
  /** ISO timestamp of when this standing PR was first created. Preserved across updates. Added in schema v2. */
  firstUpdatedAt?: string;
  /**
   * Override-relevant labels (bump/channel/scope) present on the standing PR when this manifest was
   * computed, sorted. Lets publish refuse a manifest whose labels diverged from the merged PR (#337).
   * Optional: absent on manifests written before this field existed — consumers must tolerate that.
   */
  overrideLabels?: string[];
  /**
   * Packages a maintainer unticked in the PR's selection region, so they were held back from this
   * release (excluded from `versionOutput`). Recorded for provenance/auditing; the release set is
   * already narrowed in `versionOutput`. Optional: absent when nothing was deselected, and on
   * manifests written before this field existed.
   */
  deselected?: string[];
  /**
   * Packages graduated from prerelease to stable on this update (#486), driven by `graduate:<package>`
   * labels (or the whole-batch `release:graduate`). Group-atomic — a graduated fixed/linked group lists
   * every releasing member. Recorded for provenance and so consumers (#487's channel-grouped render)
   * can flag a row as graduated; the resolved stable versions already live in `versionOutput`. Optional:
   * absent when nothing graduated, and on manifests written before this field existed (consumers
   * re-derive from each update's `channel` / `action`).
   */
  graduated?: string[];
}

async function getHeadSha(cwd: string): Promise<string> {
  try {
    return await createGitCli().headSha(cwd);
  } catch (err) {
    throw new Error(`Failed to get HEAD SHA: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * True when this run was triggered by a maintainer acting on the standing PR itself (#336/#367),
 * not by a commit landing: a label added/removed (`labeled`/`unlabeled`) adjusting override labels,
 * or the body `edited` to tick/untick the ad-hoc selection region. The CLI reads the event itself
 * (rather than taking a flag) so it works whether the workflow invokes the action, the reusable
 * workflow, or the CLI directly. Such runs must bypass the initial skip-pattern guard: a
 * pull_request event checks out the standing PR's `chore: release preparation` commit, which matches
 * the skip pattern, so the guard would otherwise no-op every PR-driven update. The body re-render is
 * idempotent and the workflow guards out the bot's own edits, so an `edited` re-trigger is safe.
 */
function isStandingPrEventRun(): boolean {
  if (process.env.GITHUB_EVENT_NAME !== 'pull_request') return false;
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath) return false;
  try {
    const event = JSON.parse(fs.readFileSync(eventPath, 'utf-8')) as { action?: string };
    return event.action === 'labeled' || event.action === 'unlabeled' || event.action === 'edited';
  } catch {
    return false;
  }
}

async function resetReleaseBranch(branch: string, base: string, cwd: string): Promise<void> {
  const git = createGitCli();
  await git.fetch('origin', { cwd });

  // `checkout -B` creates-or-resets the local branch and switches to it — covering both "the branch
  // already exists" and "it doesn't" — and the hard-reset then points it at the base. This replaces
  // the old ls-remote probe + branched logic (`checkout`/`checkout -b`/`reset`), whose remote-exists
  // and remote-absent paths both reduced to exactly these two operations, so the probe was wasted I/O.
  await git.checkout(branch, { create: true, cwd });
  await git.resetHard(`origin/${base}`, cwd);
}

async function commitAndForcePush(branch: string, cwd: string): Promise<void> {
  const git = createGitCli();
  await git.addAll(cwd);

  // Check if there's anything to commit
  const status = (await git.status({ porcelain: true, cwd })).trim();
  if (status) {
    // Subject must match `release.ci.skipPatterns` (default 'chore: release ') so a future
    // standing-pr update on this branch noops correctly. Do NOT add `[skip ci]` — when the PR
    // is squash-merged with this single-commit history, the squash inherits this message and
    // suppresses ALL workflow runs on main, including the publish job.
    await git.commit('chore: release preparation', { cwd });
  }

  await git.push({ remote: 'origin', ref: branch, forceWithLease: true, cwd });
}

/**
 * Stage and commit the LLM-enhanced release notes files generated at publish time. Tags created
 * by the subsequent publish stage land on this commit (which captures the full release state
 * including the polished notes).
 *
 * Scopes both the status probe and the commit to the specific file paths so unrelated dirty index
 * state can't pollute the notes commit.
 */
async function commitNotesFiles(files: string[], versionOutput: VersionOutput, cwd: string): Promise<void> {
  if (files.length === 0) return;

  const git = createGitCli();

  // Probe whether ANY of the target paths has tracked changes OR is untracked. `git status
  // --porcelain -- <paths>` is scoped to the listed paths (so unrelated repo-wide dirty state
  // is ignored) AND reports untracked files (`??` prefix) — which `git diff HEAD` misses.
  // Without the untracked check, a brand-new RELEASE_NOTES.md (first release in a repo) would
  // be silently skipped and never make it into the publish commit.
  // The probe is wrapped so the function never propagates — the caller's outer try/catch is
  // scoped to LLM failures, and a bubbled git error there would emit a misleading "release
  // notes generation failed" warning even though notes were generated successfully.
  let statusOut: string;
  try {
    statusOut = (await git.status({ porcelain: true, paths: files, cwd })).trim();
  } catch (err) {
    warn(`Failed to probe release notes status: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }

  if (!statusOut) {
    info('Release notes already match the on-disk content, skipping commit');
    return;
  }

  // Single atomic git add — either every file is staged or none are, no partial-staging
  // dirty-index window before the subsequent publish step runs.
  try {
    await git.add(files, cwd);
  } catch (err) {
    warn(`Failed to stage release notes files: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }

  // Commit ONLY the listed paths via `git commit -- <paths>`. This is belt-and-braces against
  // any unrelated content that may already be staged in the index — git will only write the
  // explicit paths into the commit even if other paths are staged.
  // Use the first update's version for the commit subject (sync mode shares a single version;
  // async picks a representative — fine for an audit-only commit).
  const version = versionOutput.updates[0]?.newVersion ?? '';
  const message = version ? `chore: release notes for v${version}` : 'chore: release notes';
  try {
    await git.commit(message, { paths: files, cwd });
    success(`Committed release notes (${files.length} file(s))`);
  } catch (err) {
    warn(`Failed to commit release notes: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Create the release tags locally at HEAD.
 *
 * The publish pipeline's `runGitCommitStage` is what normally creates tags, but the standing-PR
 * publish flow sets `skipGitCommit: true` to avoid duplicating the squash-merge commit, which
 * also skips tag creation. The pipeline's `git push --tags` then has nothing to push.
 *
 * Mirrors the idempotency check in `runGitCommitStage` (packages/publish/src/stages/git-commit.ts):
 * if the tag already points at HEAD it's a no-op (re-runs are safe); if it points at a different
 * commit we warn and skip rather than rewriting history. Errors here don't propagate — the
 * publish pipeline's `--tags` push will publish whatever tags we managed to create.
 */
export async function createReleaseTags(tags: string[], cwd: string): Promise<void> {
  if (tags.length === 0) return;

  const git = createGitCli();

  // Wrapped per the function contract — errors here must not propagate. A corrupt repo state or
  // permission error reading HEAD shouldn't abort the publish pipeline before tag creation runs.
  let headSha: string;
  try {
    headSha = await git.headSha(cwd);
  } catch (err) {
    warn(`Failed to resolve HEAD for tag creation: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }

  for (const tag of tags) {
    // `refExists` peels the ref with `^{commit}` (like the old `refs/tags/<tag>^{}` rev-parse), so a
    // present tag resolves to its commit. When present, resolve that commit SHA to keep the
    // idempotency distinction: at HEAD → skip; at a different commit → warn (don't rewrite history).
    if (await git.refExists(`refs/tags/${tag}`, cwd)) {
      let existing = '';
      try {
        existing = (await git.log({ range: tag, format: '%H', extraArgs: ['-1'], cwd })).trim();
      } catch {
        // Couldn't resolve the existing tag's commit — fall through to the (non-HEAD) warn branch.
      }
      if (existing === headSha) {
        info(`Tag ${tag} already exists at HEAD, skipping`);
        continue;
      }
      warn(`Tag ${tag} exists at ${existing} but HEAD is ${headSha} — skipping (re-tag manually if intended)`);
      continue;
    }

    try {
      await git.tag(tag, { message: `Release ${tag}`, cwd });
      success(`Created tag: ${tag}`);
    } catch (err) {
      warn(`Failed to create tag ${tag}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

async function deleteReleaseBranch(releaseBranch: string, cwd: string): Promise<void> {
  try {
    // `git push origin :<branch>` deletes the remote branch (the delete refspec). The leading `:`
    // is why this passes the seam's leading-`-` option guard, where `--delete` could not.
    await createGitCli().push({ remote: 'origin', ref: `:${releaseBranch}`, cwd });
    info(`Deleted release branch '${releaseBranch}'`);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    if (errorMsg.includes('not found') || errorMsg.includes('does not exist')) {
      info(`Release branch '${releaseBranch}' already deleted`);
    } else {
      warn(`Failed to delete release branch '${releaseBranch}': ${errorMsg}`);
    }
  }
}

// GitHub rejects a PR body over 65,536 chars with a 422. Cap below that (with margin) so an
// oversized changelog — almost always a package with no baseline tag whose changelog spans the
// entire git history (#333) — truncates gracefully instead of failing PR creation outright.
export const STANDING_PR_BODY_CAP = 64000;

function truncateAtLineBoundary(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const slice = text.slice(0, maxChars);
  const lastNewline = slice.lastIndexOf('\n');
  return lastNewline > 0 ? slice.slice(0, lastNewline) : slice;
}

const TRUNCATION_NOTICE =
  "> **Changelog truncated** — the full changelog exceeded GitHub's PR-body limit and was shortened here. " +
  "Each package's complete changelog is in its `CHANGELOG.md`. This usually means a package has no prior " +
  'release tag, so its changelog spans the entire git history — create baseline tags to scope it.';

interface RenderPrBodyOptions {
  supersedeWarning?: string[];
  notesRegion?: string;
  /**
   * Renders the selection block; `withChangelogs` toggles the per-row changelogs co-located with each
   * row. Undefined for sync releases, which carry no selection region (they publish atomically).
   */
  renderSelectionBlock?: (withChangelogs: boolean) => string;
  /** The flat, de-duplicated combined footer, already rendered; `''` when disabled or empty. */
  footer: string;
}

function renderPrBody(versionOutput: VersionOutput, options: RenderPrBodyOptions): string {
  const { supersedeWarning, notesRegion, renderSelectionBlock, footer } = options;

  // Build the body around a given selection block + footer so we can re-render with progressively
  // trimmed changelogs if the full one would exceed GitHub's limit, without disturbing the notes region.
  const build = (selectionBlock: string | undefined, footerSection: string, extraNotice?: string): string => {
    const lines: string[] = ['## Release', ''];

    // While a prior release remains partially published, lead with the supersede warning so the
    // maintainer sees the retry-vs-supersede choice before the package list.
    if (supersedeWarning && supersedeWarning.length > 0) {
      lines.push(...supersedeWarning);
    }

    // The root lockstep bump (sync mode) is never published — keep it out of the package list.
    const updates = publishableUpdates(versionOutput);

    if (selectionBlock) {
      // Non-sync releases render the interactive selection region in place of a static list — it is
      // the package list (ticked rows = will release), built from the full changed set upstream so a
      // held-back package still shows as an unticked row. Each row carries its own changelog inline.
      lines.push(selectionBlock);
    } else if (versionOutput.strategy === 'sync') {
      // Sync releases move as one unit — lead with the version; a per-row version column
      // would repeat the same value for every package. Selection does not apply (atomic).
      lines.push(`Merging this PR will publish **${syncVersionDisplay(versionOutput)}**:`, '');
      for (const update of updates) {
        lines.push(`- \`${update.packageName}\``);
      }
    } else {
      lines.push(
        'Merging this PR will publish the following packages:',
        '',
        '| Package | Version |',
        '|---------|---------|',
      );
      for (const update of updates) {
        lines.push(`| \`${update.packageName}\` | ${update.newVersion} |`);
      }
    }

    if (footerSection) lines.push('', footerSection, '');
    if (extraNotice) lines.push('', extraNotice, '');
    // The editable release-notes region (opt-in via the preview-notes label) sits below the changelog
    // and above the merge instructions, so a reviewer reads/edits it in the natural place.
    if (notesRegion) lines.push('', notesRegion, '');
    lines.push('---', '> Merge this PR to publish. The release will be triggered automatically.');
    lines.push('', ATTRIBUTION_FOOTER);
    return lines.join('\n');
  };

  // Level 0 — the full body: per-row changelogs (non-sync) plus the combined deduped footer.
  const fullSelection = renderSelectionBlock?.(true);
  const full = build(fullSelection, footer);
  if (full.length <= STANDING_PR_BODY_CAP) return full;

  if (renderSelectionBlock) {
    // Non-sync: always keep the rows (the PR must stay usable); shed changelog volume in stages.
    // Level 1 — keep the per-row changelogs, drop the redundant deduped footer.
    if (footer) {
      const body = build(fullSelection, '');
      if (body.length <= STANDING_PR_BODY_CAP) return body;
    }
    // Level 2 — drop the per-row changelogs too (bare rows) and point reviewers at CHANGELOG.md.
    const bareSelection = renderSelectionBlock(false);
    const body = build(bareSelection, '', TRUNCATION_NOTICE);
    if (body.length <= STANDING_PR_BODY_CAP) return body;
    // Level 3 — even the notice overflows (thousands of rows): bare rows only.
    return build(bareSelection, '');
  }

  // Sync: the footer is the only changelog — truncate it at a line boundary and append the notice.
  if (footer) {
    // 8 = 4 (\n\n around the footer) + 2 (\n\n before the notice) + 2 safety margin.
    const room = STANDING_PR_BODY_CAP - build(undefined, '').length - TRUNCATION_NOTICE.length - 8;
    if (room <= 0) return build(undefined, '');
    return build(undefined, `${truncateAtLineBoundary(footer, room)}\n\n${TRUNCATION_NOTICE}`);
  }
  return build(undefined, '');
}

export function serializeManifest(m: StandingPRManifest): string {
  const encoded = Buffer.from(JSON.stringify(m)).toString('base64');
  return [
    MANIFEST_MARKER,
    '<details><summary>Release manifest (do not edit)</summary>',
    '',
    MANIFEST_BASE64.encode(encoded),
    '',
    '</details>',
  ].join('\n');
}

export function parseManifest(commentBody: string): StandingPRManifest {
  const encoded = MANIFEST_BASE64.decode(commentBody);
  if (!encoded) {
    throw new Error('Release manifest not found or malformed in PR comment');
  }

  let json: string;
  try {
    json = Buffer.from(encoded, 'base64').toString('utf-8');
  } catch {
    throw new Error('Release manifest encoding is invalid');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('Release manifest JSON is malformed');
  }

  const m = parsed as StandingPRManifest;
  if (m.schemaVersion < MANIFEST_SCHEMA_MIN_VERSION || m.schemaVersion > MANIFEST_SCHEMA_VERSION) {
    throw new Error(
      `Release manifest schema version ${m.schemaVersion} is incompatible (expected ${MANIFEST_SCHEMA_MIN_VERSION}–${MANIFEST_SCHEMA_VERSION}). Re-run 'standing-pr update' to regenerate.`,
    );
  }

  return m;
}

export async function findManifestComment(
  forge: Forge,
  prNumber: number,
): Promise<{ id: number; body: string } | null> {
  return forge.findComment(prNumber, MANIFEST_MARKER);
}

/**
 * Read-only snapshot of the current standing PR, used by the preview command to render
 * a "true release preview" comment (queued packages + minAge gate state).
 *
 * Returns null when no standing PR exists or its manifest comment is missing/malformed.
 */
export interface StandingPRSnapshot {
  number: number;
  url: string;
  manifest: StandingPRManifest;
  /** ISO timestamp of when the standing PR was first opened. */
  openedAt: string;
  /** 'success' = ready to merge; 'pending' = label conflict or minAge not yet elapsed. */
  gateState: 'success' | 'pending';
  /** Human-readable reason when gateState === 'pending' (conflict description or minAge wait). */
  gateReason?: string;
}

export async function fetchStandingPRSnapshot(
  forge: Forge,
  ciConfig: CIConfig | undefined,
): Promise<StandingPRSnapshot | null> {
  const branch = ciConfig?.standingPr?.branch ?? 'release/next';
  const pr = await forge.findStandingPR(branch);
  if (!pr) return null;

  const comment = await findManifestComment(forge, pr.number);
  if (!comment) return null;

  let manifest: StandingPRManifest;
  try {
    manifest = parseManifest(comment.body);
  } catch {
    return null;
  }

  // firstUpdatedAt is only present on schema-v2 manifests. For schema-v1, createdAt is the
  // latest-update timestamp (not the PR-open timestamp), so the displayed age will be ~0 until
  // the next standing-pr update rewrites the manifest to schema v2.
  const openedAt = manifest.firstUpdatedAt ?? manifest.createdAt;
  const minAge = ciConfig?.standingPr?.minAge;
  let gateState: 'success' | 'pending' = 'success';
  let gateReason: string | undefined;

  // Label conflicts take priority over minAge — they must be resolved before merging.
  const overrides = resolveStandingPrLabelOverrides(pr.labels, ciConfig);
  if (overrides.conflicts.length > 0) {
    gateState = 'pending';
    gateReason = overrides.conflicts.join('; ');
  } else if (minAge !== undefined && manifest.firstUpdatedAt) {
    const minAgeMs = parseDuration(minAge);
    if (minAgeMs !== null) {
      const ageMs = Date.now() - new Date(manifest.firstUpdatedAt).getTime();
      if (ageMs < minAgeMs) {
        gateState = 'pending';
        gateReason = `Waiting ${formatDuration(minAgeMs - ageMs)} for minAge`;
      }
    }
  }

  return { number: pr.number, url: pr.url, manifest, openedAt, gateState, gateReason };
}

/**
 * Overrides resolved from labels on the standing PR itself. The standing PR is the canonical
 * surface for adjusting bump magnitude, scope, and channel — feeder PR labels are advisory.
 */
interface StandingPrOverrides {
  /** Composed bump: a magnitude (major/minor/patch) or a `pre*` form when prerelease is also requested. */
  bump?: 'major' | 'minor' | 'patch' | 'premajor' | 'preminor' | 'prepatch';
  target?: string;
  stable?: boolean;
  prerelease?: boolean;
  /** Also release the targeted packages' changed prerequisites (the `release:with-prerequisites` label). */
  withPrerequisites?: boolean;
  /**
   * Per-package graduation (#486): package names parsed from `graduate:<package>` labels — graduate
   * just these prereleases to stable, leaving others on their line. Empty when none. Ignored when
   * `stable` (the whole-batch `release:graduate`) is set, which graduates everything.
   */
  graduate?: string[];
  /** Human-readable conflict descriptions (used for the pending status check). Empty when no conflict. */
  conflicts: string[];
}

/** The fixed release-control label names (bump/channel/scope/with-prerequisites) — those that drive output. */
function relevantOverrideLabelNames(ciConfig: CIConfig | undefined): Set<string> {
  const labels = ciConfig?.labels ?? DEFAULT_LABELS;
  const scopeLabels = ciConfig?.scopeLabels ?? {};
  return new Set<string>([
    labels.major,
    labels.minor,
    labels.patch,
    labels.graduate,
    labels.prerelease,
    labels.withPrerequisites,
    ...Object.keys(scopeLabels),
  ]);
}

/**
 * Whether a label steers the next release, so it must be tracked by the manifest's `overrideLabels`
 * (staleness guard, #337) and the label-authorization reconcile (#402). Covers the fixed control
 * labels plus the dynamic per-package `graduate:<package>` labels (#486), whose names aren't known up
 * front but still drive output and so can't be left for an unauthorized actor to add unchecked.
 */
function isRelevantOverrideLabel(label: string, ciConfig: CIConfig | undefined): boolean {
  return relevantOverrideLabelNames(ciConfig).has(label) || isGraduatePackageLabel(label, ciConfig?.labels);
}

/**
 * The override-relevant labels (bump/channel/scope/graduate) present on a PR, sorted and de-duplicated.
 * This is the set that actually drives the next release, so it's what the manifest records and what
 * publish compares against the merged PR to detect a stale manifest (#337). The standing-PR marker
 * label and any unrelated labels (area:*, etc.) are deliberately excluded — they don't affect output.
 */
function extractOverrideLabels(prLabels: string[], ciConfig: CIConfig | undefined): string[] {
  return [...new Set(prLabels.filter((l) => isRelevantOverrideLabel(l, ciConfig)))].sort();
}

/** A package update's channel — the persisted `channel` (#485), else re-derived from its version. */
function updateChannel(update: VersionPackageUpdate): ReturnType<typeof deriveReleaseChannel> {
  return update.channel ?? deriveReleaseChannel(update.newVersion);
}

/**
 * Publishable packages currently on a prerelease line (#486) — the candidates a maintainer can
 * graduate. Used to seed the per-package `graduate:<package>` labels so they exist in the picker.
 */
function prereleasePackageNames(versionOutput: VersionOutput): string[] {
  return publishableUpdates(versionOutput)
    .filter((u) => updateChannel(u) === 'prerelease')
    .map((u) => u.packageName);
}

/**
 * Packages graduated from prerelease to stable on this run (#486), for the manifest's `graduated`
 * provenance field. Sourced from each update's resolved `action` (`'graduated'`), then widened for
 * group atomicity: a fixed/linked group where any member graduated lists every releasing member, even
 * one whose own action read `'bumped'` because it adopted the group version from a different baseline.
 */
function graduatedPackageNames(versionOutput: VersionOutput): string[] {
  const updates = publishableUpdates(versionOutput);
  const graduatedGroups = new Set(
    updates.filter((u) => u.action === 'graduated' && u.group).map((u) => u.group as string),
  );
  const names = new Set<string>();
  for (const u of updates) {
    if (u.action === 'graduated' || (u.group && graduatedGroups.has(u.group))) names.add(u.packageName);
  }
  return [...names].sort();
}

function resolveStandingPrLabelOverrides(prLabels: string[], ciConfig: CIConfig | undefined): StandingPrOverrides {
  // Return a fresh object rather than a shared constant — callers may mutate `conflicts`.
  if (!prLabels || prLabels.length === 0) return { conflicts: [] };
  const labels = ciConfig?.labels ?? DEFAULT_LABELS;
  const scopeLabels = ciConfig?.scopeLabels ?? {};
  const conflicts: string[] = [];

  // Bump
  let bump: 'major' | 'minor' | 'patch' | undefined;
  const bumpsPresent = [
    prLabels.includes(labels.major) ? labels.major : undefined,
    prLabels.includes(labels.minor) ? labels.minor : undefined,
    prLabels.includes(labels.patch) ? labels.patch : undefined,
  ].filter(Boolean) as string[];
  if (bumpsPresent.length > 1) {
    conflicts.push(`Conflicting bump labels on standing PR (${bumpsPresent.join(', ')}) — remove all but one`);
  } else if (prLabels.includes(labels.major)) bump = 'major';
  else if (prLabels.includes(labels.minor)) bump = 'minor';
  else if (prLabels.includes(labels.patch)) bump = 'patch';

  // Graduate / prerelease release-type
  const hasGraduate = prLabels.includes(labels.graduate);
  const hasPrerelease = prLabels.includes(labels.prerelease);
  let stable: boolean | undefined;
  let prerelease: boolean | undefined;
  if (hasGraduate && hasPrerelease) {
    conflicts.push(`Conflicting release-type labels on standing PR (${labels.graduate} and ${labels.prerelease})`);
  } else {
    if (hasGraduate) stable = true;
    if (hasPrerelease) prerelease = true;
  }

  // Per-package graduation (#486): each `graduate:<package>` label graduates that one prerelease to
  // stable. The whole-batch `release:graduate` (stable) supersedes them — it graduates everything, so
  // a per-package subset would only narrow it; drop the per-package set then. `channel:prerelease`
  // forces a prerelease line, which directly contradicts graduating, so flag it as a conflict.
  const graduateLabels = stable ? [] : prLabels.filter((l) => isGraduatePackageLabel(l, labels));
  const graduate = stable
    ? []
    : graduateLabels.map((l) => graduatedPackageFromLabel(l, labels)).filter((p): p is string => p !== undefined);
  if (graduate.length > 0 && hasPrerelease) {
    // Name the offending graduate label(s) up front so the (140-char-truncated) status check tells the
    // maintainer exactly what to remove — the alternative is an opaque "release-type labels conflict".
    // Calling out that a graduate label lingers after its package graduated also points at the likely
    // cause: a leftover `graduate:<package>` colliding with a newly-added prerelease channel.
    conflicts.push(
      `Conflicting release-type labels: ${graduateLabels.map((l) => `\`${l}\``).join(', ')} graduate to stable while ` +
        `\`${labels.prerelease}\` forces a prerelease — remove one. (A graduate label lingers after its package graduates, so it may be a stale leftover.)`,
    );
  }

  // Scope: first matching configured scope label wins
  let target: string | undefined;
  for (const [labelName, pattern] of Object.entries(scopeLabels)) {
    if (prLabels.includes(labelName)) {
      target = pattern;
      break;
    }
  }

  // Compose the bump to match composeBumpFromLabels (the label→bump SSOT), kept inline here
  // because this path layers its own conflict detection on top:
  //   - release:graduate wins and drops the bump — graduation is bump-less, so don't leak a stale
  //     magnitude into { bump, stable } (engine ignores it today, but the contract must hold).
  //   - prerelease + magnitude escalates to a fresh line (premajor → 2.0.0-next.0) rather than
  //     incrementing an existing prerelease (#335).
  // (The one deliberate divergence from the SSOT: prerelease *alone* stays commit-driven here —
  // bump undefined + prerelease flag — rather than forcing a 'prerelease' bump, so a standing PR's
  // channel:prerelease label still lets commits pick the magnitude.)
  const composedBump = stable ? undefined : bump && prerelease ? (`pre${bump}` as const) : bump;

  // Orthogonal to bump/channel/scope: pull in the targets' changed prerequisites. Only takes effect
  // when there is a target (the engine derives prerequisites from the targeted set).
  const withPrerequisites = prLabels.includes(labels.withPrerequisites) || undefined;

  return {
    bump: composedBump,
    target,
    stable,
    prerelease,
    withPrerequisites,
    graduate: graduate.length > 0 ? graduate : undefined,
    conflicts,
  };
}

interface BuildOptionsExtras {
  /** Per-package vs synced versioning. Inherited from version.sync config (default true). */
  sync?: boolean;
  bump?: 'major' | 'minor' | 'patch' | 'premajor' | 'preminor' | 'prepatch';
  target?: string;
  stable?: boolean;
  prerelease?: boolean;
  includePrerequisites?: boolean;
  /** Per-package graduation (#486): package patterns to graduate to stable; others stay on their line. */
  graduate?: string[];
  /** Packages to hold back from the release (standing-PR ad-hoc deselection). Exact name match. */
  exclude?: string[];
}

function buildBaseReleaseOptions(
  options: StandingPROptions,
  dryRun: boolean,
  extras?: BuildOptionsExtras,
): ReleaseOptions {
  return {
    config: options.config,
    dryRun,
    sync: extras?.sync ?? false,
    bump: extras?.bump,
    target: extras?.target,
    includePrerequisites: extras?.includePrerequisites,
    exclude: extras?.exclude,
    stable: extras?.stable,
    graduate: extras?.graduate,
    prerelease: extras?.prerelease ? true : undefined,
    skipNotes: true,
    skipPublish: true,
    skipGit: true,
    skipGithubRelease: true,
    skipVerification: true,
    json: options.json,
    verbose: options.verbose,
    quiet: options.quiet,
    projectDir: options.projectDir,
    npmAuth: (options.npmAuth as ReleaseOptions['npmAuth']) ?? 'auto',
  };
}

/**
 * Close the standing PR (when one exists and we have a token) or noop — the empty-queue outcome.
 * Shared by the dry-run empty-queue guard and the write-step empty guard (#396), so a queue that
 * empties out is handled identically whichever step observes it.
 */
async function closeEmptyQueue(
  existingStandingPr: { number: number; url: string } | null,
  githubContext: ReturnType<typeof getGitHubContext>,
): Promise<StandingPRResult> {
  info('No releasable changes found');
  if (githubContext?.token && existingStandingPr) {
    const forge = forgeFor(githubContext);
    await forge.createComment(
      existingStandingPr.number,
      'No releasable changes found. Closing this PR as the release queue is empty.',
    );
    await forge.updatePullRequest(existingStandingPr.number, { state: 'closed' });
    info(`Closed standing PR #${existingStandingPr.number}`);
    return { action: 'closed', prNumber: existingStandingPr.number, prUrl: existingStandingPr.url };
  }
  return { action: 'noop' };
}

/** Whether two string sets hold the same members. */
function setsEqual(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  return a.size === b.size && [...a].every((x) => b.has(x));
}

/**
 * {@link isAuthorizedActor}, but it never throws. The permission check is a forge API call that can
 * fail (rate-limit, network, a mis-scoped token — `getActorPermission` rethrows non-404s); on failure
 * we warn and fail **closed** (treat the actor as unauthorized), so a transient hiccup reverts the
 * standing PR to its authoritative manifest state rather than crashing the whole update (#401).
 */
async function authorizedOrWarn(forge: Forge, actor: EventActor, authz: StandingPrAuthorization): Promise<boolean> {
  try {
    return await isAuthorizedActor(forge, actor.login, actor.type, authz);
  } catch (err) {
    warn(
      `Could not verify permission for '${actor.login ?? 'unknown'}' — treating as unauthorized: ${err instanceof Error ? err.message : String(err)}`,
    );
    return false;
  }
}

export async function runStandingPRUpdate(options: StandingPROptions): Promise<StandingPRResult> {
  const cwd = options.projectDir;

  const releaseKitConfig = loadReleaseKitConfig({ cwd, configPath: options.config });
  const ciConfig = releaseKitConfig.ci;
  const standingPrConfig = ciConfig?.standingPr;

  const branch = standingPrConfig?.branch ?? 'release/next';
  const base = releaseKitConfig.git?.branch ?? 'main';
  const skipPatterns = releaseKitConfig.release?.ci?.skipPatterns ?? ['chore: release '];

  // Label-triggered runs (a maintainer added/removed an override label on the standing PR, #336)
  // must bypass the skip-pattern guards just like reconcile: the guards reject runs reacting to a
  // release commit on HEAD, but a label event isn't reacting to HEAD at all — skipping would leave
  // the new override unapplied until the next push or the hourly cron.
  const bypassSkipGuard = options.reconcile || isStandingPrEventRun();

  // Skip-pattern guard. Bypassed by reconcile (HEAD is a release commit by design then) and by
  // label-triggered runs (the trigger is a label, not the commit on HEAD).
  if (bypassSkipGuard) {
    info(
      options.reconcile
        ? 'Reconcile mode: bypassing skip-pattern guard'
        : 'Label-triggered run: bypassing skip-pattern guard',
    );
  } else {
    const headSubject = await getHeadCommitMessage(cwd);
    if (headSubject && matchesSkipPattern(headSubject, skipPatterns)) {
      info(`Skipping standing PR update: commit matches skip pattern`);
      return { action: 'noop' };
    }
  }

  const githubContext = getGitHubContext();

  // Look up the existing standing PR up front (one API call, reused throughout). Its labels
  // are the canonical override surface — `bump:*` / `scope:*` / channel labels applied to
  // the standing PR drive the next update.
  let existingStandingPr: { number: number; url: string; labels: string[] } | null = null;
  if (githubContext?.token) {
    try {
      existingStandingPr = await forgeFor(githubContext).findStandingPR(branch);
    } catch (err) {
      warn(`Could not look up standing PR for label overrides: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Read the standing PR's manifest once up front. Its recorded `deselected` is the AUTHORITATIVE
  // selection used by the gate below (publish reads the manifest, not the body), and its
  // `firstUpdatedAt` is preserved when the manifest is rewritten at the end of the run.
  let existingManifestComment: Awaited<ReturnType<typeof findManifestComment>> = null;
  let existingManifest: StandingPRManifest | undefined;
  if (existingStandingPr && githubContext?.token) {
    try {
      existingManifestComment = await findManifestComment(forgeFor(githubContext), existingStandingPr.number);
      if (existingManifestComment) existingManifest = parseManifest(existingManifestComment.body);
    } catch {
      // An unreadable/malformed manifest is treated as absent — the gate falls back to an empty
      // authoritative selection and firstUpdatedAt defaults to the current time below.
    }
  }

  // Read the standing PR's live body once (reused for the ad-hoc selection region and edited notes).
  // A maintainer ticks/unticks packages and edits notes in place; both are read back by marker
  // slicing so their choices survive this run's regenerate + force-push.
  let liveBody: string | undefined;
  if (existingStandingPr && githubContext?.token) {
    try {
      liveBody = (await forgeFor(githubContext).getPullRequest(existingStandingPr.number)).body;
    } catch (err) {
      warn(`Could not read current PR body to preserve selection: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  // The maintainer's prior package selection — names whose row was unticked (held back). Reconciled
  // against the actually-changed set after the dry-run below (a name no longer changed is dropped).
  //
  // Authorization (#401): when `ci.standingPr.authorization` is set, the manifest's recorded
  // selection is AUTHORITATIVE; the live body is only trusted when an authorized actor `edited` it.
  // Otherwise (an unauthorized edit, or a push/schedule run) we keep the manifest's selection so the
  // re-render reverts any unauthorized tick/untick. With no policy configured, the body is
  // authoritative (original behavior).
  const bodyDeselected = new Set<string>((liveBody && extractSelection(liveBody)?.deselected) || []);
  const authz = standingPrConfig?.authorization;
  let priorDeselected = bodyDeselected;
  if (authz && existingStandingPr && githubContext?.token) {
    const manifestDeselected = new Set<string>(existingManifest?.deselected ?? []);
    const actor = getEventActor();
    const authorizedEdit = actor.action === 'edited' && (await authorizedOrWarn(forgeFor(githubContext), actor, authz));
    if (!authorizedEdit) {
      priorDeselected = manifestDeselected;
      // An unauthorized actor changed the checklist — tell them it was ignored (idempotent comment).
      if (actor.action === 'edited' && !setsEqual(bodyDeselected, manifestDeselected)) {
        // Only mention the allow-list when one is actually configured.
        const allowClause = authz.allowedActors?.length ? ', or an allow-listed actor' : '';
        await forgeFor(githubContext)
          .upsertMarkerComment(
            existingStandingPr.number,
            SELECTION_DENIED_MARKER,
            `${SELECTION_DENIED_MARKER}\n\n> ⚠️ **Selection change ignored.** Only authorized maintainers (\`${authz.requiredPermission}\`+${allowClause}) can hold packages back from the release. The **Packages to release** checklist has been reset to the approved selection.`,
          )
          .catch((err) =>
            warn(`Could not post selection-denied notice: ${err instanceof Error ? err.message : String(err)}`),
          );
      }
    }
  }

  // Label authorization (#402): release-control labels (bump:/scope:/channel:/with-prerequisites and
  // configured scope:*) on the standing PR drive the next release, but GitHub can't restrict who
  // applies a label. When authorization is set, the manifest's `overrideLabels` are AUTHORITATIVE; an
  // unauthorized `labeled`/`unlabeled` event is ignored and the PR's release-control labels are
  // reconciled back to the authorized set (the rogue label removed; non-release labels like area:*
  // preserved). `effectiveLabels` then drives override resolution, the label re-apply, and the
  // manifest below — so the bot's own re-apply can't re-add the rogue label.
  let effectiveLabels = existingStandingPr?.labels ?? [];
  if (authz && existingStandingPr && githubContext?.token) {
    const actor = getEventActor();
    const isLabelEvent = actor.action === 'labeled' || actor.action === 'unlabeled';
    if (isLabelEvent && !(await authorizedOrWarn(forgeFor(githubContext), actor, authz))) {
      const isRelevant = (l: string) => isRelevantOverrideLabel(l, ciConfig);
      const authorizedOverrides = (existingManifest?.overrideLabels ?? []).filter(isRelevant);
      const reconciled = [...new Set([...effectiveLabels.filter((l) => !isRelevant(l)), ...authorizedOverrides])];
      // Tell the unauthorized labeller their change was ignored — parity with the selection gate
      // (the label removal is also visible in the timeline, but the comment says why). Idempotent.
      if (!setsEqual(new Set(effectiveLabels), new Set(reconciled))) {
        const allowClause = authz.allowedActors?.length ? ', or an allow-listed actor' : '';
        await forgeFor(githubContext)
          .upsertMarkerComment(
            existingStandingPr.number,
            LABEL_DENIED_MARKER,
            `${LABEL_DENIED_MARKER}\n\n> ⚠️ **Release-label change ignored.** Only authorized maintainers (\`${authz.requiredPermission}\`+${allowClause}) can change the standing PR's release labels (\`bump:\`/\`scope:\`/\`channel:\`/…). The labels have been reset to the approved set.`,
          )
          .catch((err) =>
            warn(`Could not post label-denied notice: ${err instanceof Error ? err.message : String(err)}`),
          );
      }
      effectiveLabels = reconciled;
    }
  }

  // Preview-notes opt-in (#200): when the standing PR carries the preview-notes label, generate LLM
  // release notes on demand into an editable region in the PR body. Default path stays LLM-free.
  const previewNotesLabel = (ciConfig?.labels ?? DEFAULT_LABELS).previewNotes;
  const previewNotesEnabled = effectiveLabels.includes(previewNotesLabel);

  const overrides = resolveStandingPrLabelOverrides(effectiveLabels, ciConfig);
  const overrideLabelNames = ciConfig?.labels ?? DEFAULT_LABELS;
  if (overrides.bump) info(`Standing PR label override: bump=${overrides.bump}`);
  if (overrides.target) info(`Standing PR label override: target=${overrides.target}`);
  if (overrides.stable) info(`Standing PR label override: ${overrideLabelNames.graduate}`);
  if (overrides.graduate) info(`Standing PR label override: graduate [${overrides.graduate.join(', ')}]`);
  if (overrides.prerelease) info(`Standing PR label override: ${overrideLabelNames.prerelease}`);
  for (const conflict of overrides.conflicts) warn(conflict);

  // Use the version.sync setting from config; fall back to false (per-package versioning)
  // when not set so existing repos without an explicit value are unaffected.
  const sync = releaseKitConfig.version?.sync ?? false;
  // When labels conflict, drop the override (fall back to commit-driven) but keep the
  // conflict descriptions for the final status check.
  // CLI --target (ad-hoc override) wins over the label-derived target; prerequisites are opted in by
  // the CLI flag OR the `release:with-prerequisites` label, either way.
  const cliTarget = options.target ?? overrides.target;
  const includePrerequisites = options.includePrerequisites || overrides.withPrerequisites;
  // Per-package graduation (#486) is a non-sync concept — a sync release moves as one atomic unit
  // (no selection region, single shared version), so `graduate:<package>` has no meaning there; the
  // whole-batch `release:graduate` still graduates the synced unit. Drop the per-package set for sync.
  const graduate = sync ? undefined : overrides.graduate;
  const buildExtras: BuildOptionsExtras = overrides.conflicts.length
    ? { sync, target: cliTarget, includePrerequisites }
    : {
        sync,
        bump: overrides.bump,
        target: cliTarget,
        stable: overrides.stable,
        prerelease: overrides.prerelease,
        graduate,
        includePrerequisites,
      };

  // Dry-run version analysis to compute bumps without writing
  info('Running version analysis (dry run)...');
  const dryRunOptions = buildBaseReleaseOptions(options, true, buildExtras);
  const versionOutputDry = await runVersionStep(dryRunOptions);

  if (versionOutputDry.updates.length === 0) {
    return closeEmptyQueue(existingStandingPr, githubContext);
  }

  // minPackages gate: close existing PR and noop if package count is below threshold.
  // Counts publishable packages only — the root lockstep bump (sync mode) would otherwise
  // inflate the count by one.
  const minPackages = standingPrConfig?.minPackages;
  const publishableCount = publishableUpdates(versionOutputDry).length;
  if (minPackages !== undefined && publishableCount < minPackages) {
    info(`Package count (${publishableCount}) is below minPackages threshold (${minPackages}), skipping`);
    if (githubContext?.token && existingStandingPr) {
      const forge = forgeFor(githubContext);
      await forge.createComment(
        existingStandingPr.number,
        `Not enough packages with releasable changes (${publishableCount} of ${minPackages} required). Closing until the threshold is reached.`,
      );
      await forge.updatePullRequest(existingStandingPr.number, { state: 'closed' });
      info(`Closed standing PR #${existingStandingPr.number} (minPackages not met)`);
      return { action: 'closed', prNumber: existingStandingPr.number, prUrl: existingStandingPr.url };
    }
    return { action: 'noop' };
  }

  // Capture baseSha before switching branches
  const baseSha = await getHeadSha(cwd);

  // Branch management: reset release branch to base
  info(`Resetting release branch '${branch}' to origin/${base}...`);
  await resetReleaseBranch(branch, base, cwd);

  // A release merge can land on `base` after this run started — e.g. another PR is merged moments
  // before the standing PR. The reset above pulls that commit in, so its version bump is now on HEAD
  // but not yet tagged; recomputing from it would double-bump (package.json ahead of the last tag →
  // bump again under `mismatchStrategy: prefer-package`). Re-check the skip pattern post-reset and
  // bow out — the post-release reconcile (or the next push) rebuilds the standing PR cleanly once the
  // release has tagged. Reconcile runs are exempt: HEAD is a release commit by design there. See #323.
  if (!options.reconcile) {
    const resetHeadSubject = await getHeadCommitMessage(cwd);
    if (resetHeadSubject && matchesSkipPattern(resetHeadSubject, skipPatterns)) {
      info('Skipping standing PR update: a release commit landed on the base branch during this run');
      return { action: 'noop' };
    }
  }

  // Reconcile the maintainer's prior selection against this run's changed set: keep a deselection
  // only when the package still has a releasable change, and never honour one for a lockstep
  // (fixed/linked) group member — those release together, so holding one back would split the group
  // (its untick is ignored and the row re-renders ticked next run). The result both narrows the
  // write below (excluded packages are never bumped) and seeds the rendered selection region.
  const dryUpdates = publishableUpdates(versionOutputDry);
  const groups = releaseKitConfig.version?.groups ?? {};
  const changedNames = new Set(dryUpdates.map((u) => u.packageName));
  // Release-unit selection (#464): with `primaryPackages` configured the list renders primaries as
  // parent rows with their coupled members nested beneath. Resolving primaries — including ones not
  // bumping this run — needs the full workspace package list, loaded lazily only when the feature is
  // on. Sync releases never render a selection region, so this is all skipped for them.
  const primaryPackages = standingPrConfig?.primaryPackages ?? [];
  const selectionMode = standingPrConfig?.selection ?? 'streamlined';
  let primaryConfig: PrimaryConfig | undefined;
  if (primaryPackages.length > 0 && versionOutputDry.strategy !== 'sync') {
    const { getWorkspacePackageNames } = await import('@releasekit/version');
    const allPackageNames = await getWorkspacePackageNames({ cwd, configPath: options.config });
    primaryConfig = { primaryPackages, selection: selectionMode, groups, allPackageNames };
    for (const w of validatePrimaryPackages(primaryPackages, allPackageNames, releaseKitConfig.version?.skip ?? [])) {
      warn(`Selection: ${w}`);
    }
  }

  const effectiveDeselected = new Set<string>();
  // Sync releases ship atomically and never render a selection region, so ignore any deselection —
  // a residual region (e.g. a body left over from before the repo switched to sync) must not
  // silently narrow a sync release into a partial one. Same guard the selection-block render uses.
  if (versionOutputDry.strategy !== 'sync') {
    if (primaryConfig && primaryConfig.selection !== 'granular') {
      // Streamlined units: a held-back primary cascades to its whole closure (reference-counted, so a
      // shared child keeps releasing while any owner does). This supersedes the per-package lockstep
      // guard below — the entire group is held together, never split — so no partial-group warning.
      const hierarchy = computeHierarchy(dryUpdates, primaryConfig);
      for (const name of cascadeDeselection(hierarchy, new Set(priorDeselected))) effectiveDeselected.add(name);
    } else {
      // Flat / granular selection: honour a held-back row per package, but never for a lockstep
      // (fixed/linked) member — those release together, so its untick is ignored (re-renders ticked).
      for (const name of priorDeselected) {
        if (!changedNames.has(name)) continue;
        const update = dryUpdates.find((u) => u.packageName === name);
        const groupSync = update?.group ? groups[update.group]?.sync : undefined;
        if (groupSync === 'fixed' || groupSync === 'linked') {
          warn(
            `Selection: ignoring held-back \`${name}\` — lockstep group \`${update?.group}\` members release together.`,
          );
          continue;
        }
        effectiveDeselected.add(name);
      }
    }
  }

  // Materialize changes on release branch. Held-back packages are excluded from the version step so
  // they are never bumped — no orphan bump lands on the base branch with no tag (roll-forward model).
  info('Writing version bumps...');
  const writeOptions = buildBaseReleaseOptions(options, false, { ...buildExtras, exclude: [...effectiveDeselected] });
  const versionOutput = await runVersionStep(writeOptions);

  // The write step recomputes from the post-reset HEAD, which can differ from the dry run when a
  // release landed on `base` mid-run (a reconcile race exempt from the skip-pattern bail above): the
  // dry-run guard saw updates, but the write set is now empty. Without this second guard the empty
  // output renders a degenerate `****` body and an empty `chore: release ` title onto the open PR
  // (#396). Gate on publishable updates so a sync root-only bump with nothing to publish is caught too.
  if (publishableUpdates(versionOutput).length === 0) {
    return closeEmptyQueue(existingStandingPr, githubContext);
  }

  // With the preview-notes label, pull any release notes a human has already edited from the live PR
  // body (fetched once above) so they survive this regenerate-and-force-push. Marker slicing only.
  const previewPackages = publishableUpdates(versionOutput).map((u) => u.packageName);
  let editedNotes: Record<string, string> = {};
  if (previewNotesEnabled && liveBody) {
    editedNotes = extractNotesRegions(liveBody, previewPackages);
  }

  // Generate per-package CHANGELOG.md always; LLM release notes only when previewing. To keep LLM
  // load low (#200), skip generation when every releasing package already has an edited region —
  // notes are seeded once when the label is first applied, then preserved on later pushes.
  info('Generating changelog...');
  const allPackagesHaveRegions = previewPackages.length > 0 && previewPackages.every((p) => p in editedNotes);
  const generateReleaseNotes = previewNotesEnabled && !allPackagesHaveRegions;
  const notesOptions = { ...writeOptions, skipNotes: false, skipReleaseNotes: !generateReleaseNotes };
  const notesResult = await runNotesStep(versionOutput, notesOptions);

  // Commit and force-push the release branch
  info(`Committing and pushing '${branch}'...`);
  await commitAndForcePush(branch, cwd);

  // Capture the release branch HEAD SHA for the status check (we're still on the release branch)
  const releaseBranchSha = await getHeadSha(cwd);

  success(`Release branch '${branch}' updated`);

  if (!githubContext?.token) {
    warn('No GitHub context available — skipping PR creation');
    return { action: 'noop', versionOutput };
  }

  const forge = forgeFor(githubContext);

  // Build PR title and labels. ${count} and ${version} exclude the root lockstep bump —
  // it isn't a publishable package. Sync releases move as one unit, so the sync default
  // leads with the version; both defaults start with 'chore: release' so they match the
  // default skip pattern on squash merge.
  const countableUpdates = publishableUpdates(versionOutput);
  const count = countableUpdates.length;
  const firstUpdate = countableUpdates[0];
  const isSync = versionOutput.strategy === 'sync';
  /* biome-ignore lint/suspicious/noTemplateCurlyInString: template string uses config variable */
  const defaultTitle = isSync ? 'chore: release ${tag}' : 'chore: release ${count} package(s)';
  const titleTemplate = standingPrConfig?.title ?? defaultTitle;
  const title = titleTemplate
    .replace(/\$\{count\}/g, String(count))
    .replace(/\$\{version\}/g, firstUpdate?.newVersion ?? '')
    .replace(/\$\{tag\}/g, syncVersionDisplay(versionOutput));

  const labels = standingPrConfig?.labels ?? ['release'];

  // Reuse the standing PR fetched at the top of this function — same source of truth as the
  // label override resolution; saves an extra API call.
  const existing = existingStandingPr;

  // Detect an unresolved partial-publish on the most recently merged standing PR so this PR's
  // body warns that the prior release is incomplete and offers the retry-vs-supersede choice.
  // Best-effort — a lookup failure must not block the standing-PR update.
  let supersedeWarning: string[] | undefined;
  try {
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
  } catch (err) {
    warn(`Could not check for unresolved publish failures: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Edited notes win per package; packages new since the last edit fall back to freshly generated.
  // The read-modify-write here has a small window: a human edit landing between the pulls.get above
  // and the pulls.update below can be overwritten. Standing-PR updates are infrequent (push-driven),
  // so we accept it rather than add optimistic-concurrency machinery.
  let notesRegion: string | undefined;
  if (previewNotesEnabled) {
    const merged = mergeNotesRegions(notesResult.releaseNotes ?? {}, editedNotes);
    if (Object.keys(merged).length > 0) notesRegion = renderNotesRegion(merged);
  }

  // The interactive selection region — the package list for non-sync releases. Rendered from the
  // full changed set (dry run) so a held-back package still shows as an unticked row; sync releases
  // are atomic and carry none. Coherence warnings (partial independent group, held-back prerequisite
  // of a still-selected target) ride below the region and surface in the run log. Each row carries
  // its own co-located changelog; the renderer is re-invokable with changelogs on/off so the body-cap
  // fallback can shed per-row changelogs while keeping the rows.
  let renderSelectionBlock: ((withChangelogs: boolean) => string) | undefined;
  if (versionOutputDry.strategy !== 'sync') {
    const warnings = selectionWarnings(dryUpdates, effectiveDeselected, groups);
    for (const w of warnings) warn(`Selection: ${w.reason}`);
    const warningSuffix = warnings.length > 0 ? `\n\n${warnings.map((w) => `> ⚠️ ${w.reason}`).join('\n')}` : '';
    // Per-row changelogs are sourced from the DRY changelogs (the full changed set) so a held-back
    // row still shows its greyed changelog — the write output omits held-back packages entirely.
    const rowChangelog = makeRowChangelogRenderer(versionOutputDry.changelogs);
    renderSelectionBlock = (withChangelogs) =>
      renderSelectionRegion(dryUpdates, effectiveDeselected, primaryConfig, withChangelogs ? rowChangelog : undefined) +
      warningSuffix;
  }

  // The flat, de-duplicated combined footer — every change once, grouped by type. Driven by the write
  // output (already excludes held-back packages, so it mirrors what publishes). The gate is a
  // redundancy control, never a drop-data control: sync releases carry no per-row changelogs, so the
  // footer is their only changelog surface and always renders; and when the gate suppresses the full
  // footer in non-sync mode we still surface project-wide (shared) entries, which have no per-row home.
  const footerEnabled = standingPrConfig?.combinedChangelogFooter !== false;
  const footer =
    footerEnabled || versionOutput.strategy === 'sync'
      ? renderCombinedFooter(versionOutput)
      : renderCombinedFooter(versionOutput, { sharedOnly: true });

  const body = renderPrBody(versionOutput, { supersedeWarning, notesRegion, renderSelectionBlock, footer });

  let prNumber: number;
  let prUrl: string;
  let action: StandingPRResult['action'];

  if (existing) {
    await forge.updatePullRequest(existing.number, { title, body });
    prNumber = existing.number;
    prUrl = existing.url;
    action = 'updated';
    info(`Updated standing PR #${prNumber}`);
  } else {
    const newPr = await forge.createPullRequest({ title, body, head: branch, base });
    prNumber = newPr.number;
    prUrl = newPr.url;
    action = 'created';
    info(`Created standing PR #${prNumber}`);
  }

  // Ensure the full ReleaseKit label set exists in the repo from the shared definitions. The
  // retry label is created but NOT applied — a maintainer applies it on demand after merge to
  // retry a failed publish (issue #245). Best-effort: a sync failure must not block the update.
  try {
    // Seed a `graduate:<package>` label for every package currently on a prerelease line (#486) so a
    // maintainer can pick one from GitHub's label list — labels must exist before they can be applied.
    await syncLabels(forge, deriveLabelDefinitions(ciConfig, prereleasePackageNames(versionOutput)));
  } catch (err) {
    warn(`Could not ensure ReleaseKit labels exist: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Apply the standing-PR labels — preserve any maintainer-added labels (e.g. bump:major,
  // scope:foo) by taking the union of the currently-applied labels and the configured set. Without
  // this, every update would wipe maintainer overrides. Base the union on `effectiveLabels` (not the
  // raw live labels) so an unauthorized release-control label reconciled out above is removed here
  // rather than re-added (#402); run even with no configured labels when that reconcile changed the set.
  const labelsReconciled = !setsEqual(new Set(effectiveLabels), new Set(existingStandingPr?.labels ?? []));
  if (labels.length > 0 || labelsReconciled) {
    try {
      const mergedLabels = [...new Set([...effectiveLabels, ...labels])];
      await forge.setLabels(prNumber, mergedLabels);
    } catch {
      warn('Failed to apply labels to standing PR');
    }
  }

  // Preserve firstUpdatedAt across updates, from the manifest read once up front.
  let firstUpdatedAt = new Date().toISOString();
  if (existingManifest) {
    firstUpdatedAt = existingManifest.firstUpdatedAt ?? existingManifest.createdAt;
  }

  // Packages that graduated to stable this run (#486), recorded in the manifest below for provenance
  // and for the channel-grouped render (#487). Derived from what actually resolved, so it reflects
  // group atomicity and the whole-batch graduate as well as the per-package labels.
  const graduatedPackages = graduatedPackageNames(versionOutput);

  // Store manifest as a bot comment. `releaseNotes` is intentionally omitted — publishFromManifest
  // regenerates LLM-enhanced release notes against the merged commit set, so caching them here
  // would waste LLM calls and risk drift if the standing PR sits open while new commits land.
  const manifest: StandingPRManifest = {
    schemaVersion: 2,
    versionOutput,
    releaseNotes: {},
    notesFiles: notesResult.files,
    createdAt: new Date().toISOString(),
    baseSha,
    firstUpdatedAt,
    // Record the labels this manifest was computed under so publish can detect a stale manifest if
    // they're changed after this update without a re-run (#337).
    overrideLabels: extractOverrideLabels(effectiveLabels, ciConfig),
    // Record any packages held back via the selection region (provenance; the release set in
    // `versionOutput` is already narrowed). Omitted when nothing was deselected.
    deselected: effectiveDeselected.size > 0 ? [...effectiveDeselected].sort() : undefined,
    // Record which packages graduated to stable this run (#486) so the state survives re-runs and
    // consumers (#487) can flag a graduated row. Omitted when nothing graduated.
    graduated: graduatedPackages.length > 0 ? graduatedPackages : undefined,
  };

  const manifestBody = serializeManifest(manifest);
  if (existingManifestComment) {
    await forge.updateComment(existingManifestComment.id, manifestBody);
  } else {
    await forge.createComment(prNumber, manifestBody);
  }
  success(`Manifest written to PR #${prNumber}`);

  // Post commit status check — gates determine pending vs success
  const minAge = standingPrConfig?.minAge;
  let statusState: 'success' | 'pending' = 'success';
  let statusDescription = 'Ready to merge';

  // Standing-PR label conflicts surface here as a pending check so the team notices.
  if (overrides.conflicts.length > 0) {
    statusState = 'pending';
    statusDescription = overrides.conflicts.join('; ').slice(0, 140);
  }

  if (minAge !== undefined && overrides.conflicts.length === 0) {
    const minAgeMs = parseDuration(minAge);
    if (minAgeMs === null) {
      warn(
        `ci.standingPr.minAge value "${minAge}" is not a valid duration (e.g. "6h", "30m", "1d") — gate is inactive`,
      );
    } else if (manifest.firstUpdatedAt) {
      const ageMs = Date.now() - new Date(manifest.firstUpdatedAt).getTime();
      if (ageMs < minAgeMs) {
        statusState = 'pending';
        statusDescription = `Waiting ${formatDuration(minAgeMs - ageMs)} for minAge`;
      }
    }
  }

  await postStandingPRStatusSafe(forge, releaseBranchSha, statusState, statusDescription);

  return { action, prNumber, prUrl, versionOutput };
}

// Core publish logic: finds manifest on the given PR, optionally extracts user-edited
// notes from the PR body, then runs the publish step and cleans up the release branch.
export async function publishFromManifest(prNumber: number, options: StandingPROptions): Promise<ReleaseOutput | null> {
  const cwd = options.projectDir;

  const githubContext = getGitHubContext();
  if (!githubContext?.token) {
    error('No GitHub context (GITHUB_REPOSITORY or GITHUB_TOKEN) available');
    return null;
  }

  const forge = forgeFor(githubContext);

  const releaseKitConfig = loadReleaseKitConfig({ cwd, configPath: options.config });
  const standingPrConfig = releaseKitConfig.ci?.standingPr;
  const releaseBranch = standingPrConfig?.branch ?? 'release/next';
  const deleteBranchOnMerge = standingPrConfig?.deleteBranchOnMerge !== false;

  // Find and parse manifest from the PR
  const manifestComment = await findManifestComment(forge, prNumber);
  if (!manifestComment) {
    throw new Error(`Release manifest not found on PR #${prNumber}. Re-run 'standing-pr update' to regenerate.`);
  }

  let manifest: StandingPRManifest;
  try {
    manifest = parseManifest(manifestComment.body);
  } catch (err) {
    throw new Error(
      `Release manifest on PR #${prNumber} is invalid or incompatible. Re-run 'standing-pr update'. Details: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // Publish-author gate (#403): defense-in-depth behind a branch-protection ruleset (the primary
  // merge gate). Refuse to publish when the actor who merged the PR isn't authorized to steer
  // releases — catching a missing/misconfigured ruleset. On an unverifiable permission check we
  // proceed rather than block a legitimate release (the ruleset already gated the merge). Mirrors
  // the #337 staleness refusal: a publish that shouldn't happen is stopped here, not retried.
  const authz = standingPrConfig?.authorization;
  if (authz?.enforceMergeAuthor) {
    const actor = getEventActor();
    if (!actor.mergedBy) {
      // No merger in the event (e.g. a manual/dispatch publish, or an inferred PR with no event) —
      // the gate can't run. Log it so an enforcement gap is visible rather than a silent skip.
      warn(
        `enforceMergeAuthor is set but the merging actor is unknown (no merged_by in the event) — skipping the publish-author check for PR #${prNumber}.`,
      );
    } else {
      let authorized = true;
      try {
        authorized = await isAuthorizedActor(forge, actor.mergedBy, actor.mergedByType, authz);
      } catch (err) {
        warn(
          `Could not verify merger '${actor.mergedBy}' permission — proceeding, since branch protection is the primary gate: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      if (!authorized) {
        throw new Error(
          `Refusing to publish PR #${prNumber}: it was merged by '${actor.mergedBy}', who lacks the required '${authz.requiredPermission}' permission (ci.standingPr.authorization). Restrict who can merge the release branch with a branch-protection ruleset, or set ci.standingPr.authorization.enforceMergeAuthor: false.`,
        );
      }
    }
  }

  // Warn if manifest base is no longer an ancestor of current HEAD (history may be rewritten).
  // `isAncestor` returns false on a non-zero exit (not an ancestor) rather than throwing, so the
  // old try/catch becomes a plain boolean check.
  const currentSha = await getHeadSha(cwd);
  if (!(await createGitCli().isAncestor(manifest.baseSha, currentSha, cwd))) {
    warn(
      `Manifest baseSha (${manifest.baseSha}) is not an ancestor of current HEAD (${currentSha}) — history may have been rewritten`,
    );
  }

  info(`Publishing from manifest: ${publishableUpdates(manifest.versionOutput).length} package(s)`);

  // Regenerate LLM-enhanced release notes against the merged commit set. The standing-PR update
  // intentionally skipped this so the standing-PR workflow doesn't depend on LLM availability.
  // On failure we proceed with empty release notes — the publish stage falls back to GitHub's
  // --generate-notes for the release body.
  const notesGenerationOptions: ReleaseOptions = {
    config: options.config,
    dryRun: false,
    sync: false,
    skipNotes: false,
    skipChangelogs: true,
    skipReleaseNotes: false,
    skipPublish: true,
    skipGit: true,
    skipGithubRelease: true,
    skipVerification: true,
    json: options.json,
    verbose: options.verbose,
    quiet: options.quiet,
    projectDir: cwd,
  };

  // Fetch the merged (still-readable) PR once — used for both the override-label staleness guard
  // and the human-edited release notes.
  let livePr: PullRequestDetails | undefined;
  try {
    livePr = await forge.getPullRequest(prNumber);
  } catch (err) {
    warn(`Could not read PR #${prNumber}: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Staleness guard (#337): refuse to publish a manifest whose override labels diverge from the
  // merged PR's. This catches "label changed then merged before the standing-PR update re-ran" —
  // publishing then would ship a release the labels no longer describe. Only enforced when the
  // manifest actually recorded labels; manifests written before this field skip the check.
  //
  // Fail closed rather than publish blind: when the manifest carried override labels but the PR is
  // unreadable (transient API failure coinciding with the race window) we can't verify, so refuse
  // and let the retry handle it. An empty override set has nothing a label change could contradict
  // beyond "a label was added", which the next update would have folded in — not worth failing the
  // common (no-override) publish on an API blip.
  if (!livePr && manifest.overrideLabels !== undefined && manifest.overrideLabels.length > 0) {
    throw new Error(
      `Cannot verify standing PR #${prNumber} override labels against the manifest — the PR could not be read ` +
        `from GitHub. Refusing to publish a manifest that carried override labels without confirming they still ` +
        `match. Re-run once the GitHub API is reachable (or apply the retry label).`,
    );
  }
  if (livePr && manifest.overrideLabels !== undefined) {
    const mergedLabels = extractOverrideLabels((livePr.labels ?? []).filter(Boolean), releaseKitConfig.ci);
    const manifestLabels = [...manifest.overrideLabels].sort();
    if (mergedLabels.join('\n') !== manifestLabels.join('\n')) {
      throw new Error(
        `Standing PR #${prNumber} override labels changed after the last update — the release manifest is stale.\n` +
          `  manifest was computed for: [${manifestLabels.join(', ') || '(none)'}]\n` +
          `  PR now has:                [${mergedLabels.join(', ') || '(none)'}]\n` +
          `Re-run 'releasekit standing-pr update' so the manifest matches, then merge (or apply the retry label after ` +
          `updating). Refusing to publish a release the labels no longer describe.`,
      );
    }
  }

  // Pull any human-edited release notes from the live PR body (#200). Marker slicing only — the
  // manifest never stores prose, so "manifest = machine state only" holds.
  let editedNotes: Record<string, string> = {};
  if (livePr) {
    editedNotes = extractNotesRegions(
      livePr.body ?? '',
      publishableUpdates(manifest.versionOutput).map((u) => u.packageName),
    );
  }

  let releaseNotes: Record<string, string> = {};
  let notesFiles: string[] = [...manifest.notesFiles];
  try {
    info('Generating release notes (with LLM enhancement)...');
    const notesResult = await runNotesStep(manifest.versionOutput, notesGenerationOptions);
    releaseNotes = notesResult.releaseNotes ?? {};
    // Add any newly written files (RELEASE_NOTES.md) to the notesFiles list. Don't dedupe
    // against manifest.notesFiles by string equality alone — paths may differ — but the
    // changelog files were already on main from the merge so we don't need them in the
    // publish commit anyway. Just track the new ones.
    const newFiles = notesResult.files.filter((f) => !manifest.notesFiles.includes(f));
    notesFiles = [...notesFiles, ...newFiles];

    // Commit the new RELEASE_NOTES.md so main reflects what's in the GitHub release body.
    // Tags created next land on this commit (which is fine — the tag captures the full release
    // state including notes).
    if (newFiles.length > 0) {
      await commitNotesFiles(newFiles, manifest.versionOutput, cwd);
    }
  } catch (err) {
    warn(`Release notes generation failed: ${err instanceof Error ? err.message : String(err)}`);
    warn('Publish will proceed with empty release notes; GitHub release will use auto-generated notes.');
  }

  // Human-edited notes win per package for the GitHub release body. Applied after regeneration so
  // edits override fresh prose, and so a regeneration failure still yields the edited content.
  if (Object.keys(editedNotes).length > 0) {
    releaseNotes = { ...releaseNotes, ...editedNotes };
    info(`Using human-edited release notes for ${Object.keys(editedNotes).length} package(s) from the PR body.`);
  }

  // Create the release tags at HEAD before invoking the publish pipeline. The pipeline's
  // git-commit stage (where tag creation normally lives) is skipped via skipGitCommit below,
  // so without this the pipeline's `git push --tags` would have nothing to push. Baseline
  // tags (when configured via baselineTagTemplate) are created here too — they live at the
  // same release commit and need to be pushed alongside the consumer tags.
  await createReleaseTags([...manifest.versionOutput.tags, ...(manifest.versionOutput.baselineTags ?? [])], cwd);

  const publishOptions: ReleaseOptions = {
    config: options.config,
    dryRun: false,
    sync: false,
    skipNotes: true,
    skipPublish: false,
    skipGit: false,
    skipGitCommit: true,
    skipGithubRelease: false,
    skipVerification: false,
    json: options.json,
    verbose: options.verbose,
    quiet: options.quiet,
    projectDir: cwd,
    npmAuth: (options.npmAuth as ReleaseOptions['npmAuth']) ?? 'auto',
  };

  let publishOutput: ReleaseOutput['publishOutput'];
  try {
    publishOutput = await runPublishStep(manifest.versionOutput, publishOptions, releaseNotes, notesFiles);
  } catch (err) {
    // Partial-publish failure: surface the report on the merged standing PR (the PR whose
    // manifest drove this publish). Versions are already on main (roll-forward); the report
    // explains what landed and how to retry. Best-effort — the guard ensures a reporting
    // failure never replaces the original pipeline error, which is always re-thrown.
    if (err instanceof PipelineError) {
      try {
        await postFailureReport(
          {
            forge,
            mode: 'standing-pr',
            prNumber,
            standingPrNumber: prNumber,
            retryLabelAvailable: true,
          },
          manifest.versionOutput,
          err,
        );
      } catch (reportErr) {
        warn(
          `Failed to surface publish-failure report: ${reportErr instanceof Error ? reportErr.message : String(reportErr)}`,
        );
      }
    }
    throw err;
  }

  success('Publish complete');

  // Publish succeeded — clear any prior failure report on this PR (resolves it and the supersede
  // warning that would otherwise show on the next standing PR).
  await resolveFailureReportIfPresent(forge, prNumber, manifest.versionOutput);

  // The standing-PR publish moved `main` just like a direct release, so still-open feeder PRs'
  // previews go stale here too. Refresh them in-process (opt-in, best-effort, never throws).
  await refreshFeederPreviews({ config: options.config, projectDir: cwd });

  // Cleanup: delete release branch if configured
  if (deleteBranchOnMerge) {
    await deleteReleaseBranch(releaseBranch, cwd);
  }

  return {
    versionOutput: manifest.versionOutput,
    // Reflect actual success — the LLM call may have failed and left releaseNotes empty,
    // in which case downstream consumers should know not to display/propagate "generated" notes.
    notesGenerated: Object.keys(releaseNotes).length > 0,
    releaseNotes,
    publishOutput,
  };
}

/**
 * Find the most recently merged PR whose head is the standing release branch.
 * Inference fallback for dispatch-funnelled publishes — explicit `--pr` is preferred
 * because a re-run of a stale dispatch can land after a newer standing PR has merged.
 */
export async function findLatestMergedStandingPR(forge: Forge, branch: string): Promise<number | null> {
  const prs = await forge.listRecentlyClosedPullRequests(branch, 10);

  // 'updated' ordering only guarantees the newest merge is in the page (merging touches
  // updated_at) — late activity on an older merged PR (a comment, a label) can sort it
  // above a newer merge. Pick by mergedAt, not list position.
  const merged = prs
    .filter((pr) => pr.mergedAt != null)
    .sort((a, b) => new Date(b.mergedAt as string).getTime() - new Date(a.mergedAt as string).getTime());
  return merged[0]?.number ?? null;
}

export async function runStandingPRPublish(
  options: StandingPROptions,
  explicitPrNumber?: number,
): Promise<ReleaseOutput | null> {
  // Resolution order: explicit --pr, then the pull_request event payload, then the most
  // recently merged standing PR via the API. The API fallback covers dispatch-funnelled
  // workflows (workflow_dispatch has no pull_request payload).
  if (explicitPrNumber !== undefined) {
    return publishFromManifest(explicitPrNumber, options);
  }

  const cwd = options.projectDir;

  const releaseKitConfig = loadReleaseKitConfig({ cwd, configPath: options.config });
  const standingPrConfig = releaseKitConfig.ci?.standingPr;
  const releaseBranch = standingPrConfig?.branch ?? 'release/next';

  // Pull-request-event path: parse the event payload to find the merged PR.
  const eventPath = process.env.GITHUB_EVENT_PATH;
  let event: { pull_request?: { head?: { ref?: string }; number?: number; merged?: boolean } } | undefined;
  if (eventPath) {
    try {
      event = JSON.parse(fs.readFileSync(eventPath, 'utf-8'));
    } catch (err) {
      error(`Failed to read GitHub event: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }

  if (event?.pull_request) {
    const headRef = event.pull_request.head?.ref;
    const merged = event.pull_request.merged;
    const prNumber = event.pull_request.number;

    if (!headRef || headRef !== releaseBranch) {
      info(`Skipping: merged PR head ref '${headRef}' does not match release branch '${releaseBranch}'`);
      return null;
    }

    if (!merged) {
      info('Skipping: PR was not merged');
      return null;
    }

    if (!prNumber) {
      error('Could not determine PR number from GitHub event');
      return null;
    }

    return publishFromManifest(prNumber, options);
  }

  // No pull_request context — infer the merged standing PR from the API.
  const githubContext = getGitHubContext();
  if (!githubContext?.token) {
    error('No GitHub context (GITHUB_REPOSITORY or GITHUB_TOKEN) available — pass --pr explicitly');
    return null;
  }

  const inferred = await findLatestMergedStandingPR(forgeFor(githubContext), releaseBranch);
  if (inferred === null) {
    error(`No merged standing release PR found for branch '${releaseBranch}' — pass --pr explicitly`);
    return null;
  }

  info(
    `Inferred standing PR #${inferred} (most recently merged '${releaseBranch}' PR) — pass --pr to target a specific PR`,
  );
  return publishFromManifest(inferred, options);
}

export async function runStandingPRMerge(
  options: StandingPROptions,
  flags: { publish: boolean },
): Promise<ReleaseOutput | null> {
  const cwd = options.projectDir;

  const releaseKitConfig = loadReleaseKitConfig({ cwd, configPath: options.config });
  const standingPrConfig = releaseKitConfig.ci?.standingPr;
  const branch = standingPrConfig?.branch ?? 'release/next';
  const mergeMethod = (standingPrConfig?.mergeMethod ?? 'merge') as 'merge' | 'squash' | 'rebase';
  const deleteBranchOnMerge = standingPrConfig?.deleteBranchOnMerge !== false;

  const githubContext = getGitHubContext();
  if (!githubContext?.token) {
    error('No GitHub context (GITHUB_REPOSITORY or GITHUB_TOKEN) available');
    return null;
  }

  const forge = forgeFor(githubContext);

  const pr = await forge.findStandingPR(branch);
  if (!pr) {
    info(`No open standing PR found for branch '${branch}'`);
    return null;
  }

  info(`Merging standing PR #${pr.number} via ${mergeMethod}...`);
  try {
    await forge.mergePullRequest(pr.number, mergeMethod);
  } catch (err) {
    if (forgeErrorStatus(err) === 405) {
      // Best-effort detail; the forge surfaces the raw error, so a non-GitHub adapter just yields
      // 'unknown reason' here.
      const reason =
        (err as { response?: { data?: { message?: string } } }).response?.data?.message ?? 'unknown reason';
      throw new Error(`Cannot merge standing PR #${pr.number}: GitHub rejected the merge (${reason})`);
    }
    throw err;
  }
  success(`Standing PR #${pr.number} merged`);

  // If not publishing, delete the branch now (otherwise publishFromManifest handles it)
  if (!flags.publish && deleteBranchOnMerge) {
    await deleteReleaseBranch(branch, cwd);
  }

  if (!flags.publish) {
    return null;
  }

  return publishFromManifest(pr.number, options);
}
