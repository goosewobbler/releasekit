import * as fs from 'node:fs';
import { type CIConfig, DEFAULT_DEMOTE_SCOPES, loadConfig as loadReleaseKitConfig } from '@releasekit/config';
import type { VersionOutput, VersionPackageUpdate } from '@releasekit/core';
import {
  deriveReleaseChannel,
  error,
  info,
  markerData,
  shouldMatchPackageTargets,
  success,
  warn,
} from '@releasekit/core';
import {
  type Forge,
  type ForgeComment,
  forgeErrorStatus,
  isBotComment,
  type PullRequestDetails,
} from '@releasekit/forge';
import { createGitCli } from '@releasekit/git';
import { PipelineError } from '@releasekit/publish';
import { z } from 'zod';
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
  type ChannelToggleConfig,
  cascadeDeselection,
  computeHierarchy,
  extractChannelSelection,
  extractSelection,
  type PrimaryConfig,
  renderSelectionRegion,
  resolveChannelConflicts,
  selectionWarnings,
  validatePrimaryPackages,
} from './selection-region.js';
import { postStandingPRStatusSafe } from './status.js';
import { renderReleaseSummaryLine, renderVersionSummaryTable } from './summary-region.js';

export const MANIFEST_MARKER = '<!-- releasekit-manifest -->';
const MANIFEST_SCHEMA_VERSION = 2;
const SELECTION_DENIED_MARKER = '<!-- releasekit-selection-denied -->';
const LABEL_DENIED_MARKER = '<!-- releasekit-label-denied -->';
const CHANNEL_DENIED_MARKER = '<!-- releasekit-channel-denied -->';
const MANIFEST_SCHEMA_MIN_VERSION = 1;

// Raw payload only; decoding and validation stay in parseManifest for its specific error messages.
const MANIFEST_BASE64 = markerData<string>({
  open: '<!-- base64',
  serialize: (encoded) => encoded,
  deserialize: (payload) => payload || null,
});

// A legitimate manifest is a few KB even for a large monorepo; reject anything far larger before parsing so a
// bloated (or hostile) payload can't drive an unbounded JSON.parse.
const MAX_MANIFEST_BYTES = 1_000_000;

// A write-access actor can edit the comment's base64, so the fields a merge will publish (packages, versions, tags)
// are type-checked before anything trusts them. `.passthrough()` keeps unknown fields so new optional ones survive a
// round-trip.
const ManifestVersionOutputSchema = z
  .object({
    updates: z.array(
      z
        .object({
          packageName: z.string(),
          newVersion: z.string(),
          filePath: z.string(),
        })
        .passthrough(),
    ),
    tags: z.array(z.string()),
    baselineTags: z.array(z.string()).optional(),
  })
  .passthrough();

const ManifestSchema = z
  .object({
    versionOutput: ManifestVersionOutputSchema,
    releaseNotes: z.record(z.string(), z.string()),
    notesFiles: z.array(z.string()),
    createdAt: z.string(),
    baseSha: z.string(),
    firstUpdatedAt: z.string().optional(),
    overrideLabels: z.array(z.string()).optional(),
    deselected: z.array(z.string()).optional(),
    graduated: z.array(z.string()).optional(),
    prereleased: z.array(z.string()).optional(),
  })
  .passthrough();

