import type { ReleaseChannel, VersionOutput } from '@releasekit/core';
import { deriveReleaseChannel } from '@releasekit/core';
import { getDistTag } from '@releasekit/publish';
import semver from 'semver';
import { publishableUpdates, toDisplayVersion } from '../version-display.js';
import { countCombinedChanges } from './changelog-region.js';

/** Both summaries read the write output, which already excludes held-back packages, so they mirror what publishes. */

type Update = VersionOutput['updates'][number];

/** Derived from the version when absent: manifests in still-open PRs can predate the `channel` field. */
function channelOf(update: Update): ReleaseChannel {
  return update.channel ?? deriveReleaseChannel(update.newVersion);
}

/** `previousVersion` is persisted in consumer-tag form, so strip the tag scheme back to bare semver. */
function baselineOf(update: Update): string | undefined {
  if (!update.previousVersion) {
    return undefined;
  }
  const bare = toDisplayVersion(update.previousVersion);
  return semver.valid(bare) ? bare : undefined;
}

function bumpDiff(update: Update): ReturnType<typeof semver.diff> {
  const prev = baselineOf(update);
  if (!prev || !semver.valid(update.newVersion)) {
    return null;
  }
  return semver.diff(prev, update.newVersion);
}

function isMajorBump(update: Update): boolean {
  const diff = bumpDiff(update);
  return diff === 'major' || diff === 'premajor';
}

function bumpLabel(update: Update): string {
  const diff = bumpDiff(update);
  if (diff) {
    return diff;
  }
  if (update.action === 'first-release') {
    return 'first release';
  }
  if (channelOf(update) === 'prerelease') {
    return 'prerelease';
  }
  return '—';
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

export interface ReleaseSummaryInput {
  heldBackCount: number;
}

/** The channel split shows only when the PR mixes channels; otherwise it would just restate the package count. */
export function renderReleaseSummaryLine(versionOutput: VersionOutput, input: ReleaseSummaryInput): string {
  const updates = publishableUpdates(versionOutput);
  const stable = updates.filter((u) => channelOf(u) === 'stable').length;
  const prerelease = updates.filter((u) => channelOf(u) === 'prerelease').length;
  const changes = countCombinedChanges(versionOutput);
  const major = updates.filter(isMajorBump).length;

  const buckets: string[] = [];
  if (stable > 0) {
    buckets.push(plural(stable, 'stable', 'stable'));
  }
  if (prerelease > 0) {
    buckets.push(plural(prerelease, 'prerelease', 'prerelease'));
  }

  const segments: string[] = [];
  if (buckets.length > 1) {
    segments.push(...buckets);
  }
  segments.push(plural(changes, 'change'));

  const majorClause = major > 0 ? `⚠️ ${plural(major, 'major bump')}.` : 'No major bumps.';
  const heldBackClause = input.heldBackCount > 0 ? ` ${input.heldBackCount} held back.` : '';

  return `**${plural(updates.length, 'package')}** will publish — ${segments.join(' · ')}. ${majorClause}${heldBackClause}`;
}

export function renderVersionSummaryTable(versionOutput: VersionOutput): string {
  const updates = publishableUpdates(versionOutput);
  if (updates.length === 0) {
    return '';
  }

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
