import {
  type CIConfig,
  configuredRefsMode,
  loadConfig as loadReleaseKitConfig,
  runFormatCommand,
} from '@releasekit/config';
import type { VersionChangelogEntry, VersionOutput, VersionPackageUpdate } from '@releasekit/core';
import { deriveReleaseChannel, info, markerData, shouldMatchPackageTargets, success, warn } from '@releasekit/core';
import {
  VersionChangelogEntrySchema,
  VersionOutputSchema,
  VersionPackageChangelogSchema,
} from '@releasekit/core/version-output-schema';
import {
  type AuthoredBody,
  type CommentAuthor,
  type Forge,
  forgeErrorStatus,
  isBotComment,
  type StandingPullRequest,
} from '@releasekit/forge';
import { createGitCli, isCommitSha } from '@releasekit/git';
import { PipelineError } from '@releasekit/publish';
import { z } from 'zod';
import { ATTRIBUTION_FOOTER } from '../attribution.js';
import { formatDuration, parseDuration } from '../duration.js';
import { renderSupersedeWarning } from '../failure-report/failure-report.js';
import { detectUnresolvedFailure, postFailureReport, resolveFailureReportIfPresent } from '../failure-report/post.js';
import { getHeadCommitMessage, matchesSkipPattern, requireGitHubContext } from '../git.js';
import { findMergedPRsForCommit, forgeFor } from '../github.js';
import { readGitHubEvent } from '../github-event.js';
import { deriveLabelDefinitions, syncLabels } from '../label-definitions.js';
import { DEFAULT_LABELS, graduatedPackageFromLabel, isGraduatePackageLabel } from '../label-utils.js';
import { markFeederPreviewsStale } from '../preview/stale.js';
import { authorizePublish, findTrustedManifest } from '../publish-authorization.js';
import { type NotesStepResult, runNotesStep, runPublishStep, runVersionStep } from '../steps.js';
import { findTrustedComment, type TrustedCommentLookup } from '../trusted-comment.js';
import type { ReleaseOptions, ReleaseOutput } from '../types.js';
import { publishableUpdates, syncVersionDisplay } from '../version-display.js';
import { isAuthorizedActor, type StandingPrAuthorization } from './authorization.js';
import { makeRowChangelogRenderer, renderCombinedFooter } from './changelog-region.js';
import { graduationOvershoot, lockstepGroupOf } from './graduation.js';
import { extractNotesRegions, notesRegionKeys, renderNotesRegion } from './notes-region.js';
import {
  type NotesRegionStates,
  normalizeRegionText,
  notesRegionState,
  planNotesRegions,
  publishableNotesRegions,
  releaseNotesInputHashes,
} from './notes-state.js';
import { ProgressBanner } from './progress-banner.js';
import {
  type ChannelSelection,
  type ChannelToggleConfig,
  cascadeDeselection,
  computeHierarchy,
  extractChannelSelection,
  extractSelection,
  extractSyncGraduation,
  type GraduationRowsConfig,
  type PrimaryConfig,
  renderSelectionRegion,
  renderSyncGraduation,
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
          files: z.array(z.string()).optional(),
        })
        .passthrough(),
    ),
    changelogs: z.array(
      VersionPackageChangelogSchema.extend({
        sharedPackageEntryRefs: z.array(z.number().int().nonnegative()).optional(),
      }),
    ),
    sharedEntries: VersionOutputSchema.shape.sharedEntries,
    bundledReleases: VersionOutputSchema.shape.bundledReleases,
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
    headSha: z.string().optional(),
    firstUpdatedAt: z.string().optional(),
    overrideLabels: z.array(z.string()).optional(),
    deselected: z.array(z.string()).optional(),
    graduated: z.array(z.string()).optional(),
    graduationRows: z.array(z.string()).optional(),
    graduationHolds: z.array(z.string()).optional(),
    prereleased: z.array(z.string()).optional(),
    notesRegions: z
      .record(
        z.string(),
        z.object({ inputHash: z.string(), renderedHash: z.string(), truncated: z.boolean().optional() }),
      )
      .optional(),
    sharedPackageEntryPool: z.array(VersionChangelogEntrySchema).optional(),
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
   * Post-release reconcile: bypass the skip-pattern guard, since HEAD is by definition a release commit matching the
   * skip pattern, and analyse `origin/<base>` rather than the job's checkout.
   */
  reconcile?: boolean;
  /** Ad-hoc CLI override: release only these comma-split package patterns (supplements label overrides). */
  target?: string;
  /** Ad-hoc CLI override: also release the changed prerequisites (and group members) of the targets. */
  includePrerequisites?: boolean;
  /** Show an in-progress banner on the standing PR while a label or body edit's, or a dispatch's, update runs. */
  ack?: boolean;
}

export interface StandingPRResult {
  action: 'created' | 'updated' | 'closed' | 'noop';
  /** Why the update waited for a release still publishing. */
  reason?: string;
  prNumber?: number;
  prUrl?: string;
  versionOutput?: VersionOutput;
}

export interface StandingPRMergeOutput {
  merged: true;
  prNumber: number;
}

export type StandingPRMergeResult = StandingPRMergeOutput | null;

/** Old manifests live in open PRs: fields added after v1 must stay optional and be tolerated when absent. */
export interface StandingPRManifest {
  schemaVersion: 1 | 2;
  versionOutput: VersionOutput;
  releaseNotes: Record<string, string>;
  notesFiles: string[];
  createdAt: string;
  baseSha: string;
  /** The release-branch commit this manifest describes, so a merge can be pinned to it. */
  headSha?: string;
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
  /** The `graduated` packages ticked as graduation rows: approved without changes, so the tick lapses once they have some. */
  graduationRows?: string[];
  /** Why a graduation can't merge yet, for the feeder previews' snapshot, which can't recompute it. */
  graduationHolds?: string[];
  /**
   * Packages (and their groups) shifted onto a prerelease line by the per-row channel toggle. Provenance & round-trip
   * only - `versionOutput` already holds the prerelease versions.
   */
  prereleased?: string[];
  /** A key without state is treated as edited. */
  notesRegions?: NotesRegionStates;
}

