import type { ReleaseChannel, VersionOutput } from '@releasekit/core';
import { deriveReleaseChannel } from '@releasekit/core';
import { getDistTag } from '@releasekit/publish';
import semver from 'semver';
import { publishableUpdates, toDisplayVersion } from '../version-display.js';
import { countCombinedChanges } from './changelog-region.js';

/**
 * The two additive, non-interactive summary surfaces at the top of a standing-PR body:
 *  - {@link renderReleaseSummaryLine} — a one-line headline (package count, channel split, change
 *    count, major-bump flag, held-back count).
 *  - {@link renderVersionSummaryTable} — a collapsed `current → next` table with bump magnitude and
 *    dist-tag, the scannable Dependabot-style view the interactive checkbox list can't be (GitHub only
 *    renders task-list checkboxes as list items, never in a table cell).
 *
 * Both read the *write* output, whose held-back packages are already excluded, so they mirror exactly
 * what publishes. Sync releases render neither — they ship atomically with their own single-version
 * display; these surfaces are for the per-package (single/async/group) path.
 */

type Update = VersionOutput['updates'][number];

/** The channel a row sits on: the per-package value stamped on the update, falling back to deriving it
 *  from the resolved version for manifests written before that field existed (old PRs still open). */
function channelOf(update: Update): ReleaseChannel {
  return update.channel ?? deriveReleaseChannel(update.newVersion);
}

/** The bare baseline semver an update bumped from, or `undefined` when none was recorded (old manifest,
 *  first release, or an unreachable / all-history baseline). `previousVersion` is persisted in
 *  consumer-tag form, so strip the tag scheme back to bare semver before use. */
function baselineOf(update: Update): string | undefined {
  if (!update.previousVersion) return undefined;
  const bare = toDisplayVersion(update.previousVersion);
  return semver.valid(bare) ? bare : undefined;
}

/** The bump magnitude `semver.diff` reports between baseline and next, or `undefined` when it can't be
 *  computed (no reachable baseline, or an unparseable version). */
function bumpDiff(update: Update): ReturnType<typeof semver.diff> {
  const prev = baselineOf(update);
  if (!prev || !semver.valid(update.newVersion)) return null;
  return semver.diff(prev, update.newVersion);
}

/** A major bump — a new stable major (`major`) or a prerelease opening one (`premajor`). Only a
 *  reachable baseline can qualify; without one we can't claim a magnitude, so it never counts. */
function isMajorBump(update: Update): boolean {
  const diff = bumpDiff(update);
  return diff === 'major' || diff === 'premajor';
}

/** The Bump-column label: the computed magnitude when a baseline is reachable, else a coarse hint from
 *  the resolved action/channel, else a dash. */
function bumpLabel(update: Update): string {
  const diff = bumpDiff(update);
  if (diff) return diff;
  if (update.action === 'first-release') return 'first release';
  if (channelOf(update) === 'prerelease') return 'prerelease';
  return '—';
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

export interface ReleaseSummaryInput {
  /** Changed packages held back from this run (unticked rows). Omit the clause when 0. */
  heldBackCount: number;
}

/**
 * The one-line release headline rendered under `## Release`. Example:
 * `**9 packages** will publish — 8 stable · 1 prerelease · 17 changes. No major bumps. 3 held back.`
 * The channel split is shown only when the PR actually mixes channels; a single-channel batch would
 * just restate the package count.
 */
export function renderReleaseSummaryLine(versionOutput: VersionOutput, input: ReleaseSummaryInput): string {
  const updates = publishableUpdates(versionOutput);
  const stable = updates.filter((u) => channelOf(u) === 'stable').length;
  const prerelease = updates.filter((u) => channelOf(u) === 'prerelease').length;
  const changes = countCombinedChanges(versionOutput);
  const major = updates.filter(isMajorBump).length;

  const buckets: string[] = [];
  if (stable > 0) buckets.push(plural(stable, 'stable', 'stable'));
  if (prerelease > 0) buckets.push(plural(prerelease, 'prerelease', 'prerelease'));

  const segments: string[] = [];
  if (buckets.length > 1) segments.push(...buckets);
  segments.push(plural(changes, 'change'));

  const majorClause = major > 0 ? `⚠️ ${plural(major, 'major bump')}.` : 'No major bumps.';
  const heldBackClause = input.heldBackCount > 0 ? ` ${input.heldBackCount} held back.` : '';

  return `**${plural(updates.length, 'package')}** will publish — ${segments.join(' · ')}. ${majorClause}${heldBackClause}`;
}

/**
 * The collapsed `<details>` version-summary table: one row per publishing package with its current
 * version, next version, bump magnitude, and dist-tag. Returns `''` when there is nothing to publish.
 */
export function renderVersionSummaryTable(versionOutput: VersionOutput): string {
  const updates = publishableUpdates(versionOutput);
  if (updates.length === 0) return '';

  const lines: string[] = [
    `<details><summary>Version summary (${plural(updates.length, 'package')})</summary>`,
    '',
    '| Package | Current | Next | Bump | Tag |',
    '| --- | --- | --- | --- | --- |',
  ];
  for (const update of updates) {
    const current = baselineOf(update) ?? '—';
    lines.push(
      `| \`${update.packageName}\` | ${current} | ${update.newVersion} | ${bumpLabel(update)} | ${getDistTag(update.newVersion)} |`,
    );
  }
  lines.push('', '</details>');
  return lines.join('\n');
}