export interface StandingPROptions {
  config?: string;
  projectDir: string;
  verbose: boolean;
  quiet: boolean;
  json: boolean;
  npmAuth?: string;
  /**
   * Bypass only the skip-pattern guard: post-release reconcile runs `standing-pr update` when HEAD is, by
   * definition, a release commit matching the skip pattern.
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

/** Old manifests live in open PRs: fields added after v1 must stay optional and be tolerated when absent. */
export interface StandingPRManifest {
  schemaVersion: 1 | 2;
  versionOutput: VersionOutput;
  releaseNotes: Record<string, string>;
  notesFiles: string[];
  createdAt: string;
  baseSha: string;
  /** When the standing PR was first created, preserved across updates. */
  firstUpdatedAt?: string;
  /**
   * Override-relevant labels on the standing PR when this manifest was computed, sorted, so publish can refuse a
   * manifest whose labels diverged from the merged PR.
   */
  overrideLabels?: string[];
  /** Packages unticked in the selection region. Provenance only - `versionOutput` already excludes them. */
  deselected?: string[];
  /**
   * Lets the channel-grouped render flag graduated rows; `versionOutput` already holds the stable versions. When
   * absent, consumers re-derive from each update's `channel`/`action`.
   */
  graduated?: string[];
  /**
   * Packages (and their groups) shifted onto a prerelease line by the per-row channel toggle. Provenance & round-trip
   * only - `versionOutput` already holds the prerelease versions.
   */
  prereleased?: string[];
}

async function getHeadSha(cwd: string): Promise<string> {
  try {
    return await createGitCli().headSha(cwd);
  } catch (err) {
    throw new Error(`Failed to get HEAD SHA: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * True when a maintainer's label or body edit on the standing PR triggered this run, so the checked-out commit's
 * subject says nothing about it. Read from the event (not a flag) so it works from the action, the reusable workflow
 * or the CLI. An `edited` re-trigger is safe: the body re-render is idempotent and the workflow guards out the bot's
 * own edits.
 */
function isStandingPrEventRun(): boolean {
  if (process.env.GITHUB_EVENT_NAME !== 'pull_request') {
    return false;
  }
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath) {
    return false;
  }
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

  // `checkout -B` creates or resets the branch, so this works whether or not it already exists.
  await git.checkout(branch, { create: true, cwd });
  await git.resetHard(`origin/${base}`, cwd);
}

const CI_SKIP_MARKER = /\[(?:skip ci|ci skip|no ci|skip actions|actions skip)\]/i;

async function commitAndForcePush(branch: string, subject: string, cwd: string): Promise<void> {
  const git = createGitCli();
  await git.addAll(cwd);

  const status = (await git.status({ porcelain: true, cwd })).trim();
  if (status) {
    await git.commit(subject, { cwd });
  }

  await git.push({ remote: 'origin', ref: branch, forceWithLease: true, cwd });
}

/**
 * Commits the publish-time LLM-enhanced notes, so the release tags created next land on a commit that includes them.
 * Never throws: the caller's catch is for LLM failures and would misreport a git error as one.
 */
async function commitNotesFiles(files: string[], versionOutput: VersionOutput, cwd: string): Promise<void> {
  if (files.length === 0) {
    return;
  }

  const git = createGitCli();

  // `status`, not `git diff HEAD`, so untracked files count - a new per-version notes file would otherwise be skipped.
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

  try {
    await git.add(files, cwd);
  } catch (err) {
    warn(`Failed to stage release notes files: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }

  // Sync mode shares one version; otherwise the first is a representative, fine for an audit-only commit.
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
 * Standing-PR publish sets `skipGitCommit: true` to avoid duplicating the squash-merge commit, which also skips the
 * pipeline's tag creation. Mirrors `runGitCommitStage`'s idempotency (packages/publish/src/stages/git-commit.ts).
 * Never throws: the pipeline's `--tags` push publishes whatever tags were created.
 */
export async function createReleaseTags(tags: string[], cwd: string): Promise<void> {
  if (tags.length === 0) {
    return;
  }

  const git = createGitCli();

  let headSha: string;
  try {
    headSha = await git.headSha(cwd);
  } catch (err) {
    warn(`Failed to resolve HEAD for tag creation: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }

  for (const tag of tags) {
    if (await git.refExists(`refs/tags/${tag}`, cwd)) {
      let existing = '';
      try {
        existing = (await git.log({ range: tag, format: '%H', extraArgs: ['-1'], cwd })).trim();
      } catch {
        // Unresolvable: fall through to the warn below.
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
    // The `:<branch>` delete refspec, since the git seam's leading-`-` option guard rejects `--delete`.
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

// GitHub 422s a PR body over 65,536 chars; cap below that so an oversized changelog (usually a package with no
// baseline tag, spanning all history) truncates instead of failing PR creation.
export const STANDING_PR_BODY_CAP = 64000;

function truncateAtLineBoundary(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text;
  }
  const slice = text.slice(0, maxChars);
  const lastNewline = slice.lastIndexOf('\n');
  return lastNewline > 0 ? slice.slice(0, lastNewline) : slice;
}

const TRUNCATION_NOTICE =
  "> **Changelog truncated** — the full changelog exceeded GitHub's PR-body limit and was shortened here. " +
  "Each package's complete changelog is in its `CHANGELOG.md`. This usually means a package has no prior " +
  'release tag, so its changelog spans the entire git history — create baseline tags to scope it.';

// Last resort when even a fully trimmed changelog leaves the body over the cap. Dropping the notes region keeps the
// PR updatable (a 422 would wedge every future update); publish regenerates the notes from source anyway.
const NOTES_OMITTED_NOTICE =
  '## Release Notes\n\n> **Release notes omitted** — they exceeded the PR-body size limit and were left out to keep ' +
  'this PR updatable. They will be regenerated for the GitHub release at publish time.';

interface RenderPrBodyOptions {
  supersedeWarning?: string[];
  notesRegion?: string;
  /** Undefined for sync releases, which publish atomically so carry no selection region. */
  renderSelectionBlock?: (withChangelogs: boolean) => string;
  footer: string;
  summaryLine?: string;
  summaryTable?: string;
}

function renderPrBody(versionOutput: VersionOutput, options: RenderPrBodyOptions): string {
  const { supersedeWarning, notesRegion, renderSelectionBlock, footer, summaryLine, summaryTable } = options;

  // Parameterised so the cap fallback can re-render with progressively trimmed changelogs and notes.
  const build = (
    selectionBlock: string | undefined,
    footerSection: string,
    extraNotice?: string,
    notesSection: string | undefined = notesRegion,
  ): string => {
    const lines: string[] = ['## Release', ''];

    if (summaryLine) {
      lines.push(summaryLine, '');
    }

    // Before the package list, so the maintainer sees the retry-vs-supersede choice first.
    if (supersedeWarning && supersedeWarning.length > 0) {
      lines.push(...supersedeWarning);
    }

    // Separate from the selection region: GitHub only renders interactive checkboxes in a list, never a table cell.
    if (summaryTable) {
      lines.push(summaryTable, '');
    }

    const updates = publishableUpdates(versionOutput);

    if (selectionBlock) {
      lines.push(selectionBlock);
    } else if (versionOutput.strategy === 'sync') {
      // One shared version, so lead with it rather than repeat it per row.
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

    if (footerSection) {
      lines.push('', footerSection, '');
    }
    if (extraNotice) {
      lines.push('', extraNotice, '');
    }
    if (notesSection) {
      lines.push('', notesSection, '');
    }
    lines.push('---', '> Merge this PR to publish. The release will be triggered automatically.');
    lines.push('', ATTRIBUTION_FOOTER);
    return lines.join('\n');
  };

  // Returns the first rendering under the cap, else the smallest it can produce so the caller can fall back to
  // collapsing the notes.
  const shed = (notesSection: string | undefined): string => {
    const fullSelection = renderSelectionBlock?.(true);
    const full = build(fullSelection, footer, undefined, notesSection);
    if (full.length <= STANDING_PR_BODY_CAP) {
      return full;
    }

    if (renderSelectionBlock) {
      // Non-sync: the rows always stay (the PR must remain usable); shed changelog volume in stages.
      // The footer goes first - it duplicates the per-row changelogs.
      if (footer) {
        const body = build(fullSelection, '', undefined, notesSection);
        if (body.length <= STANDING_PR_BODY_CAP) {
          return body;
        }
      }
      const bareSelection = renderSelectionBlock(false);
      const body = build(bareSelection, '', TRUNCATION_NOTICE, notesSection);
      if (body.length <= STANDING_PR_BODY_CAP) {
        return body;
      }
      // Thousands of rows: even the notice overflows.
      return build(bareSelection, '', undefined, notesSection);
    }

    // Sync: the footer is the only changelog, so truncate it rather than drop it.
    if (footer) {
      // 8 = 4 (\n\n around the footer) + 2 (\n\n before the notice) + 2 safety margin.
      const room =
        STANDING_PR_BODY_CAP - build(undefined, '', undefined, notesSection).length - TRUNCATION_NOTICE.length - 8;
      if (room <= 0) {
        return build(undefined, '', undefined, notesSection);
      }
      return build(
        undefined,
        `${truncateAtLineBoundary(footer, room)}\n\n${TRUNCATION_NOTICE}`,
        undefined,
        notesSection,
      );
    }
    return build(undefined, '', undefined, notesSection);
  };

  const primary = shed(notesRegion);
  if (primary.length <= STANDING_PR_BODY_CAP || !notesRegion) {
    return primary;
  }
  // The notes are (part of) the excess: collapse them to a notice, then drop them.
  const collapsed = shed(NOTES_OMITTED_NOTICE);
  if (collapsed.length <= STANDING_PR_BODY_CAP) {
    return collapsed;
  }
  return shed(undefined);
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

  if (json.length > MAX_MANIFEST_BYTES) {
    throw new Error(
      `Release manifest is too large (${json.length} bytes, limit ${MAX_MANIFEST_BYTES}) — refusing to parse. Re-run 'standing-pr update' to regenerate.`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('Release manifest JSON is malformed');
  }

  // Exact membership, not a `< MIN || > MAX` range check, which an absent (`undefined`) version slips past.
  const schemaVersion = (parsed as { schemaVersion?: unknown }).schemaVersion;
  if (schemaVersion !== MANIFEST_SCHEMA_MIN_VERSION && schemaVersion !== MANIFEST_SCHEMA_VERSION) {
    throw new Error(
      `Release manifest schema version ${JSON.stringify(schemaVersion)} is incompatible (expected exactly ${MANIFEST_SCHEMA_MIN_VERSION}–${MANIFEST_SCHEMA_VERSION}). Re-run 'standing-pr update' to regenerate.`,
    );
  }

  const result = ManifestSchema.safeParse(parsed);
  if (!result.success) {
    const detail = result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
    throw new Error(`Release manifest failed validation: ${detail}. Re-run 'standing-pr update' to regenerate.`);
  }

  // Passthrough keeps every field at runtime, so the cast back to the full manifest type is sound.
  return result.data as unknown as StandingPRManifest;
}

export async function findManifestComment(forge: Forge, prNumber: number): Promise<ForgeComment | null> {
  return forge.findComment(prNumber, MANIFEST_MARKER);
}

export interface StandingPRSnapshot {
  number: number;
  url: string;
  manifest: StandingPRManifest;
  openedAt: string;
  /** `pending` while a label conflict or an unelapsed minAge blocks the merge. */
  gateState: 'success' | 'pending';
  gateReason?: string;
}

export async function fetchStandingPRSnapshot(
  forge: Forge,
  ciConfig: CIConfig | undefined,
): Promise<StandingPRSnapshot | null> {
  const branch = ciConfig?.standingPr?.branch ?? 'release/next';
  const pr = await forge.findStandingPR(branch);
  if (!pr) {
    return null;
  }

  const comment = await findManifestComment(forge, pr.number);
  if (!comment) {
    return null;
  }
  // As at publish, refuse a human-authored (possibly forged) manifest.
  if (!isBotComment(comment)) {
    return null;
  }

  let manifest: StandingPRManifest;
  try {
    manifest = parseManifest(comment.body);
  } catch {
    return null;
  }

  // v1 manifests lack firstUpdatedAt and their createdAt is the latest update, so the age reads ~0 until the next
  // update rewrites the manifest as v2.
  const openedAt = manifest.firstUpdatedAt ?? manifest.createdAt;
  const minAge = ciConfig?.standingPr?.minAge;
  let gateState: 'success' | 'pending' = 'success';
  let gateReason: string | undefined;

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

/** The standing PR's labels are the canonical bump/scope/channel overrides; feeder PR labels are advisory. */
interface StandingPrOverrides {
  /** A `pre*` form when prerelease is also requested. */
  bump?: 'major' | 'minor' | 'patch' | 'premajor' | 'preminor' | 'prepatch';
  target?: string;
  stable?: boolean;
  prerelease?: boolean;
  withPrerequisites?: boolean;
  graduate?: string[];
  conflicts: string[];
}

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
 * Whether a label steers the next release, so the manifest's `overrideLabels` staleness guard and the
 * label-authorization reconcile must track it. Dynamic `graduate:<package>` labels count too, or an unauthorized
 * actor could add them unchecked.
 */
function isRelevantOverrideLabel(label: string, ciConfig: CIConfig | undefined): boolean {
  return relevantOverrideLabelNames(ciConfig).has(label) || isGraduatePackageLabel(label, ciConfig?.labels);
}

function extractOverrideLabels(prLabels: string[], ciConfig: CIConfig | undefined): string[] {
  return [...new Set(prLabels.filter((l) => isRelevantOverrideLabel(l, ciConfig)))].sort();
}

function updateChannel(update: VersionPackageUpdate): ReturnType<typeof deriveReleaseChannel> {
  return update.channel ?? deriveReleaseChannel(update.newVersion);
}

function prereleasePackageNames(versionOutput: VersionOutput): string[] {
  return publishableUpdates(versionOutput)
    .filter((u) => updateChannel(u) === 'prerelease')
    .map((u) => u.packageName);
}

/**
 * Widened for group atomicity: a fixed/linked member that adopted the group version from a different baseline
 * reads `'bumped'` but still graduated with its group.
 */
function graduatedPackageNames(versionOutput: VersionOutput): string[] {
  const updates = publishableUpdates(versionOutput);
  const graduatedGroups = new Set(
    updates.filter((u) => u.action === 'graduated' && u.group).map((u) => u.group as string),
  );
  const names = new Set<string>();
  for (const u of updates) {
    if (u.action === 'graduated' || (u.group && graduatedGroups.has(u.group))) {
      names.add(u.packageName);
    }
  }
  return [...names].sort();
}

function resolveStandingPrLabelOverrides(prLabels: string[], ciConfig: CIConfig | undefined): StandingPrOverrides {
  if (!prLabels || prLabels.length === 0) {
    // Fresh object, not a shared constant: callers may mutate `conflicts`.
    return { conflicts: [] };
  }
  const labels = ciConfig?.labels ?? DEFAULT_LABELS;
  const scopeLabels = ciConfig?.scopeLabels ?? {};
  const conflicts: string[] = [];

  let bump: 'major' | 'minor' | 'patch' | undefined;
  const bumpsPresent = [
    prLabels.includes(labels.major) ? labels.major : undefined,
    prLabels.includes(labels.minor) ? labels.minor : undefined,
    prLabels.includes(labels.patch) ? labels.patch : undefined,
  ].filter(Boolean) as string[];
  if (bumpsPresent.length > 1) {
    conflicts.push(`Conflicting bump labels on standing PR (${bumpsPresent.join(', ')}) — remove all but one`);
  } else if (prLabels.includes(labels.major)) {
    bump = 'major';
  } else if (prLabels.includes(labels.minor)) {
    bump = 'minor';
  } else if (prLabels.includes(labels.patch)) {
    bump = 'patch';
  }

  const hasGraduate = prLabels.includes(labels.graduate);
  const hasPrerelease = prLabels.includes(labels.prerelease);
  let stable: boolean | undefined;
  let prerelease: boolean | undefined;
  if (hasGraduate && hasPrerelease) {
    conflicts.push(`Conflicting release-type labels on standing PR (${labels.graduate} and ${labels.prerelease})`);
  } else {
    if (hasGraduate) {
      stable = true;
    }
    if (hasPrerelease) {
      prerelease = true;
    }
  }

  // The whole-batch graduate already graduates everything, so a per-package subset would only narrow it.
  const graduateLabels = stable ? [] : prLabels.filter((l) => isGraduatePackageLabel(l, labels));
  const graduate = stable
    ? []
    : graduateLabels.map((l) => graduatedPackageFromLabel(l, labels)).filter((p): p is string => p !== undefined);
  if (graduate.length > 0 && hasPrerelease) {
    // Labels named up front because the status check truncates at 140 chars.
    conflicts.push(
      `Conflicting release-type labels: ${graduateLabels.map((l) => `\`${l}\``).join(', ')} graduate to stable while ` +
        `\`${labels.prerelease}\` forces a prerelease — remove one. (A graduate label lingers after its package graduates, so it may be a stale leftover.)`,
    );
  }

  let target: string | undefined;
  for (const [labelName, pattern] of Object.entries(scopeLabels)) {
    if (prLabels.includes(labelName)) {
      target = pattern;
      break;
    }
  }

  // Mirrors composeBumpFromLabels, inlined because this path layers its own conflict detection. Graduation is
  // bump-less, so no stale magnitude leaks into { bump, stable }. Deliberate divergence: prerelease alone stays
  // commit-driven (no forced 'prerelease' bump) so commits still pick the magnitude.
  const composedBump = stable ? undefined : bump && prerelease ? (`pre${bump}` as const) : bump;

  // No effect without a target: the engine derives prerequisites from the targeted set.
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
  sync?: boolean;
  bump?: 'major' | 'minor' | 'patch' | 'premajor' | 'preminor' | 'prepatch';
  target?: string;
  stable?: boolean;
  prerelease?: boolean;
  includePrerequisites?: boolean;
  graduate?: string[];
  /** Packages to shift onto a prerelease line; the rest stay on their projected line. */
  prereleaseScope?: string[];
  /** Deselected packages to hold back, matched by exact name. */
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
    prereleaseScope: extras?.prereleaseScope,
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

function setsEqual(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  return a.size === b.size && [...a].every((x) => b.has(x));
}

/**
 * Fails closed: a permission-lookup error (rate limit, network, mis-scoped token) reverts the standing PR to its
 * authoritative manifest state rather than crashing the update.
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
  // The standing PR renders changelogs even when `notes.changelog` is `false`, so that falls back to the defaults too.
  const changelogConfig = releaseKitConfig.notes?.changelog;
  const changelogRefsMode = (changelogConfig ? changelogConfig.refs : undefined) ?? 'link';
  const demoteScopes = (changelogConfig ? changelogConfig.demoteScopes : undefined) ?? DEFAULT_DEMOTE_SCOPES;
  const skipPatterns = releaseKitConfig.release?.ci?.skipPatterns ?? ['chore: release '];

  const bypassSkipGuard = options.reconcile || isStandingPrEventRun();

  if (bypassSkipGuard) {
    info(
      options.reconcile
        ? 'Reconcile mode: bypassing skip-pattern guard'
        : 'Label-triggered run: bypassing skip-pattern guard',
    );
  } else {
    // A release's own commit on HEAD must not trigger an update.
    const headSubject = await getHeadCommitMessage(cwd);
    if (headSubject && matchesSkipPattern(headSubject, skipPatterns)) {
      info(`Skipping standing PR update: commit matches skip pattern`);
      return { action: 'noop' };
    }
  }

  const githubContext = getGitHubContext();

  let existingStandingPr: { number: number; url: string; labels: string[] } | null = null;
  if (githubContext?.token) {
    try {
      existingStandingPr = await forgeFor(githubContext).findStandingPR(branch);
    } catch (err) {
      warn(`Could not look up standing PR for label overrides: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  let existingManifestComment: Awaited<ReturnType<typeof findManifestComment>> = null;
  let existingManifest: StandingPRManifest | undefined;
  if (existingStandingPr && githubContext?.token) {
    try {
      existingManifestComment = await findManifestComment(forgeFor(githubContext), existingStandingPr.number);
      if (existingManifestComment) {
        existingManifest = parseManifest(existingManifestComment.body);
      }
    } catch {
      // Treated as absent: an empty authoritative selection, and firstUpdatedAt restarts.
    }
  }

  // Maintainer ticks and note edits live in the body; read them back so they survive this run's regenerate &
  // force-push.
  let liveBody: string | undefined;
  if (existingStandingPr && githubContext?.token) {
    try {
      liveBody = (await forgeFor(githubContext).getPullRequest(existingStandingPr.number)).body;
    } catch (err) {
      warn(`Could not read current PR body to preserve selection: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  const bodyDeselected = new Set<string>((liveBody && extractSelection(liveBody)?.deselected) || []);
  // Fed to the version write step, not the dry run, so the projected-channel render keeps the marker that round-trips
  // the tick. Reset to the manifest's channels for an unauthorized editor at the write wiring.
  const channelToggleEnabled = standingPrConfig?.channelToggle === true;
  let channelSelection =
    channelToggleEnabled && liveBody ? extractChannelSelection(liveBody) : { prereleased: [], graduated: [] };
  const authz = standingPrConfig?.authorization;
  // Resolved once so the selection gate and the channel-toggle gate share one permission lookup.
  let eventActor: EventActor | undefined;
  let authorizedBodyEdit = false;
  if (authz && existingStandingPr && githubContext?.token) {
    eventActor = getEventActor();
    authorizedBodyEdit =
      eventActor.action === 'edited' && (await authorizedOrWarn(forgeFor(githubContext), eventActor, authz));
  }
  // With an authorization policy the manifest's selection is authoritative: the body is trusted only after an
  // authorized `edited` event, and otherwise the re-render reverts it.
  let priorDeselected = bodyDeselected;
  if (authz && existingStandingPr && githubContext?.token && eventActor && !authorizedBodyEdit) {
    const manifestDeselected = new Set<string>(existingManifest?.deselected ?? []);
    priorDeselected = manifestDeselected;
    if (eventActor.action === 'edited' && !setsEqual(bodyDeselected, manifestDeselected)) {
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

  // GitHub can't restrict who applies a label, so with an authorization policy the manifest's `overrideLabels` are
  // authoritative: an unauthorized label event's release labels are reset to them (other labels kept). Everything
  // below reads `effectiveLabels`, so the bot's own re-apply can't restore the rogue label.
  let effectiveLabels = existingStandingPr?.labels ?? [];
  if (authz && existingStandingPr && githubContext?.token && eventActor) {
    // `authorizedBodyEdit` is false for any non-`edited` trigger, so label events need their own lookup.
    const isLabelEvent = eventActor.action === 'labeled' || eventActor.action === 'unlabeled';
    if (isLabelEvent && !(await authorizedOrWarn(forgeFor(githubContext), eventActor, authz))) {
      const isRelevant = (l: string) => isRelevantOverrideLabel(l, ciConfig);
      const authorizedOverrides = (existingManifest?.overrideLabels ?? []).filter(isRelevant);
      const reconciled = [...new Set([...effectiveLabels.filter((l) => !isRelevant(l)), ...authorizedOverrides])];
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

  // Opt-in so the default path stays LLM-free.
  const previewNotesLabel = (ciConfig?.labels ?? DEFAULT_LABELS).previewNotes;
  const previewNotesEnabled = effectiveLabels.includes(previewNotesLabel);

  const overrides = resolveStandingPrLabelOverrides(effectiveLabels, ciConfig);
  const overrideLabelNames = ciConfig?.labels ?? DEFAULT_LABELS;
  if (overrides.bump) {
    info(`Standing PR label override: bump=${overrides.bump}`);
  }
  if (overrides.target) {
    info(`Standing PR label override: target=${overrides.target}`);
  }
  if (overrides.stable) {
    info(`Standing PR label override: ${overrideLabelNames.graduate}`);
  }
  if (overrides.graduate) {
    info(`Standing PR label override: graduate [${overrides.graduate.join(', ')}]`);
  }
  if (overrides.prerelease) {
    info(`Standing PR label override: ${overrideLabelNames.prerelease}`);
  }
  for (const conflict of overrides.conflicts) {
    warn(conflict);
  }

  const sync = releaseKitConfig.version?.sync ?? false;
  const cliTarget = options.target ?? overrides.target;
  const includePrerequisites = options.includePrerequisites || overrides.withPrerequisites;
  // A sync release moves as one unit, so only the whole-batch graduate applies.
  const graduate = sync ? undefined : overrides.graduate;
  // Conflicting labels drop the overrides (commit-driven); the conflicts still surface in the final status check.
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

  info('Running version analysis (dry run)...');
  const dryRunOptions = buildBaseReleaseOptions(options, true, buildExtras);
  const versionOutputDry = await runVersionStep(dryRunOptions);

  if (versionOutputDry.updates.length === 0) {
    return closeEmptyQueue(existingStandingPr, githubContext);
  }

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

  info(`Resetting release branch '${branch}' to origin/${base}...`);
  await resetReleaseBranch(branch, base, cwd);
  const baseSha = await getHeadSha(cwd);

  // A release merge can land on `base` mid-run; the reset pulls in its untagged version bump, and recomputing from it
  // would double-bump (package.json ahead of the last tag under `mismatchStrategy: prefer-package`). Bow out and let
  // the post-release reconcile rebuild the PR once the release has tagged.
  if (!options.reconcile) {
    const resetHeadSubject = await getHeadCommitMessage(cwd);
    if (resetHeadSubject && matchesSkipPattern(resetHeadSubject, skipPatterns)) {
      info('Skipping standing PR update: a release commit landed on the base branch during this run');
      return { action: 'noop' };
    }
  }

  const dryUpdates = publishableUpdates(versionOutputDry);
  const groups = releaseKitConfig.version?.groups ?? {};
  const changedNames = new Set(dryUpdates.map((u) => u.packageName));
  const primaryPackages = standingPrConfig?.primaryPackages ?? [];
  const selectionMode = standingPrConfig?.selection ?? 'streamlined';
  let primaryConfig: PrimaryConfig | undefined;
  // Resolving primaries, including ones not bumping this run, needs the full workspace package list, so load it
  // only when the feature is on.
  if (primaryPackages.length > 0 && versionOutputDry.strategy !== 'sync') {
    const { getWorkspacePackageNames } = await import('@releasekit/version');
    const allPackageNames = await getWorkspacePackageNames({ cwd, configPath: options.config });
    primaryConfig = { primaryPackages, selection: selectionMode, groups, allPackageNames };
    for (const w of validatePrimaryPackages(primaryPackages, allPackageNames, releaseKitConfig.version?.skip ?? [])) {
      warn(`Selection: ${w}`);
    }
  }

  const effectiveDeselected = new Set<string>();
  // A residual selection region (e.g. from before the repo switched to sync) must not narrow a sync release.
  if (versionOutputDry.strategy !== 'sync') {
    if (primaryConfig && primaryConfig.selection !== 'granular') {
      // A held-back primary cascades to its whole closure (reference-counted: a shared child releases while any
      // owner does), so groups are never split and the lockstep guard below doesn't apply.
      const hierarchy = computeHierarchy(dryUpdates, primaryConfig);
      for (const name of cascadeDeselection(hierarchy, new Set(priorDeselected))) {
        effectiveDeselected.add(name);
      }
    } else {
      // A lockstep (fixed/linked) member's untick is ignored, so its row re-renders ticked.
      for (const name of priorDeselected) {
        if (!changedNames.has(name)) {
          continue;
        }
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

  // A channel shift must move the package's whole group; independent groups put each member on its own prerelease
  // line, fixed/linked share one.
  const expandToGroup = (names: string[]): string[] => {
    const out = new Set<string>();
    for (const name of names) {
      out.add(name);
      const grp = dryUpdates.find((u) => u.packageName === name)?.group;
      if (grp) {
        for (const u of dryUpdates) {
          if (u.group === grp) {
            out.add(u.packageName);
          }
        }
      }
    }
    return [...out];
  };

  // As with the selection gate, only an authorized edit may change channels; otherwise reset to the manifest's.
  // The manifest stores group-expanded sets but the body holds raw ticks, so expand the body before comparing or
  // untoggled group-mates misfire the notice.
  if (
    channelToggleEnabled &&
    authz &&
    existingStandingPr &&
    githubContext?.token &&
    eventActor &&
    !authorizedBodyEdit
  ) {
    const manifestPrereleased = existingManifest?.prereleased ?? [];
    const manifestGraduated = existingManifest?.graduated ?? [];
    const bodyPrereleased = new Set(expandToGroup(channelSelection.prereleased));
    const bodyGraduated = new Set(expandToGroup(channelSelection.graduated));
    // Graduation also comes from `graduate:*` labels that never appear as body toggles, so only added graduate
    // toggles count (a strict compare would misfire on a label-only graduation). This only gates the notice.
    const prereleaseChanged = !setsEqual(bodyPrereleased, new Set(manifestPrereleased));
    const graduateAdded = [...bodyGraduated].some((name) => !manifestGraduated.includes(name));
    channelSelection = { prereleased: manifestPrereleased, graduated: manifestGraduated };
    if (eventActor.action === 'edited' && (prereleaseChanged || graduateAdded)) {
      const allowClause = authz.allowedActors?.length ? ', or an allow-listed actor' : '';
      await forgeFor(githubContext)
        .upsertMarkerComment(
          existingStandingPr.number,
          CHANNEL_DENIED_MARKER,
          `${CHANNEL_DENIED_MARKER}\n\n> ⚠️ **Channel change ignored.** Only authorized maintainers (\`${authz.requiredPermission}\`+${allowClause}) can move a package between the stable and prerelease channels. The per-row channel toggles have been reset to the approved selection.`,
        )
        .catch((err) =>
          warn(`Could not post channel-denied notice: ${err instanceof Error ? err.message : String(err)}`),
        );
    }
  }

  const channelPrereleased = channelSelection.prereleased.filter((n) => !effectiveDeselected.has(n));
  const channelGraduated = channelSelection.graduated.filter((n) => !effectiveDeselected.has(n));
  const writePrereleaseScope = expandToGroup(channelPrereleased);
  const graduateTargets = [...new Set([...(buildExtras.graduate ?? []), ...expandToGroup(channelGraduated)])];
  // Targets can be globs (`graduate:@scope/*`); expand them so the conflict check drops only the packages a
  // prerelease toggle also names, not the whole glob.
  const graduateAll = dryUpdates
    .map((u) => u.packageName)
    .filter((name) => shouldMatchPackageTargets(name, graduateTargets));
  const { graduate: writeGraduate, conflicts: channelConflicts } = resolveChannelConflicts(
    graduateAll,
    writePrereleaseScope,
  );
  if (channelConflicts.length > 0) {
    warn(
      `Selection: ${channelConflicts.map((name) => `\`${name}\``).join(', ')} set to prerelease and graduate at ` +
        'once — the prerelease toggle wins; remove the graduate label to graduate to stable instead.',
    );
  }

  // Held-back packages are excluded, not just unticked, so no untagged orphan bump lands on base.
  info('Writing version bumps...');
  const writeOptions = buildBaseReleaseOptions(options, false, {
    ...buildExtras,
    exclude: [...effectiveDeselected],
    graduate: writeGraduate.length > 0 ? writeGraduate : undefined,
    prereleaseScope: writePrereleaseScope.length > 0 ? writePrereleaseScope : undefined,
  });
  const versionOutput = await runVersionStep(writeOptions);

  // The write can come back empty when a release landed on `base` mid-run (a reconcile race the skip-pattern bail
  // exempts), which would render a degenerate body. Publishable-only so a sync root-only bump is caught too.
  if (publishableUpdates(versionOutput).length === 0) {
    return closeEmptyQueue(existingStandingPr, githubContext);
  }

  const previewPackages = publishableUpdates(versionOutput).map((u) => u.packageName);
  let editedNotes: Record<string, string> = {};
  if (previewNotesEnabled && liveBody) {
    editedNotes = extractNotesRegions(liveBody, previewPackages);
  }

  // Notes are seeded once when the label is applied, then preserved, so skip the LLM when every package has a region.
  info('Generating changelog...');
  const allPackagesHaveRegions = previewPackages.length > 0 && previewPackages.every((p) => p in editedNotes);
  const generateReleaseNotes = previewNotesEnabled && !allPackagesHaveRegions;
  const notesOptions = { ...writeOptions, skipNotes: false, skipReleaseNotes: !generateReleaseNotes };
  const notesResult = await runNotesStep(versionOutput, notesOptions);

  const countableUpdates = publishableUpdates(versionOutput);
  const count = countableUpdates.length;
  const firstUpdate = countableUpdates[0];
  const isSync = versionOutput.strategy === 'sync';
  /* biome-ignore lint/suspicious/noTemplateCurlyInString: template string uses config variable */
  const defaultTitle = isSync ? 'chore: release ${tag}' : 'chore: release ${count} package(s)';
  const titleTemplate = standingPrConfig?.title ?? defaultTitle;
  const renderedTitle = titleTemplate
    .replace(/\$\{count\}/g, String(count))
    .replace(/\$\{version\}/g, firstUpdate?.newVersion ?? '')
    .replace(/\$\{tag\}/g, syncVersionDisplay(versionOutput));

  // The title doubles as the commit subject, because GitHub squashes a single-commit PR under the commit's subject.
  // The merge on main inherits it, so it must match a skip pattern, or the merge triggers another update, and carry
  // no CI-skip marker, or the merge skips the publish.
  const titleIsSafe = matchesSkipPattern(renderedTitle, skipPatterns) && !CI_SKIP_MARKER.test(renderedTitle);
  const title = titleIsSafe ? renderedTitle : 'chore: release preparation';
  if (!titleIsSafe) {
    warn(
      `Standing PR title '${renderedTitle}' must match release.ci.skipPatterns and carry no CI-skip marker; using '${title}'`,
    );
  }
  info(`Committing and pushing '${branch}'...`);
  await commitAndForcePush(branch, title, cwd);

  const releaseBranchSha = await getHeadSha(cwd);

  success(`Release branch '${branch}' updated`);

  if (!githubContext?.token) {
    warn('No GitHub context available — skipping PR creation');
    return { action: 'noop', versionOutput };
  }

  const forge = forgeFor(githubContext);

  const labels = standingPrConfig?.labels ?? ['release'];

  const existing = existingStandingPr;

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

  // Accepted race: a human edit landing between the body read above and the update below is overwritten; updates
  // are infrequent enough not to warrant optimistic concurrency.
  let notesRegion: string | undefined;
  if (previewNotesEnabled) {
    const merged = mergeNotesRegions(notesResult.releaseNotes ?? {}, editedNotes);
    if (Object.keys(merged).length > 0) {
      notesRegion = renderNotesRegion(merged);
    }
  }

  // Rendered from the dry run's full changed set so a held-back package still shows as an unticked row with its
  // changelog; the write output omits held-back packages entirely.
  let renderSelectionBlock: ((withChangelogs: boolean) => string) | undefined;
  if (versionOutputDry.strategy !== 'sync') {
    const warnings = selectionWarnings(dryUpdates, effectiveDeselected, groups);
    for (const w of warnings) {
      warn(`Selection: ${w.reason}`);
    }
    const warningSuffix = warnings.length > 0 ? `\n\n${warnings.map((w) => `> ⚠️ ${w.reason}`).join('\n')}` : '';
    const rowChangelog = makeRowChangelogRenderer(versionOutputDry.changelogs, changelogRefsMode, demoteScopes);
    const channelToggle: ChannelToggleConfig | undefined = channelToggleEnabled
      ? {
          prereleased: new Set(channelSelection.prereleased),
          graduated: new Set(channelSelection.graduated),
          prereleaseIdentifier: releaseKitConfig.version?.prereleaseIdentifier ?? 'next',
        }
      : undefined;
    renderSelectionBlock = (withChangelogs) =>
      renderSelectionRegion(
        dryUpdates,
        effectiveDeselected,
        primaryConfig,
        withChangelogs ? rowChangelog : undefined,
        channelToggle,
      ) + warningSuffix;
  }

  // From the write output, so it mirrors what publishes. The toggle only removes redundancy, never data: sync has no
  // per-row changelogs so always gets the footer, and non-sync keeps shared entries, which have no per-row home.
  const footerEnabled = standingPrConfig?.combinedChangelogFooter !== false;
  const footer =
    footerEnabled || versionOutput.strategy === 'sync'
      ? renderCombinedFooter(versionOutput, { refs: changelogRefsMode, demoteScopes })
      : renderCombinedFooter(versionOutput, { sharedOnly: true, refs: changelogRefsMode, demoteScopes });

  let summaryLine: string | undefined;
  let summaryTable: string | undefined;
  if (versionOutput.strategy !== 'sync') {
    const heldBackCount = Math.max(0, dryUpdates.length - publishableUpdates(versionOutput).length);
    summaryLine = renderReleaseSummaryLine(versionOutput, { heldBackCount });
    if (standingPrConfig?.summaryTable) {
      summaryTable = renderVersionSummaryTable(versionOutput);
    }
  }

  const body = renderPrBody(versionOutput, {
    supersedeWarning,
    notesRegion,
    renderSelectionBlock,
    footer,
    summaryLine,
    summaryTable,
  });

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

  try {
    // A label must exist before a maintainer can apply it, so seed `graduate:<package>` for each prerelease package.
    await syncLabels(forge, deriveLabelDefinitions(ciConfig, prereleasePackageNames(versionOutput)));
  } catch (err) {
    warn(`Could not ensure ReleaseKit labels exist: ${err instanceof Error ? err.message : String(err)}`);
  }

  // A union so maintainer overrides survive the update. `effectiveLabels`, not the raw labels, so a reconciled-out
  // rogue label is removed rather than re-added.
  const labelsReconciled = !setsEqual(new Set(effectiveLabels), new Set(existingStandingPr?.labels ?? []));
  if (labels.length > 0 || labelsReconciled) {
    try {
      const mergedLabels = [...new Set([...effectiveLabels, ...labels])];
      await forge.setLabels(prNumber, mergedLabels);
    } catch {
      warn('Failed to apply labels to standing PR');
    }
  }

  let firstUpdatedAt = new Date().toISOString();
  if (existingManifest) {
    firstUpdatedAt = existingManifest.firstUpdatedAt ?? existingManifest.createdAt;
  }

  const graduatedPackages = graduatedPackageNames(versionOutput);

  const manifest: StandingPRManifest = {
    schemaVersion: 2,
    versionOutput,
    // Publish regenerates notes against the merged commit set; caching them here would only risk drift.
    releaseNotes: {},
    notesFiles: notesResult.files,
    createdAt: new Date().toISOString(),
    baseSha,
    firstUpdatedAt,
    overrideLabels: extractOverrideLabels(effectiveLabels, ciConfig),
    deselected: effectiveDeselected.size > 0 ? [...effectiveDeselected].sort() : undefined,
    graduated: graduatedPackages.length > 0 ? graduatedPackages : undefined,
    prereleased: writePrereleaseScope.length > 0 ? [...writePrereleaseScope].sort() : undefined,
  };

  const manifestBody = serializeManifest(manifest);
  if (existingManifestComment) {
    await forge.updateComment(existingManifestComment.id, manifestBody);
  } else {
    await forge.createComment(prNumber, manifestBody);
  }
  success(`Manifest written to PR #${prNumber}`);

  const minAge = standingPrConfig?.minAge;
  let statusState: 'success' | 'pending' = 'success';
  let statusDescription = 'Ready to merge';

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

/**
 * The manifest's versions and tags are never trusted verbatim: the merged commit's package manifests are the ground
 * truth, and any divergence rejects the whole manifest before any tag or registry write.
 */
async function assertManifestMatchesSource(
  manifest: StandingPRManifest,
  cwd: string,
  configPath: string | undefined,
  prNumber: number,
): Promise<void> {
  const { getWorkspacePackageVersions } = await import('@releasekit/version');
  const onDisk = await getWorkspacePackageVersions({ cwd, configPath });
  const publishable = publishableUpdates(manifest.versionOutput);

  const validatedVersions: string[] = [];
  for (const update of publishable) {
    const actual = onDisk[update.packageName];
    if (actual === undefined) {
      throw new Error(
        `Refusing to publish PR #${prNumber}: the release manifest lists package '${update.packageName}', which is ` +
          `not in the workspace at the merged commit. The manifest does not match the source — it may have been ` +
          `edited. Re-run 'standing-pr update' to regenerate it.`,
      );
    }
    if (actual !== update.newVersion) {
      throw new Error(
        `Refusing to publish PR #${prNumber}: the release manifest claims '${update.packageName}@${update.newVersion}', ` +
          `but the merged source has '${update.packageName}@${actual}'. The manifest does not match what was merged — ` +
          `it may have been edited. Re-run 'standing-pr update' to regenerate it.`,
      );
    }
    validatedVersions.push(update.newVersion);
  }

  // Baseline tags are pushed alongside consumer tags, so both must carry a validated version. Deliberately runs even
  // when `validatedVersions` is empty: a legitimate manifest then has no tags, so every tag is rejected.
  for (const tag of [...manifest.versionOutput.tags, ...(manifest.versionOutput.baselineTags ?? [])]) {
    // Bounded by anything but a digit, dot or prerelease/build separator (`-`/`+`), or a rogue tag like `v1.2.30`,
    // `v11.2.3` or `v1.2.3-evil` passes for a validated `1.2.3`.
    const carriesValidatedVersion = validatedVersions.some((version) => {
      const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return new RegExp(`(?<![\\d.])${escaped}(?![\\d.+-])`).test(tag);
    });
    if (!carriesValidatedVersion) {
      throw new Error(
        `Refusing to publish PR #${prNumber}: the release manifest lists tag '${tag}', which does not correspond to ` +
          `any package/version being published. The manifest does not match the source — it may have been edited. ` +
          `Re-run 'standing-pr update' to regenerate it.`,
      );
    }
    // A forged `@scope/evil@v1.2.3` at a real published version passes the version check, so a scoped tag must also
    // name a published package. Bare and unscoped tags have no reliably delimitable name.
    const scopedPackage = /@[^\s@/]+\/[^\s@]+?(?=@)/.exec(tag)?.[0];
    if (scopedPackage && !publishable.some((u) => u.packageName === scopedPackage)) {
      throw new Error(
        `Refusing to publish PR #${prNumber}: the release manifest lists tag '${tag}', whose package ` +
          `'${scopedPackage}' is not among the packages being published. The manifest does not match the source — ` +
          `it may have been edited. Re-run 'standing-pr update' to regenerate it.`,
      );
    }
  }
}

/**
 * Every failure throws: once a PR is named there is no "nothing to do" outcome, so a returned result means the
 * publish ran.
 */
export async function publishFromManifest(prNumber: number, options: StandingPROptions): Promise<ReleaseOutput> {
  const cwd = options.projectDir;

  const githubContext = getGitHubContext();
  if (!githubContext?.token) {
    throw new Error(
      `No GitHub context (GITHUB_REPOSITORY or GITHUB_TOKEN) available — cannot read the release manifest from ` +
        `PR #${prNumber}.`,
    );
  }

  const forge = forgeFor(githubContext);

  const releaseKitConfig = loadReleaseKitConfig({ cwd, configPath: options.config });
  const standingPrConfig = releaseKitConfig.ci?.standingPr;
  const releaseBranch = standingPrConfig?.branch ?? 'release/next';
  const deleteBranchOnMerge = standingPrConfig?.deleteBranchOnMerge !== false;

  const manifestComment = await findManifestComment(forge, prNumber);
  if (!manifestComment) {
    throw new Error(`Release manifest not found on PR #${prNumber}. Re-run 'standing-pr update' to regenerate.`);
  }

  // `findComment` prefers a bot-authored match but falls back to a human comment carrying the marker; refuse that.
  if (!isBotComment(manifestComment)) {
    throw new Error(
      `Refusing to publish PR #${prNumber}: the release manifest comment was authored by ` +
        `'${manifestComment.user?.login ?? 'an unknown user'}', not the release bot. A manifest that did not come ` +
        `from 'standing-pr update' cannot be trusted. Re-run 'standing-pr update' to regenerate it.`,
    );
  }

  let manifest: StandingPRManifest;
  try {
    manifest = parseManifest(manifestComment.body);
  } catch (err) {
    throw new Error(
      `Release manifest on PR #${prNumber} is invalid or incompatible. Re-run 'standing-pr update'. Details: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // Defense in depth behind the branch-protection ruleset, catching a missing or misconfigured one. Fails open on an
  // unverifiable check since the ruleset already gated the merge.
  const authz = standingPrConfig?.authorization;
  if (authz?.enforceMergeAuthor) {
    const actor = getEventActor();
    if (!actor.mergedBy) {
      // e.g. a dispatch publish or an inferred PR.
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

  // A `baseSha` that isn't an ancestor of HEAD means the manifest describes work not on this branch (rewritten
  // history, wrong branch or a forged baseSha).
  const currentSha = await getHeadSha(cwd);
  if (!(await createGitCli().isAncestor(manifest.baseSha, currentSha, cwd))) {
    throw new Error(
      `Refusing to publish PR #${prNumber}: the manifest's baseSha (${manifest.baseSha}) is not an ancestor of ` +
        `HEAD (${currentSha}). The manifest was computed against a commit that is not in this branch's history ` +
        `(the history may have been rewritten). Re-run 'standing-pr update' to regenerate it, then merge again.`,
    );
  }

  await assertManifestMatchesSource(manifest, cwd, options.config, prNumber);

  info(`Publishing from manifest: ${publishableUpdates(manifest.versionOutput).length} package(s)`);

  // Generated here rather than in the update so the standing-PR workflow needn't depend on LLM availability.
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

  let livePr: PullRequestDetails | undefined;
  try {
    livePr = await forge.getPullRequest(prNumber);
  } catch (err) {
    warn(`Could not read PR #${prNumber}: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Refuse a manifest whose override labels diverge from the merged PR's (a label changed, then merged before the
  // update re-ran). Fails closed when the PR is unreadable, except for an empty override set: the only possible
  // change is an added label, not worth failing the common no-override publish on an API blip.
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

  // From the body, not the manifest: the manifest holds machine state only.
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
    // Changelogs are already on main from the merge; only new per-version notes files need committing.
    const newFiles = notesResult.files.filter((f) => !manifest.notesFiles.includes(f));
    notesFiles = [...notesFiles, ...newFiles];

    // So main matches the GitHub release body.
    if (newFiles.length > 0) {
      await commitNotesFiles(newFiles, manifest.versionOutput, cwd);
    }
  } catch (err) {
    warn(`Release notes generation failed: ${err instanceof Error ? err.message : String(err)}`);
    warn('Publish will proceed with empty release notes; GitHub release will use auto-generated notes.');
  }

  // Outside the try so edited notes survive a regeneration failure.
  if (Object.keys(editedNotes).length > 0) {
    releaseNotes = { ...releaseNotes, ...editedNotes };
    info(`Using human-edited release notes for ${Object.keys(editedNotes).length} package(s) from the PR body.`);
  }

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
    // Versions are already on main (roll-forward), so report what landed and how to retry. A reporting failure must
    // never mask the pipeline error.
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

  // Also clears the supersede warning the next standing PR would otherwise show.
  await resolveFailureReportIfPresent(forge, prNumber, manifest.versionOutput);

  // Publishing moved `main`, so open feeder PRs' previews are stale.
  await refreshFeederPreviews({ config: options.config, projectDir: cwd });

  if (deleteBranchOnMerge) {
    await deleteReleaseBranch(releaseBranch, cwd);
  }

  return {
    versionOutput: manifest.versionOutput,
    // The LLM call may have failed and left the notes empty.
    notesGenerated: Object.keys(releaseNotes).length > 0,
    releaseNotes,
    publishOutput,
  };
}

/**
 * Inference fallback for dispatch publishes. Explicit `--pr` is preferred: a re-run of a stale dispatch can land
 * after a newer standing PR has merged.
 */
export async function findLatestMergedStandingPR(forge: Forge, branch: string): Promise<number | null> {
  const prs = await forge.listRecentlyClosedPullRequests(branch, 10);

  // 'updated' ordering only guarantees the newest merge is in the page; late activity on an older merged PR can
  // sort it above a newer merge, so pick by mergedAt.
  const merged = prs
    .filter((pr) => pr.mergedAt != null)
    .sort((a, b) => new Date(b.mergedAt as string).getTime() - new Date(a.mergedAt as string).getTime());
  return merged[0]?.number ?? null;
}

/**
 * `null` means nothing to do (the caller reports success); anything that went wrong throws so a misconfiguration
 * can't read as a successful no-op. `pull_request: closed` fires for every closed PR, so non-release PRs must stay
 * quiet no-ops.
 */
export async function runStandingPRPublish(
  options: StandingPROptions,
  explicitPrNumber?: number,
): Promise<ReleaseOutput | null> {
  if (explicitPrNumber !== undefined) {
    return publishFromManifest(explicitPrNumber, options);
  }

  const cwd = options.projectDir;

  const releaseKitConfig = loadReleaseKitConfig({ cwd, configPath: options.config });
  const standingPrConfig = releaseKitConfig.ci?.standingPr;
  const releaseBranch = standingPrConfig?.branch ?? 'release/next';

  const eventPath = process.env.GITHUB_EVENT_PATH;
  let event: { pull_request?: { head?: { ref?: string }; number?: number; merged?: boolean } } | undefined;
  if (eventPath) {
    try {
      event = JSON.parse(fs.readFileSync(eventPath, 'utf-8'));
    } catch (err) {
      throw new Error(
        `Failed to read the GitHub event at ${eventPath}: ${err instanceof Error ? err.message : String(err)}. ` +
          `The event payload decides which PR to publish — pass --pr explicitly to bypass it.`,
      );
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
      throw new Error(
        `Could not determine the PR number from the GitHub event: its pull_request payload matched release branch ` +
          `'${releaseBranch}' and is merged, but carries no number. Pass --pr explicitly.`,
      );
    }

    return publishFromManifest(prNumber, options);
  }

  const githubContext = getGitHubContext();
  if (!githubContext?.token) {
    throw new Error(
      'No GitHub context (GITHUB_REPOSITORY or GITHUB_TOKEN) available, so the merged standing PR cannot be ' +
        'inferred — pass --pr explicitly.',
    );
  }

  const inferred = await findLatestMergedStandingPR(forgeFor(githubContext), releaseBranch);
  if (inferred === null) {
    throw new Error(`No merged standing release PR found for branch '${releaseBranch}' — pass --pr explicitly.`);
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
      // The forge surfaces the raw error, so a non-GitHub adapter yields 'unknown reason'.
      const reason =
        (err as { response?: { data?: { message?: string } } }).response?.data?.message ?? 'unknown reason';
      throw new Error(`Cannot merge standing PR #${pr.number}: GitHub rejected the merge (${reason})`);
    }
    throw err;
  }
  success(`Standing PR #${pr.number} merged`);

  // When publishing, publishFromManifest deletes it.
  if (!flags.publish && deleteBranchOnMerge) {
    await deleteReleaseBranch(branch, cwd);
  }

  if (!flags.publish) {
    return null;
  }

  return publishFromManifest(pr.number, options);
}