async function getHeadSha(cwd: string): Promise<string> {
  try {
    return await createGitCli().headSha(cwd);
  } catch (err) {
    throw new Error(`Failed to get HEAD SHA: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * True when a maintainer's label or body edit on the standing PR triggered this run, or a dispatch asked for it (the
 * example workflow relays those edits as one), so the checked-out commit's subject says nothing about it. Read from
 * the event (not a flag) so it works from the action, the reusable workflow or the CLI. An `edited` re-trigger is
 * safe: the body re-render is idempotent and the workflow guards out the bot's own edits.
 */
function isStandingPrEventRun(): boolean {
  if (process.env.GITHUB_EVENT_NAME === 'workflow_dispatch') {
    return true;
  }
  if (process.env.GITHUB_EVENT_NAME !== 'pull_request') {
    return false;
  }
  const action = readGitHubEvent<{ action?: string }>()?.action;
  return action === 'labeled' || action === 'unlabeled' || action === 'edited';
}

async function resetReleaseBranch(branch: string, base: string, cwd: string): Promise<void> {
  const git = createGitCli();
  // Prune so a release branch deleted on the remote doesn't leave a stale tracking ref that fails the push's lease.
  // Fetch tags too: the version analysis reads local tags, and a plain fetch skips a standing PR's tags when they sit
  // on a notes commit off the base branch.
  await git.fetch('origin', { prune: true, tags: true, cwd });

  // `checkout -B` creates or resets the branch, so this works whether or not it already exists.
  await git.checkout(branch, { create: true, cwd });
  await git.resetHard(`origin/${base}`, cwd);
}

const CI_SKIP_MARKER = /\[(?:skip ci|ci skip|no ci|skip actions|actions skip)\]/i;
const FALLBACK_TITLE = 'chore: release preparation';

// The squash merge on main takes the standing PR's title, from the PR or the commit depending on the repo's settings.
function safeStandingPrTitle(rendered: string, skipPatterns: string[]): string {
  let title = rendered;
  if (CI_SKIP_MARKER.test(title)) {
    warn(
      `Standing PR title '${title}' carries a CI-skip marker, which would skip the publish; using '${FALLBACK_TITLE}'`,
    );
    title = FALLBACK_TITLE;
  }
  if (matchesSkipPattern(title, skipPatterns)) {
    return title;
  }
  if (title !== FALLBACK_TITLE && matchesSkipPattern(FALLBACK_TITLE, skipPatterns)) {
    warn(`Standing PR title '${title}' matches no release.ci.skipPatterns entry; using '${FALLBACK_TITLE}'`);
    return FALLBACK_TITLE;
  }
  warn(`No release.ci.skipPatterns entry matches '${title}', so merging the standing PR triggers another update`);
  return title;
}

async function commitAndForcePush(
  branch: string,
  subject: string,
  cwd: string,
  skipHooks: boolean,
  formatCommand: string | undefined,
  allowEmpty: boolean,
): Promise<void> {
  const git = createGitCli();
  if (formatCommand) {
    // The branch was just reset to the base, so every change is a file this update wrote.
    await runFormatCommand(formatCommand, await git.lsFiles({ changed: true, cwd }), cwd);
  }
  await git.addAll(cwd);

  const status = (await git.status({ porcelain: true, cwd })).trim();
  if (status || allowEmpty) {
    await git.commit(subject, { cwd, skipHooks, allowEmpty });
  }

  await git.push({ remote: 'origin', ref: branch, forceWithLease: true, cwd });
}

/**
 * Standing-PR publish sets `skipGitCommit: true` to avoid duplicating the squash-merge commit, which also skips the
 * pipeline's tag creation. Mirrors `runGitCommitStage`'s idempotency (packages/publish/src/stages/git-commit.ts).
 * Never throws: the pipeline's `--tags` push publishes whatever tags were created.
 *
 * Tags `mergeSha`, the release's commit on the base branch, when HEAD contains it: a publish from a later push's
 * checkout would otherwise mark the commits after the release as released.
 */
export async function createReleaseTags(tags: string[], cwd: string, mergeSha?: string): Promise<void> {
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
  const commit =
    mergeSha && mergeSha !== headSha && (await git.isAncestor(mergeSha, headSha, cwd)) ? mergeSha : undefined;
  const target = commit ?? headSha;
  const at = commit ? 'the release commit' : 'HEAD';

  for (const tag of tags) {
    if (await git.refExists(`refs/tags/${tag}`, cwd)) {
      let existing = '';
      try {
        existing = (await git.log({ range: tag, format: '%H', extraArgs: ['-1'], cwd })).trim();
      } catch {
        // Unresolvable: fall through to the warn below.
      }
      if (existing === target) {
        info(`Tag ${tag} already exists at ${at}, skipping`);
        continue;
      }
      warn(`Tag ${tag} exists at ${existing} but ${at} is ${target} — skipping (re-tag manually if intended)`);
      continue;
    }

    try {
      await git.tag(tag, { message: `Release ${tag}`, commit, cwd });
      success(`Created tag: ${tag}`);
    } catch (err) {
      warn(`Failed to create tag ${tag}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

async function deleteReleaseBranch(releaseBranch: string, cwd: string, expectedTipSha: string): Promise<void> {
  try {
    // The `:<branch>` delete refspec, since the git seam's leading-`-` option guard rejects `--delete`. The lease
    // makes the remote refuse the delete if an update has force-pushed the branch since the merge.
    await createGitCli().push({
      remote: 'origin',
      ref: `:${releaseBranch}`,
      forceWithLease: { ref: releaseBranch, expect: expectedTipSha },
      cwd,
    });
    info(`Deleted release branch '${releaseBranch}'`);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    // `stale info` when git sees the move before pushing; the others when the remote refuses it mid-update.
    if (/stale info|cannot lock ref .*but expected|incorrect old value provided/.test(errorMsg)) {
      info(`Kept release branch '${releaseBranch}': it has moved since the merge.`);
    } else if (errorMsg.includes('not found') || errorMsg.includes('does not exist')) {
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
  /** A sync release's own graduation checkbox, in place of the selection region's rows. */
  syncGraduation?: string;
  footer: string;
  summaryLine?: string;
  summaryTable?: string;
}

function renderPrBody(versionOutput: VersionOutput, options: RenderPrBodyOptions): string {
  const { supersedeWarning, notesRegion, renderSelectionBlock, syncGraduation, footer, summaryLine, summaryTable } =
    options;

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
    } else if (versionOutput.strategy === 'sync' || syncGraduation) {
      // One shared version, so lead with it rather than repeat it per row.
      if (updates.length > 0) {
        lines.push(`Merging this PR will publish **${syncVersionDisplay(versionOutput)}**:`, '');
        for (const update of updates) {
          lines.push(`- \`${update.packageName}\``);
        }
      }
      if (syncGraduation) {
        if (updates.length > 0) {
          lines.push('');
        }
        lines.push(syncGraduation);
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

const GITHUB_COMMENT_LIMIT = 65_536;

interface PooledManifest {
  versionOutput: { changelogs: Record<string, unknown>[] } & Record<string, unknown>;
  sharedPackageEntryPool?: VersionChangelogEntry[];
  [key: string]: unknown;
}

function replaceKey(record: object, from: string, to: string, value: unknown): Record<string, unknown> {
  return Object.fromEntries(Object.entries(record).map(([key, v]) => (key === from ? [to, value] : [key, v])));
}

// Changelogs share most of their sharedPackageEntries, so the manifest stores each entry once and the changelogs
// refer to it by index.
function poolSharedPackageEntries(m: StandingPRManifest): PooledManifest {
  if (!m.versionOutput.changelogs.some((changelog) => changelog.sharedPackageEntries)) {
    return m as unknown as PooledManifest;
  }
  const pool: VersionChangelogEntry[] = [];
  const indexOf = new Map<string, number>();
  const changelogs = m.versionOutput.changelogs.map((changelog) => {
    if (!changelog.sharedPackageEntries) {
      return { ...changelog };
    }
    const refs = changelog.sharedPackageEntries.map((entry) => {
      const key = JSON.stringify(entry);
      let index = indexOf.get(key);
      if (index === undefined) {
        index = pool.push(entry) - 1;
        indexOf.set(key, index);
      }
      return index;
    });
    return replaceKey(changelog, 'sharedPackageEntries', 'sharedPackageEntryRefs', refs);
  });
  return { ...m, versionOutput: { ...m.versionOutput, changelogs }, sharedPackageEntryPool: pool };
}

function expandSharedPackageEntries(pooled: PooledManifest): StandingPRManifest {
  const { sharedPackageEntryPool: pool = [], ...manifest } = pooled;
  const changelogs = pooled.versionOutput.changelogs.map((changelog, n) => {
    const refs = changelog.sharedPackageEntryRefs as number[] | undefined;
    if (refs === undefined) {
      return changelog;
    }
    const entries = refs.map((index) => {
      const entry = pool[index];
      if (!entry) {
        throw new Error(
          `Release manifest failed validation: versionOutput.changelogs.${n}.sharedPackageEntryRefs: ${index} is not in sharedPackageEntryPool`,
        );
      }
      return structuredClone(entry);
    });
    return replaceKey(changelog, 'sharedPackageEntryRefs', 'sharedPackageEntries', entries);
  });
  return { ...manifest, versionOutput: { ...pooled.versionOutput, changelogs } } as unknown as StandingPRManifest;
}

function largestManifestParts(pooled: PooledManifest, count: number): string {
  const { versionOutput, ...rest } = pooled;
  const { changelogs, ...versionRest } = versionOutput;
  const parts: [string, unknown][] = [
    ...Object.entries(rest),
    ...Object.entries(versionRest).map(([key, value]): [string, unknown] => [`versionOutput.${key}`, value]),
    ...changelogs.map((changelog): [string, unknown] => [`changelog ${String(changelog.packageName)}`, changelog]),
  ];
  return parts
    .map(([name, value]) => ({ name, size: JSON.stringify(value)?.length ?? 0 }))
    .sort((a, b) => b.size - a.size)
    .slice(0, count)
    .map(({ name, size }) => `${name} (${size})`)
    .join(', ');
}

function assertManifestCommentFits(m: StandingPRManifest): void {
  const { length } = serializeManifest(m);
  if (length > GITHUB_COMMENT_LIMIT) {
    throw new Error(
      `Release manifest comment is ${length} characters, over GitHub's ${GITHUB_COMMENT_LIMIT}-character ` +
        `comment limit. Largest parts, in characters of JSON before base64: ${largestManifestParts(poolSharedPackageEntries(m), 5)}`,
    );
  }
}

export function serializeManifest(m: StandingPRManifest, marker = MANIFEST_MARKER): string {
  const encoded = Buffer.from(JSON.stringify(poolSharedPackageEntries(m))).toString('base64');
  return [
    marker,
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
    throw new Error('Release manifest not found or malformed');
  }

  let json: string;
  try {
    json = Buffer.from(encoded, 'base64').toString('utf-8');
  } catch {
    throw new Error('Release manifest encoding is invalid');
  }

  if (json.length > MAX_MANIFEST_BYTES) {
    throw new Error(
      `Release manifest is too large (${json.length} bytes, limit ${MAX_MANIFEST_BYTES}) — refusing to parse.`,
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
      `Release manifest schema version ${JSON.stringify(schemaVersion)} is incompatible (expected exactly ${MANIFEST_SCHEMA_MIN_VERSION}–${MANIFEST_SCHEMA_VERSION}).`,
    );
  }

  const result = ManifestSchema.safeParse(parsed);
  if (!result.success) {
    const detail = result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
    throw new Error(`Release manifest failed validation: ${detail}`);
  }

  // The validated input, not zod's copy: zod lists schema keys first, which breaks order-sensitive comparisons.
  return expandSharedPackageEntries(parsed as PooledManifest);
}

function findManifestComment(forge: Forge, prNumber: number): Promise<TrustedCommentLookup> {
  return findTrustedComment(forge, prNumber, MANIFEST_MARKER, 'release manifest');
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

  const manifest = await findTrustedManifest(forge, pr.number);
  if (!manifest) {
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
  } else if (publishableUpdates(manifest.versionOutput).length === 0) {
    gateState = 'pending';
    gateReason = 'Nothing ticked to release';
  } else if (manifest.graduationHolds?.length) {
    gateState = 'pending';
    gateReason = manifest.graduationHolds.join('; ');
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

export function extractOverrideLabels(prLabels: string[], ciConfig: CIConfig | undefined): string[] {
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
function graduatedPackageNames(versionOutput: VersionOutput, currentVersions: Record<string, string> = {}): string[] {
  const updates = publishableUpdates(versionOutput);
  // Before any tag exists the engine says 'first-release', so a move from the current prerelease to its base counts.
  const graduates = (u: VersionPackageUpdate): boolean => {
    const current = currentVersions[u.packageName];
    return (
      u.action === 'graduated' ||
      (u.action === 'first-release' &&
        current !== undefined &&
        deriveReleaseChannel(current) === 'prerelease' &&
        current.split('-')[0] === u.newVersion)
    );
  };
  const graduatedGroups = new Set(updates.filter((u) => graduates(u) && u.group).map((u) => u.group as string));
  const names = new Set<string>();
  for (const u of updates) {
    if (graduates(u) || (u.group && graduatedGroups.has(u.group))) {
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
  forge: Forge,
): Promise<StandingPRResult> {
  info('No releasable changes found');
  if (existingStandingPr) {
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

/** Memoized per actor, including a failed lookup. */
function actorAuthorizer(
  forge: Forge,
  authz: StandingPrAuthorization,
): (actor: CommentAuthor | undefined) => Promise<boolean> {
  const checked = new Map<string, Promise<boolean>>();
  return (actor) => {
    const key = `${actor?.type}:${actor?.login}`;
    let result = checked.get(key);
    if (!result) {
      result = isAuthorizedActor(forge, actor?.login, actor?.type, authz);
      checked.set(key, result);
    }
    return result;
  };
}

/**
 * A bot's edit, such as an in-progress banner, can carry forward a body it read, so the body is only as trusted as the
 * last human to write it.
 */
function lastHumanWriter(authored: AuthoredBody): CommentAuthor | undefined {
  const index = authored.editors.findIndex((editor) => editor === undefined || !isBotComment({ user: editor }));
  return index === -1 ? authored.author : authored.editors[index];
}

/**
 * Each release label stays as an authorized actor's latest event left it, whoever changed it since. A label whose
 * actor's permission lookup fails keeps the manifest's state.
 */
async function authorizedReleaseLabels(
  forge: Forge,
  prNumber: number,
  isRelevant: (label: string) => boolean,
  isAuthorized: (actor: CommentAuthor | undefined) => Promise<boolean>,
  manifestLabels: ReadonlySet<string>,
): Promise<string[]> {
  const settled = new Set<string>();
  const applied: string[] = [];
  for (const event of [...(await forge.listLabelEvents(prNumber))].reverse()) {
    if (!isRelevant(event.label) || settled.has(event.label)) {
      continue;
    }
    let keep: boolean;
    try {
      if (!(await isAuthorized(event.actor))) {
        continue;
      }
      keep = event.action === 'labeled';
    } catch (err) {
      warn(
        `Could not verify permission for '${event.actor?.login ?? 'unknown'}' — keeping \`${event.label}\` as the manifest has it: ${err instanceof Error ? err.message : String(err)}`,
      );
      keep = manifestLabels.has(event.label);
    }
    settled.add(event.label);
    if (keep) {
      applied.push(event.label);
    }
  }
  return applied;
}

export async function runStandingPRUpdate(options: StandingPROptions): Promise<StandingPRResult> {
  const banner = new ProgressBanner();
  try {
    return await updateStandingPR(options, banner);
  } finally {
    await banner.clear();
  }
}

async function updateStandingPR(options: StandingPROptions, banner: ProgressBanner): Promise<StandingPRResult> {
  const cwd = options.projectDir;

  const releaseKitConfig = loadReleaseKitConfig({ cwd, configPath: options.config });
  const ciConfig = releaseKitConfig.ci;
  const standingPrConfig = ciConfig?.standingPr;

  const branch = standingPrConfig?.branch ?? 'release/next';
  const base = releaseKitConfig.git?.branch ?? 'main';
  const changelogRefsMode = configuredRefsMode(releaseKitConfig.notes);
  const skipPatterns = releaseKitConfig.release?.ci?.skipPatterns ?? ['chore: release '];

  const bypassSkipGuard = options.reconcile || isStandingPrEventRun();
  let scheduledAtRelease = false;

  if (bypassSkipGuard) {
    info(
      options.reconcile
        ? 'Reconcile mode: bypassing skip-pattern guard'
        : 'Label, edit or dispatched run: bypassing skip-pattern guard',
    );
  } else {
    // A release's own commit on HEAD must not trigger an update.
    const headSubject = await getHeadCommitMessage(cwd);
    if (headSubject && matchesSkipPattern(headSubject, skipPatterns)) {
      // A scheduled run keeps the minAge check advancing once that release is tagged.
      if (process.env.GITHUB_EVENT_NAME !== 'schedule') {
        info(`Skipping standing PR update: commit matches skip pattern`);
        return { action: 'noop' };
      }
      scheduledAtRelease = true;
    }
  }

  const forge = forgeFor(requireGitHubContext('the standing PR cannot be updated'));

  const waitForReleaseInFlight = async (): Promise<StandingPRResult | null> => {
    const inFlight = await findReleaseInFlight({ forge, cwd, base, branch, skipPatterns });
    if (!inFlight) {
      return null;
    }
    info(`Skipping standing PR update: ${inFlight.reason}`);
    return { action: 'noop', reason: inFlight.reason };
  };

  // Ahead of the dry run, which would analyse the untagged release's bumps.
  if (scheduledAtRelease) {
    const waiting = await waitForReleaseInFlight();
    if (waiting) {
      return waiting;
    }
  }

  let existingStandingPr: StandingPullRequest | null = null;
  try {
    existingStandingPr = await forge.findStandingPR(branch);
  } catch (err) {
    warn(`Could not look up standing PR for label overrides: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (options.ack && existingStandingPr && isStandingPrEventRun()) {
    await banner.post(forge, existingStandingPr.number);
  }

  let existingManifest: StandingPRManifest | undefined;
  if (existingStandingPr) {
    try {
      const { comment, refusal } = await findManifestComment(forge, existingStandingPr.number);
      if (refusal) {
        warn(`${refusal} Ignoring it.`);
      } else if (comment) {
        existingManifest = parseManifest(comment.body);
      }
    } catch {
      // Treated as absent: an empty authoritative selection, and firstUpdatedAt restarts.
    }
  }

  const authz = standingPrConfig?.authorization;
  const isAuthorized = authz && actorAuthorizer(forge, authz);

  // Maintainer ticks and note edits live in the body; read them back so they survive this run's regenerate &
  // force-push.
  let liveBody: string | undefined;
  let bodyAuthorized = false;
  if (existingStandingPr) {
    try {
      if (isAuthorized) {
        // Read together, so an edit landing between two reads can't pass under the previous editor.
        const authored = await forge.getAuthoredBody(existingStandingPr.nodeId);
        liveBody = authored.body;
        const writer = lastHumanWriter(authored);
        // Fails closed: a failed permission lookup resets the body to the manifest.
        bodyAuthorized = await isAuthorized(writer).catch((err) => {
          warn(
            `Could not verify permission for '${writer?.login ?? 'unknown'}' — treating as unauthorized: ${err instanceof Error ? err.message : String(err)}`,
          );
          return false;
        });
      } else {
        liveBody = (await forge.getPullRequest(existingStandingPr.number)).body;
      }
    } catch (err) {
      warn(`Could not read current PR body to preserve selection: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  const bodySelection = liveBody ? extractSelection(liveBody) : undefined;
  const bodyDeselected = new Set<string>(bodySelection?.deselected ?? []);
  // Fed to the version write step, not the dry run, so the projected-channel render keeps the marker that round-trips
  // the tick. Reset to the manifest's channels for an unauthorized editor at the write wiring.
  const channelToggleEnabled = standingPrConfig?.channelToggle === true;
  const bodyChannel: ChannelSelection = liveBody
    ? extractChannelSelection(liveBody)
    : { prereleased: [], graduated: [], graduationRows: [] };
  const bodySyncGraduation = !!liveBody && extractSyncGraduation(liveBody);
  let priorDeselected = bodyDeselected;
  if (authz && existingStandingPr && !bodyAuthorized) {
    const manifestDeselected = new Set<string>(existingManifest?.deselected ?? []);
    priorDeselected = manifestDeselected;
    // The manifest holds a held-back primary's whole unit, but only rows with a toggle can differ.
    const bodyRows = new Set(bodySelection?.rows ?? []);
    const manifestShown = new Set([...manifestDeselected].filter((name) => bodyRows.has(name)));
    if (liveBody !== undefined && !setsEqual(bodyDeselected, manifestShown)) {
      const allowClause = authz.allowedActors?.length ? ', or an allow-listed actor' : '';
      await forge
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

  // GitHub can't restrict who applies a label, so with an authorization policy only authorized actors' release labels
  // stand. Everything below reads `effectiveLabels`, so the bot's own re-apply can't restore a rogue label.
  let effectiveLabels = existingStandingPr?.labels ?? [];
  if (authz && isAuthorized && existingStandingPr) {
    const isRelevant = (l: string) => isRelevantOverrideLabel(l, ciConfig);
    const manifestLabels = (existingManifest?.overrideLabels ?? []).filter(isRelevant);
    let authorizedLabels: string[];
    try {
      authorizedLabels = await authorizedReleaseLabels(
        forge,
        existingStandingPr.number,
        isRelevant,
        isAuthorized,
        new Set(manifestLabels),
      );
    } catch (err) {
      warn(
        `Could not read who applied the release labels — resetting them to the manifest's: ${err instanceof Error ? err.message : String(err)}`,
      );
      authorizedLabels = manifestLabels;
    }
    const reconciled = [...new Set([...effectiveLabels.filter((l) => !isRelevant(l)), ...authorizedLabels])];
    if (!setsEqual(new Set(effectiveLabels), new Set(reconciled))) {
      const allowClause = authz.allowedActors?.length ? ', or an allow-listed actor' : '';
      await forge
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

  const sync = releaseKitConfig.version?.sync ?? true;
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

  const resetAndCheckReleaseInFlight = async (): Promise<StandingPRResult | null> => {
    info(`Resetting release branch '${branch}' to origin/${base}...`);
    await resetReleaseBranch(branch, base, cwd);
    return waitForReleaseInFlight();
  };

  // A reconcile runs in a publishing job, whose checkout can predate a newer merge, so it analyses the latest base.
  if (options.reconcile) {
    const waiting = await resetAndCheckReleaseInFlight();
    if (waiting) {
      return waiting;
    }
  }

  const { getWorkspacePackageVersions } = await import('@releasekit/version');
  const workspaceVersions = await getWorkspacePackageVersions({ cwd, configPath: options.config });
  const prereleaseLine = Object.entries(workspaceVersions)
    .filter(([, version]) => deriveReleaseChannel(version) === 'prerelease')
    .map(([name]) => name);

  info('Running version analysis (dry run)...');
  // Run without label graduation, so the dry run is just the queue. Otherwise an unchanged prerelease that a label
  // graduates would look like a queued change instead of getting a graduation row.
  const queueExtras: BuildOptionsExtras =
    prereleaseLine.length > 0 ? { ...buildExtras, stable: undefined, graduate: undefined } : buildExtras;
  const versionOutputDry = await runVersionStep(buildBaseReleaseOptions(options, true, queueExtras));
  const queuedNames = new Set(versionOutputDry.updates.map((u) => u.packageName));

  const minPackages = standingPrConfig?.minPackages;
  const publishableCount = publishableUpdates(versionOutputDry).length;
  const queued = versionOutputDry.updates.length > 0;
  const belowMinPackages = queued && minPackages !== undefined && publishableCount < minPackages;
  const queueEmpty = !queued || belowMinPackages;
  const groups = releaseKitConfig.version?.groups ?? {};

  // A lockstep group with a changed member graduates through that member's row, so its unchanged mates get none.
  const changedLockstepGroups = new Set([...queuedNames].map((name) => lockstepGroupOf(name, groups)));
  const candidates = sync
    ? []
    : prereleaseLine.filter((name) => {
        const group = lockstepGroupOf(name, groups);
        return !queuedNames.has(name) && (group === undefined || !changedLockstepGroups.has(group));
      });
  // A sync release can't hold its queued changes back, so below minPackages it offers nothing.
  const syncGraduationPossible =
    sync && prereleaseLine.length > 0 && !belowMinPackages && (!queued || channelToggleEnabled);

  // Graduates every unchanged prerelease, so each graduation row can show its stable version and changelog.
  let versionOutputRows = versionOutputDry;
  const labelGraduation = !!buildExtras.stable || (buildExtras.graduate?.length ?? 0) > 0;
  if (sync ? syncGraduationPossible : prereleaseLine.length > 0 && (candidates.length > 0 || labelGraduation)) {
    info('Running graduation analysis (dry run)...');
    const graduationExtras: BuildOptionsExtras =
      sync || buildExtras.stable
        ? { ...buildExtras, stable: true }
        : { ...buildExtras, graduate: [...(buildExtras.graduate ?? []), ...candidates] };
    versionOutputRows = await runVersionStep(buildBaseReleaseOptions(options, true, graduationExtras));
  }
  // The prerelease may be a package the release doesn't version (skipped or out of scope), leaving nothing to graduate.
  const syncGraduationOffered =
    syncGraduationPossible && graduatedPackageNames(versionOutputRows, workspaceVersions).length > 0;
  const candidateSet = new Set(candidates);
  const graduationUpdates = sync
    ? []
    : publishableUpdates(versionOutputRows).filter((u) => candidateSet.has(u.packageName));
  const graduationNames = graduationUpdates.map((u) => u.packageName);
  const graduationGroups = new Map(graduationNames.map((name) => [name, lockstepGroupOf(name, groups)]));

  if (queueEmpty && graduationUpdates.length === 0 && !syncGraduationOffered) {
    if (!queued) {
      return closeEmptyQueue(existingStandingPr, forge);
    }
    info(`Package count (${publishableCount}) is below minPackages threshold (${minPackages}), skipping`);
    if (existingStandingPr) {
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
  if (belowMinPackages) {
    info(
      `Package count (${publishableCount}) is below minPackages threshold (${minPackages}); offering graduation only`,
    );
  }

  if (!options.reconcile) {
    const waiting = await resetAndCheckReleaseInFlight();
    if (waiting) {
      return waiting;
    }
  }
  const baseSha = await getHeadSha(cwd);

  const dryUpdates = belowMinPackages
    ? []
    : publishableUpdates(versionOutputRows).filter((u) => !candidateSet.has(u.packageName));
  const changedNames = new Set(dryUpdates.map((u) => u.packageName));
  const primaryPackages = releaseKitConfig.version?.primaryPackages ?? [];
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

  // Fixed/linked members share one version, so a graduation row's tick moves its whole group.
  const expandGraduationRows = (names: Iterable<string>): string[] => {
    const out = new Set<string>();
    for (const name of names) {
      out.add(name);
      const group = graduationGroups.get(name);
      if (group === undefined) {
        continue;
      }
      for (const [mate, mateGroup] of graduationGroups) {
        if (mateGroup === group) {
          out.add(mate);
        }
      }
    }
    return [...out];
  };

  // A label renders its graduation ticked, so once the label goes, that rendered tick mustn't count as the user's.
  const priorLabels = resolveStandingPrLabelOverrides(existingManifest?.overrideLabels ?? [], ciConfig);
  const priorLabelsApplied = priorLabels.conflicts.length === 0;
  const priorLabelGraduated = (name: string): boolean =>
    priorLabelsApplied && (!!priorLabels.stable || shouldMatchPackageTargets(name, priorLabels.graduate ?? []));
  const priorForced = new Set([
    ...expandGraduationRows(graduationNames.filter(priorLabelGraduated)),
    ...expandToGroup([...changedNames].filter(priorLabelGraduated)),
  ]);
  const priorSyncForced = priorLabelsApplied && !!priorLabels.stable;
  // The sync checkbox looks the same with or without queued changes, so a tick given with none lapses once some arrive.
  const priorSyncLapsed = sync && queued && (existingManifest?.graduationRows?.length ?? 0) > 0;
  const userTicks = (names: Iterable<string>, among: Iterable<string>): string[] => {
    const allowed = new Set(among);
    return [...names].filter((name) => allowed.has(name) && !priorForced.has(name));
  };

  // Nested toggles count only with channelToggle; graduation rows and the sync checkbox always show.
  let channelPrereleasedTicks = channelToggleEnabled ? bodyChannel.prereleased : [];
  let channelGraduatedTicks = channelToggleEnabled ? userTicks(bodyChannel.graduated, changedNames) : [];
  let graduationRowTicks = userTicks([...bodyChannel.graduated, ...bodyChannel.graduationRows], graduationNames);
  // Ticking any member's row graduates its group, so unticking any member's row ungraduates it.
  const bodyRowTicks = new Set(graduationRowTicks);
  const untickedRows = (existingManifest?.graduationRows ?? []).filter(
    (name) => graduationNames.includes(name) && !bodyRowTicks.has(name),
  );
  const ungraduated = new Set(expandGraduationRows(untickedRows));
  graduationRowTicks = graduationRowTicks.filter((name) => !ungraduated.has(name));
  let syncGraduationTick = bodySyncGraduation && !priorSyncForced && !priorSyncLapsed;

  // As with the selection, channels reset to the manifest's unless an authorized actor last wrote the body.
  // The manifest stores group-expanded sets but the body holds raw ticks, so expand the body before comparing or
  // untoggled group-mates misfire the notice.
  if (authz && existingStandingPr && !bodyAuthorized) {
    const manifestPrereleased = channelToggleEnabled ? (existingManifest?.prereleased ?? []) : [];
    const manifestGraduated = existingManifest?.graduated ?? [];
    const manifestRowTicks = new Set(existingManifest?.graduationRows ?? []);
    const manifestNested = channelToggleEnabled
      ? userTicks(
          manifestGraduated.filter((name) => !manifestRowTicks.has(name)),
          changedNames,
        )
      : [];
    const manifestRows = userTicks(manifestGraduated, graduationNames);
    const manifestSync = sync && manifestGraduated.length > 0 && !priorSyncForced && !priorSyncLapsed;
    const bodyPrereleased = new Set(expandToGroup(channelPrereleasedTicks));
    const bodyGraduated = new Set(expandToGroup(channelGraduatedTicks));
    // Only an added graduate toggle triggers the notice.
    const prereleaseChanged = !setsEqual(bodyPrereleased, new Set(manifestPrereleased));
    const graduateAdded = [...bodyGraduated].some((name) => !manifestNested.includes(name));
    const rowsChanged = !setsEqual(new Set(expandGraduationRows(graduationRowTicks)), new Set(manifestRows));
    const syncChanged = syncGraduationOffered && syncGraduationTick !== manifestSync;
    channelPrereleasedTicks = manifestPrereleased;
    channelGraduatedTicks = manifestNested;
    graduationRowTicks = manifestRows;
    syncGraduationTick = manifestSync;
    if (liveBody !== undefined && (prereleaseChanged || graduateAdded || rowsChanged || syncChanged)) {
      const allowClause = authz.allowedActors?.length ? ', or an allow-listed actor' : '';
      await forge
        .upsertMarkerComment(
          existingStandingPr.number,
          CHANNEL_DENIED_MARKER,
          `${CHANNEL_DENIED_MARKER}\n\n> ⚠️ **Channel change ignored.** Only authorized maintainers (\`${authz.requiredPermission}\`+${allowClause}) can move a package between the stable and prerelease channels. The channel toggles and graduation rows have been reset to the approved selection.`,
        )
        .catch((err) =>
          warn(`Could not post channel-denied notice: ${err instanceof Error ? err.message : String(err)}`),
        );
    }
  }

  const channelPrereleased = channelPrereleasedTicks.filter((n) => !effectiveDeselected.has(n));
  const channelGraduated = channelGraduatedTicks.filter((n) => !effectiveDeselected.has(n));
  const writePrereleaseScope = expandToGroup(channelPrereleased);
  const labelGraduatedRows = graduationNames.filter(
    (name) => !!buildExtras.stable || shouldMatchPackageTargets(name, buildExtras.graduate ?? []),
  );
  const graduationRowsTicked = new Set(expandGraduationRows([...graduationRowTicks, ...labelGraduatedRows]));
  const syncGraduated = !!buildExtras.stable || (syncGraduationOffered && syncGraduationTick);
  const graduateTargets = [
    ...new Set([...(buildExtras.graduate ?? []), ...expandToGroup(channelGraduated), ...graduationRowsTicked]),
  ];
  // Targets can be globs (`graduate:@scope/*`); expand them so the conflict check drops only the packages a
  // prerelease toggle also names, not the whole glob.
  const graduateAll = [...changedNames, ...graduationNames].filter((name) =>
    shouldMatchPackageTargets(name, graduateTargets),
  );
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
    stable: syncGraduated || undefined,
    exclude: [...effectiveDeselected, ...(belowMinPackages ? queuedNames : [])],
    graduate: writeGraduate.length > 0 ? writeGraduate : undefined,
    prereleaseScope: writePrereleaseScope.length > 0 ? writePrereleaseScope : undefined,
  });
  const versionOutput = await runVersionStep(writeOptions);

  // The write can come back empty when a release landed on `base` and tagged after the dry run, which would render a
  // degenerate body. Publishable-only so a sync root-only bump is caught too. Offered graduations keep the PR open
  // with nothing ticked.
  const graduationOffered = graduationUpdates.length > 0 || syncGraduationOffered;
  if (publishableUpdates(versionOutput).length === 0 && !graduationOffered) {
    return closeEmptyQueue(existingStandingPr, forge);
  }

  const countableUpdates = publishableUpdates(versionOutput);
  const count = countableUpdates.length;

  const liveNotes = previewNotesEnabled && liveBody ? extractNotesRegions(liveBody, versionOutput) : {};
  const notesInputHashes = releaseNotesInputHashes(versionOutput, releaseKitConfig.notes);
  const notesPlan = planNotesRegions(
    previewNotesEnabled ? notesRegionKeys(versionOutput) : [],
    liveNotes,
    existingManifest?.notesRegions,
    notesInputHashes,
  );

  info('Generating changelog...');
  const notesResult: NotesStepResult =
    count > 0
      ? await runNotesStep(versionOutput, { ...writeOptions, skipNotes: false, skipReleaseNotes: true })
      : { packageNotes: {}, files: [] };
  const generatedNotes: Record<string, string> = {};
  if (count > 0 && notesPlan.generate.length > 0) {
    info(`Generating release notes for ${notesPlan.generate.length} package(s)...`);
    try {
      const generated = await runNotesStep(versionOutput, {
        ...writeOptions,
        skipNotes: false,
        skipReleaseNotes: false,
        releaseNotesFor: notesPlan.generate,
      });
      for (const key of notesPlan.generate) {
        const notes = generated.releaseNotes?.[key];
        if (notes) {
          generatedNotes[key] = notes;
        }
      }
    } catch (err) {
      warn(
        `Release notes generation failed, so the current notes stay: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  const firstUpdate = countableUpdates[0];
  const isSync = versionOutput.strategy === 'sync';
  /* biome-ignore lint/suspicious/noTemplateCurlyInString: template string uses config variable */
  const defaultTitle = isSync ? 'chore: release ${tag}' : 'chore: release ${count} package(s)';
  const titleTemplate = standingPrConfig?.title ?? defaultTitle;
  const renderedTitle =
    count > 0
      ? titleTemplate
          .replace(/\$\{count\}/g, String(count))
          .replace(/\$\{version\}/g, firstUpdate?.newVersion ?? '')
          .replace(/\$\{tag\}/g, syncVersionDisplay(versionOutput))
      : FALLBACK_TITLE;

  const title = safeStandingPrTitle(renderedTitle, skipPatterns);
  // Accepted race: a human edit landing between the body read above and the update below is overwritten; updates
  // are infrequent enough not to warrant optimistic concurrency.
  let notesRegion: string | undefined;
  const notesRegionStates: NotesRegionStates = { ...notesPlan.owned };
  if (previewNotesEnabled) {
    for (const [key, notes] of Object.entries(generatedNotes)) {
      notesRegionStates[key] = notesRegionState(key, notes, notesInputHashes[key] ?? '');
    }
    // A region that wasn't regenerated, as when the LLM call failed, stays with its old state.
    const regions = { ...liveNotes, ...generatedNotes };
    if (Object.keys(regions).length > 0) {
      notesRegion = renderNotesRegion(regions);
    }
  }

  let firstUpdatedAt = new Date().toISOString();
  // A PR holding only unticked graduation rows had nothing to release, so its minAge wait hasn't started.
  if (existingManifest && publishableUpdates(existingManifest.versionOutput).length > 0) {
    firstUpdatedAt = existingManifest.firstUpdatedAt ?? existingManifest.createdAt;
  }

  const graduatedPackages = graduatedPackageNames(versionOutput, workspaceVersions);
  const rowGraduated =
    sync && syncGraduated && !queued
      ? graduatedPackages
      : graduatedPackages.filter((name) => graduationRowsTicked.has(name));

  const queuedEntries = new Map(versionOutputDry.changelogs.map((cl) => [cl.packageName, cl.entries]));
  // A sync release records its changes once, in its shared changelog, and graduates as one.
  const graduationChecks = sync
    ? graduatedPackages.slice(0, 1).map((name) => ({
        subject: 'The release',
        entries: versionOutputDry.changelogs.flatMap((cl) => cl.entries),
        current: workspaceVersions[name],
      }))
    : graduatedPackages.map((name) => ({
        subject: `\`${name}\``,
        entries: queuedEntries.get(name),
        current: workspaceVersions[name],
      }));
  const graduationHolds: string[] = [];
  for (const { subject, entries, current } of graduationChecks) {
    const needed =
      entries && current ? graduationOvershoot(entries, current, releaseKitConfig.version?.zeroMajor) : undefined;
    if (needed) {
      const bumpLabel = needed === 'major' ? overrideLabelNames.major : overrideLabelNames.minor;
      const hold =
        `${subject} can't graduate: its queued changes need a ${needed} bump. Start a new line with ` +
        `\`${bumpLabel}\` + \`${overrideLabelNames.prerelease}\``;
      warn(hold);
      graduationHolds.push(hold);
    }
  }

  const manifest: StandingPRManifest = {
    schemaVersion: 2,
    versionOutput,
    // Publish reads the notes from the body.
    releaseNotes: {},
    notesFiles: notesResult.files,
    createdAt: new Date().toISOString(),
    baseSha,
    // Stands in for the release branch's head, which has the same length, until the push below.
    headSha: baseSha,
    firstUpdatedAt,
    overrideLabels: extractOverrideLabels(effectiveLabels, ciConfig),
    deselected: effectiveDeselected.size > 0 ? [...effectiveDeselected].sort() : undefined,
    graduated: graduatedPackages.length > 0 ? graduatedPackages : undefined,
    graduationRows: rowGraduated.length > 0 ? rowGraduated : undefined,
    graduationHolds: graduationHolds.length > 0 ? graduationHolds : undefined,
    prereleased: writePrereleaseScope.length > 0 ? [...writePrereleaseScope].sort() : undefined,
    notesRegions: Object.keys(notesRegionStates).length > 0 ? notesRegionStates : undefined,
  };
  assertManifestCommentFits(manifest);

  info(`Committing and pushing '${branch}'...`);
  // With nothing ticked there's nothing to commit, and GitHub won't open a PR with no commits.
  await commitAndForcePush(
    branch,
    title,
    cwd,
    releaseKitConfig.git?.skipHooks ?? false,
    releaseKitConfig.git?.formatCommand,
    count === 0,
  );

  const releaseBranchSha = await getHeadSha(cwd);

  success(`Release branch '${branch}' updated`);

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
          refused: unresolved.refused,
          retryable: unresolved.retryable,
          standingPrNumber: unresolved.prNumber,
          retryLabelAvailable: true,
        });
      }
    }
  } catch (err) {
    warn(`Could not check for unresolved publish failures: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Rendered from the dry run's full changed set so a held-back package still shows as an unticked row with its
  // changelog; the write output omits held-back packages entirely.
  let renderSelectionBlock: ((withChangelogs: boolean) => string) | undefined;
  if (!sync && versionOutputDry.strategy !== 'sync') {
    const warnings = selectionWarnings(dryUpdates, effectiveDeselected, groups);
    for (const w of warnings) {
      warn(`Selection: ${w.reason}`);
    }
    const warningSuffix = warnings.length > 0 ? `\n\n${warnings.map((w) => `> ⚠️ ${w.reason}`).join('\n')}` : '';
    const rowChangelog = makeRowChangelogRenderer(versionOutputRows.changelogs, changelogRefsMode);
    const channelToggle: ChannelToggleConfig | undefined = channelToggleEnabled
      ? {
          prereleased: new Set(channelPrereleasedTicks),
          graduated: new Set(channelGraduatedTicks),
          prereleaseIdentifier: releaseKitConfig.version?.prereleaseIdentifier ?? 'next',
        }
      : undefined;
    const graduation: GraduationRowsConfig = { updates: graduationUpdates, ticked: graduationRowsTicked };
    renderSelectionBlock = (withChangelogs) =>
      renderSelectionRegion(
        dryUpdates,
        effectiveDeselected,
        primaryConfig,
        withChangelogs ? rowChangelog : undefined,
        channelToggle,
        graduation,
      ) + warningSuffix;
  }
  const syncGraduation = syncGraduationOffered
    ? renderSyncGraduation(syncVersionDisplay(versionOutputRows), syncGraduated)
    : undefined;

  // From the write output, so it mirrors what publishes. The toggle only removes redundancy, never data: sync has no
  // per-row changelogs so always gets the footer, and non-sync keeps shared entries, which have no per-row home.
  const footerEnabled = standingPrConfig?.combinedChangelogFooter !== false;
  const footer =
    footerEnabled || versionOutput.strategy === 'sync'
      ? renderCombinedFooter(versionOutput, { refs: changelogRefsMode })
      : renderCombinedFooter(versionOutput, { sharedOnly: true, refs: changelogRefsMode });

  let summaryLine: string | undefined;
  let summaryTable: string | undefined;
  if (versionOutput.strategy !== 'sync' && count > 0) {
    const publishingChanged = countableUpdates.filter((u) => changedNames.has(u.packageName)).length;
    const heldBackCount = Math.max(0, dryUpdates.length - publishingChanged);
    summaryLine = renderReleaseSummaryLine(versionOutput, { heldBackCount });
    if (standingPrConfig?.summaryTable) {
      summaryTable = renderVersionSummaryTable(versionOutput);
    }
  }

  const body = renderPrBody(versionOutput, {
    supersedeWarning,
    notesRegion,
    renderSelectionBlock,
    syncGraduation,
    footer,
    summaryLine,
    summaryTable,
  });

  let prNumber: number;
  let prUrl: string;
  let action: StandingPRResult['action'];

  if (existing) {
    await forge.updatePullRequest(existing.number, { title, body });
    banner.markRewritten();
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
    const graduatable = [...new Set([...prereleasePackageNames(versionOutput), ...graduationNames])];
    await syncLabels(forge, deriveLabelDefinitions(ciConfig, graduatable));
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

  manifest.headSha = releaseBranchSha;
  await forge.upsertMarkerComment(prNumber, MANIFEST_MARKER, serializeManifest(manifest));
  success(`Manifest written to PR #${prNumber}`);

  const holds = [...overrides.conflicts, ...graduationHolds];
  if (count === 0) {
    holds.push(
      sync
        ? 'Nothing to release: tick "graduate to stable" to graduate the prerelease'
        : 'Nothing to release: tick a graduation row to ship its stable version',
    );
  }

  const minAge = standingPrConfig?.minAge;
  let statusState: 'success' | 'pending' = 'success';
  let statusDescription = 'Ready to merge';

  if (holds.length > 0) {
    statusState = 'pending';
    statusDescription = holds.join('; ').slice(0, 140);
  }

  if (minAge !== undefined && holds.length === 0) {
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
 * Every failure throws: once a PR is named there is no "nothing to do" outcome, so a returned result means the
 * publish ran.
 */
export async function publishFromManifest(prNumber: number, options: StandingPROptions): Promise<ReleaseOutput> {
  const cwd = options.projectDir;

  const forge = forgeFor(requireGitHubContext(`the release manifest cannot be read from PR #${prNumber}`));

  const releaseKitConfig = loadReleaseKitConfig({ cwd, configPath: options.config });
  const standingPrConfig = releaseKitConfig.ci?.standingPr;
  const releaseBranch = standingPrConfig?.branch ?? 'release/next';
  const deleteBranchOnMerge = standingPrConfig?.deleteBranchOnMerge !== false;

  const { manifest, pr } = await authorizePublish(forge, {
    phase: 'post-merge',
    prNumber,
    config: releaseKitConfig,
    cwd,
    configPath: options.config,
  });
  const mergedHead = pr.headSha;

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

  // From the body, not the manifest: the manifest holds machine state only.
  const bodyNotes = extractNotesRegions(pr.body ?? '', manifest.versionOutput);
  const usableNotes = publishableNotesRegions(bodyNotes, manifest.notesRegions);
  const notesToGenerate = notesRegionKeys(manifest.versionOutput).filter((key) => !Object.hasOwn(usableNotes, key));

  let releaseNotes: Record<string, string> = {};
  if (notesToGenerate.length > 0) {
    try {
      info('Generating release notes (with LLM enhancement)...');
      const notesResult = await runNotesStep(manifest.versionOutput, {
        ...notesGenerationOptions,
        releaseNotesFor: notesToGenerate,
      });
      releaseNotes = Object.fromEntries(
        Object.entries(notesResult.releaseNotes ?? {}).filter(([key]) => notesToGenerate.includes(key)),
      );
    } catch (err) {
      warn(`Release notes generation failed: ${err instanceof Error ? err.message : String(err)}`);
      warn('Publishing anyway; a package without notes in the PR body gets the githubRelease.body fallback.');
    }
  }
  // A truncated region still ships if its regeneration failed.
  const regionNotes = Object.fromEntries(
    Object.entries(bodyNotes)
      .filter(([key]) => !Object.hasOwn(releaseNotes, key))
      .map(([key, text]) => [key, normalizeRegionText(text)]),
  );
  if (Object.keys(regionNotes).length > 0) {
    releaseNotes = { ...releaseNotes, ...regionNotes };
    info(`Using the reviewed release notes for ${Object.keys(regionNotes).length} package(s) from the PR body.`);
  }

  await createReleaseTags(
    [...manifest.versionOutput.tags, ...(manifest.versionOutput.baselineTags ?? [])],
    cwd,
    pr.mergeCommitSha,
  );

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
    publishOutput = await runPublishStep(manifest.versionOutput, publishOptions, releaseNotes);
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

  if (deleteBranchOnMerge) {
    if (mergedHead && isCommitSha(mergedHead)) {
      await deleteReleaseBranch(releaseBranch, cwd, mergedHead);
    } else {
      const problem = mergedHead
        ? `PR #${prNumber}'s head '${mergedHead}' isn't a commit SHA`
        : `couldn't read PR #${prNumber}'s head commit`;
      warn(
        `Kept release branch '${releaseBranch}': ${problem}, so can't tell whether an update has moved it since the merge.`,
      );
    }
  }

  // The merge, not this job, moved the base branch. Last, so its API calls don't delay the branch cleanup.
  await markFeederPreviewsStale({
    ciConfig: releaseKitConfig.ci,
    branch: pr.baseRef ?? releaseKitConfig.git?.branch ?? 'main',
  });

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
  return (await latestMergedStandingPR(forge, branch))?.number ?? null;
}

async function latestMergedStandingPR(forge: Forge, branch: string): Promise<MergedStandingPR | null> {
  const prs = await forge.listRecentlyClosedPullRequests(branch, 10);

  // 'updated' ordering only guarantees the newest merge is in the page; late activity on an older merged PR can
  // sort it above a newer merge, so pick by mergedAt.
  const merged = prs
    .flatMap((pr) => (pr.mergedAt != null ? [{ number: pr.number, mergedAt: pr.mergedAt }] : []))
    .sort((a, b) => new Date(b.mergedAt).getTime() - new Date(a.mergedAt).getTime());
  return merged[0] ?? null;
}

// Long enough for a slow publish, short enough that one which crashed without reporting can't hold updates for good.
const RELEASE_IN_FLIGHT_BACKSTOP_MS = 2 * 3_600_000;
const RELEASE_COMMIT_SCAN_DEPTH = 50;

export interface FindReleaseInFlightOptions {
  forge: Forge;
  cwd: string;
  /** Read as `origin/<base>`, so fetch first. */
  base: string;
  /** The standing PR's head branch. */
  branch: string;
  skipPatterns: string[];
}

export interface ReleaseInFlight {
  reason: string;
}

interface UntaggedRelease {
  label: string;
  landedAt: number;
  hasFailureReport: () => Promise<boolean>;
}

interface MergedStandingPR {
  number: number;
  mergedAt: string;
}

function mergedStandingRelease(forge: Forge, merged: MergedStandingPR, why: string): UntaggedRelease {
  return {
    label: `standing PR #${merged.number} (${why})`,
    landedAt: Date.parse(merged.mergedAt),
    hasFailureReport: async () => (await detectUnresolvedFailure(forge, merged.number)) !== null,
  };
}

/** The latest merged standing PR when its manifest's tags aren't all on the remote. */
function untaggedStandingRelease(
  forge: Forge,
  merged: MergedStandingPR,
  manifest: StandingPRManifest | null,
  remoteTags: Record<string, string>,
): UntaggedRelease | null {
  const missing = (manifest?.versionOutput.tags ?? []).filter((tag) => !Object.hasOwn(remoteTags, tag));
  return missing.length === 0 ? null : mergedStandingRelease(forge, merged, `${missing.join(', ')} not on the remote`);
}

/**
 * Why an untagged release no longer counts as publishing: its publish reported a failure, so the next release
 * supersedes it, or it is older than the backstop. Null while it still counts.
 */
async function lapsed(release: UntaggedRelease): Promise<{ reported: true } | { age: number } | null> {
  if (await release.hasFailureReport()) {
    return { reported: true };
  }
  const age = Date.now() - release.landedAt;
  return age > RELEASE_IN_FLIGHT_BACKSTOP_MS ? { age } : null;
}

/**
 * A release on `origin/<base>` whose tags aren't on the remote yet: a merged standing PR missing any of its manifest's
 * tags, or a direct release commit with none. Recomputing from its bumped versions would double-bump. One whose
 * publish reported a failure doesn't count, as the next release supersedes it, nor does one older than the backstop.
 */
export async function findReleaseInFlight(options: FindReleaseInFlightOptions): Promise<ReleaseInFlight | null> {
  const { forge, cwd, base, branch, skipPatterns } = options;
  const remoteTags = await createGitCli().remoteTags('origin', cwd);
  const untagged: UntaggedRelease[] = [];

  const merged = await latestMergedStandingPR(forge, branch);
  const standing =
    merged && untaggedStandingRelease(forge, merged, await findTrustedManifest(forge, merged.number), remoteTags);
  if (standing) {
    untagged.push(standing);
  }

  const commit = await latestReleaseCommit(base, skipPatterns, cwd);
  if (commit && !Object.values(remoteTags).includes(commit.sha)) {
    // A standing PR's merge commit needn't carry its tags, so the manifest check above covers it.
    const standingMerge = merged ? (await forge.getPullRequest(merged.number)).mergeCommitSha : undefined;
    if (commit.sha !== standingMerge) {
      untagged.push({
        label: `release commit ${commit.sha.slice(0, 7)} (no tags on the remote)`,
        landedAt: commit.committedAt,
        hasFailureReport: async () => {
          // A direct release reports on the PR that triggered it, which merged as the commit's parent.
          for (const prNumber of commit.parent ? await findMergedPRsForCommit(forge, commit.parent) : []) {
            if (await detectUnresolvedFailure(forge, prNumber)) {
              return true;
            }
          }
          return false;
        },
      });
    }
  }

  for (const release of untagged) {
    const lapse = await lapsed(release);
    if (lapse === null) {
      return { reason: `a release is still publishing: ${release.label}` };
    }
    if ('reported' in lapse) {
      info(`${release.label} has a publish-failure report, so the next release supersedes it`);
    } else {
      warn(
        `${release.label} is still untagged ${formatDuration(lapse.age)} after it landed, with no publish-failure ` +
          'report; updating anyway, so check that its publish finished',
      );
    }
  }
  return null;
}

/**
 * On a push, the merged standing PR whose release is still publishing, as {@link findReleaseInFlight} sees it: a run
 * a newer push replaced leaves it untagged, so the newer run publishes it.
 */
async function standingReleaseToPublish(
  forge: Forge,
  branch: string,
  retryLabel: string,
  cwd: string,
): Promise<number | null> {
  const merged = await latestMergedStandingPR(forge, branch);
  const manifest = merged && (await findTrustedManifest(forge, merged.number));
  // An untrusted manifest names no tags to check, so publish it anyway: the refusal is reported on the PR.
  const release =
    merged &&
    (manifest
      ? untaggedStandingRelease(forge, merged, manifest, await createGitCli().remoteTags('origin', cwd))
      : mergedStandingRelease(forge, merged, "its release manifest can't be trusted"));
  if (!merged || !release) {
    info('Nothing to publish: no merged standing PR is waiting for its tags');
    return null;
  }
  const lapse = await lapsed(release);
  if (lapse === null) {
    return merged.number;
  }
  if ('reported' in lapse) {
    info(`Not publishing ${release.label}: its publish failed. Apply '${retryLabel}' to the PR to retry it.`);
  } else {
    warn(
      `Not publishing ${release.label}: it landed ${formatDuration(lapse.age)} ago. Check whether its publish ` +
        `finished, and apply '${retryLabel}' to the PR to publish it.`,
    );
  }
  return null;
}

async function latestReleaseCommit(
  base: string,
  skipPatterns: string[],
  cwd: string,
): Promise<{ sha: string; parent?: string; committedAt: number } | null> {
  const log = await createGitCli().log({
    range: `origin/${base}`,
    format: '%H%x09%P%x09%ct%x09%s',
    extraArgs: ['--first-parent', `--max-count=${RELEASE_COMMIT_SCAN_DEPTH}`],
    cwd,
  });
  for (const line of log.split('\n')) {
    const [sha, parents, committedAt, ...subject] = line.split('\t');
    if (sha && matchesSkipPattern(subject.join('\t'), skipPatterns)) {
      return { sha, parent: parents?.split(' ')[0] || undefined, committedAt: Number(committedAt) * 1000 };
    }
  }
  return null;
}

/**
 * `null` means nothing to do (the caller reports success); anything that went wrong throws so a misconfiguration
 * can't read as a successful no-op. `pull_request: closed` fires for every closed PR, and a push for every commit, so
 * both stay quiet no-ops unless they find a standing release to publish.
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

  let event: { pull_request?: { head?: { ref?: string }; number?: number; merged?: boolean } } | undefined;
  try {
    event = readGitHubEvent({ strict: true });
  } catch (err) {
    throw new Error(
      `${err instanceof Error ? err.message : String(err)}. The event payload decides which PR to publish — pass --pr explicitly to bypass it.`,
    );
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

  const forge = forgeFor(requireGitHubContext('the merged standing PR cannot be inferred'));
  if (process.env.GITHUB_EVENT_NAME === 'push') {
    const retryLabel = (releaseKitConfig.ci?.labels ?? DEFAULT_LABELS).retry;
    const prNumber = await standingReleaseToPublish(forge, releaseBranch, retryLabel, cwd);
    return prNumber === null ? null : publishFromManifest(prNumber, options);
  }

  const inferred = await findLatestMergedStandingPR(forge, releaseBranch);
  if (inferred === null) {
    throw new Error(`No merged standing release PR found for branch '${releaseBranch}' — pass --pr explicitly.`);
  }

  info(
    `Inferred standing PR #${inferred} (most recently merged '${releaseBranch}' PR) — pass --pr to target a specific PR`,
  );
  return publishFromManifest(inferred, options);
}

export async function runStandingPRMerge(options: StandingPROptions): Promise<StandingPRMergeResult> {
  const releaseKitConfig = loadReleaseKitConfig({ cwd: options.projectDir, configPath: options.config });
  const standingPrConfig = releaseKitConfig.ci?.standingPr;
  const branch = standingPrConfig?.branch ?? 'release/next';
  const mergeMethod = (standingPrConfig?.mergeMethod ?? 'merge') as 'merge' | 'squash' | 'rebase';

  const forge = forgeFor(requireGitHubContext('the standing PR cannot be merged'));

  const pr = await forge.findStandingPR(branch);
  if (!pr) {
    info(`No open standing PR found for branch '${branch}'`);
    return null;
  }

  const { headSha: sha } = await authorizePublish(forge, {
    phase: 'pre-merge',
    prNumber: pr.number,
    config: releaseKitConfig,
    cwd: options.projectDir,
    configPath: options.config,
  });

  info(`Merging standing PR #${pr.number} via ${mergeMethod}...`);
  try {
    await forge.mergePullRequest(pr.number, mergeMethod, sha);
  } catch (err) {
    const status = forgeErrorStatus(err);
    if (status === 409) {
      throw new Error(
        `Cannot merge standing PR #${pr.number}: '${branch}' has moved since the release manifest was written. ` +
          `Wait for the standing-PR update to finish, or re-run it if it failed, then merge again.`,
      );
    }
    if (status === 405) {
      // The forge surfaces the raw error, so a non-GitHub adapter yields 'unknown reason'.
      const reason =
        (err as { response?: { data?: { message?: string } } }).response?.data?.message ?? 'unknown reason';
      throw new Error(`Cannot merge standing PR #${pr.number}: GitHub rejected the merge (${reason})`);
    }
    throw err;
  }
  success(`Standing PR #${pr.number} merged`);

  return { merged: true, prNumber: pr.number };
}
