import type { VersionChangelogEntry, VersionPackageChangelog } from '@releasekit/core';
import { formatDuration } from '../duration.js';
import { MARKER } from '../github.js';
import type { StandingPRSnapshot } from '../standing-pr/standing-pr.js';
import type { ReleaseOutput } from '../types.js';
import type { MergedRow } from './merge.js';

export type ReleaseStrategy = 'manual' | 'direct' | 'standing-pr' | 'scheduled';
const FOOTER = '*Updated automatically by [ReleaseKit](https://github.com/goosewobbler/releasekit)*';

const TYPE_LABELS: Record<string, string> = {
  added: 'Added',
  changed: 'Changed',
  fixed: 'Fixed',
  security: 'Security',
  docs: 'Documentation',
  chore: 'Chores',
  test: 'Tests',
  feat: 'Features',
  fix: 'Bug Fixes',
  perf: 'Performance',
  refactor: 'Refactoring',
  style: 'Styles',
  build: 'Build',
  ci: 'CI',
  revert: 'Reverts',
};

export interface LabelContext {
  trigger: 'commit' | 'label';
  skip: boolean;
  bumpLabel?: string;
  noBumpLabel: boolean;
  bumpConflict?: boolean;
  prereleaseConflict?: boolean;
  prerelease?: boolean;
  stable?: boolean;
  labels?: {
    stable: string;
    prerelease: string;
    skip: string;
    major: string;
    minor: string;
    patch: string;
  };
  scopeLabels?: string[];
  /**
   * Human-readable reason from the gate's per-PR evaluation when the PR's labels would not
   * trigger a release (e.g. "release:prerelease requires a bump:* label"). When set, the
   * preview banner uses this in place of the generic "No bump label detected" message.
   */
  gateReason?: string;
}

export interface FormatOptions {
  strategy?: ReleaseStrategy;
  standingPrNumber?: number;
  /** Snapshot of the current standing PR (link, manifest, gate state). Rendered when strategy === 'standing-pr'. */
  standingPrSnapshot?: StandingPRSnapshot;
  /** Per-package merge rows combining standing PR + this PR's contribution. Populated only when both exist. */
  mergedRows?: MergedRow[];
  labelContext?: LabelContext;
}

function getNoChangesMessage(strategy: ReleaseStrategy): string {
  switch (strategy) {
    case 'manual':
      return 'Run the release workflow manually if a release is needed.';
    case 'direct':
      return 'Merging this PR will not trigger a release.';
    case 'standing-pr':
      return 'Merging this PR will not affect the release PR.';
    case 'scheduled':
      return 'These changes will not be included in the next scheduled release.';
    default:
      return '';
  }
}

function getIntroMessage(strategy: ReleaseStrategy, standingPrNumber?: number): string {
  switch (strategy) {
    case 'direct':
      return 'This PR will trigger the following release when merged:';
    case 'standing-pr':
      return standingPrNumber
        ? `These changes will be added to the release PR (#${standingPrNumber}) when merged:`
        : 'Merging this PR will create a new release PR with the following changes:';
    case 'scheduled':
      return 'These changes will be included in the next scheduled release:';
    default:
      return 'If released, this PR would include:';
  }
}

function getLabelBanner(labelContext?: LabelContext): string[] {
  if (!labelContext) return [];

  const lines: string[] = [];

  // Add scope label info if present
  if (labelContext.scopeLabels && labelContext.scopeLabels.length > 0) {
    lines.push(`> **Scope:** ${labelContext.scopeLabels.join(', ')}`, '');
  }

  if (labelContext.trigger === 'commit') {
    if (labelContext.skip) {
      lines.push('> **Warning:** This PR is marked to skip release.', '');
      return lines;
    }
    if (labelContext.bumpLabel === 'major') {
      lines.push('> **Important:** This PR is labeled for a **major** release.', '');
      return lines;
    }
  }

  // Show prereleaseConflict error regardless of trigger mode
  if (labelContext.prereleaseConflict) {
    const labels = labelContext.labels;
    const stableLabel = labels?.stable ?? 'release:stable';
    const prereleaseLabel = labels?.prerelease ?? 'release:prerelease';
    lines.push(
      '> **Error:** Conflicting release type labels detected.',
      `> **Note:** Please use only one of \`${stableLabel}\` or \`${prereleaseLabel}\` at a time.`,
      '',
    );
    return lines;
  }

  if (labelContext.trigger === 'label') {
    if (labelContext.bumpConflict) {
      const labels = labelContext.labels;
      const labelExamples = labels
        ? `\`${labels.patch}\`, \`${labels.minor}\`, or \`${labels.major}\``
        : 'a bump label (e.g., `bump:patch`, `bump:minor`, `bump:major`)';
      lines.push(
        '> **Error:** Conflicting bump labels detected.',
        `> **Note:** Please use only one release label at a time. Use ${labelExamples}.`,
        '',
      );
      return lines;
    }
    if (labelContext.noBumpLabel) {
      const labels = labelContext.labels;
      const labelExamples = labels
        ? `\`${labels.patch}\`, \`${labels.minor}\`, or \`${labels.major}\``
        : 'a bump label (e.g., `bump:patch`, `bump:minor`, `bump:major`)';
      lines.push('> No bump label detected.');
      if (labelContext.gateReason) {
        lines.push(`> **Reason:** ${labelContext.gateReason}`);
      }
      lines.push(`> **Note:** Add ${labelExamples} to trigger a release.`, '');
      return lines;
    }

    if (labelContext.bumpLabel) {
      const parts: string[] = [labelContext.bumpLabel];
      if (labelContext.prerelease) {
        parts.push('prerelease');
      }
      if (labelContext.stable) {
        parts.push('stable');
      }
      const labelText = parts.join(' ');
      lines.push(`> This PR is labeled for a **${labelText}** release.`, '');
      return lines;
    }

    // Only a channel modifier label is present (no bump label)
    if (labelContext.stable) {
      lines.push('> This PR is labeled for a **stable** release (graduation from prerelease).', '');
      return lines;
    }
    if (labelContext.prerelease) {
      // release:prerelease modifier set, bump driven by conventional commits
      lines.push('> This PR is labeled for a **prerelease** release (bump from conventional commits).', '');
      return lines;
    }
  }

  return lines;
}

export function formatPreviewComment(result: ReleaseOutput | null, options?: FormatOptions): string {
  const strategy = options?.strategy ?? 'direct';
  const labelContext = options?.labelContext;
  const standingPrSnapshot = strategy === 'standing-pr' ? options?.standingPrSnapshot : undefined;
  const mergedRows = strategy === 'standing-pr' ? options?.mergedRows : undefined;
  const lines: string[] = [MARKER, ''];

  // Standing PR snapshot lives OUTSIDE the collapsible details so reviewers always see what's
  // currently queued for release without having to expand the per-PR analysis.
  if (standingPrSnapshot) {
    lines.push(...renderStandingPRSnapshot(standingPrSnapshot));
  }

  // Insert label-driven banner (outside the details block)
  const banner = getLabelBanner(labelContext);

  if (!result) {
    const summary = standingPrSnapshot
      ? '<summary><b>Release Preview</b> — this PR contributes no changes</summary>'
      : '<summary><b>Release Preview</b> — no release</summary>';
    lines.push('<details>', summary, '');
    lines.push(...banner);
    if (!labelContext?.noBumpLabel) {
      lines.push(`> **Note:** No releasable changes detected. ${getNoChangesMessage(strategy)}`);
    }
    if (standingPrSnapshot) {
      lines.push(...renderQueuedTable(standingPrSnapshot));
    }
    lines.push('', '---', FOOTER, '</details>');
    return lines.join('\n');
  }

  const { versionOutput } = result;
  const pkgCount = versionOutput.updates.length;
  const pkgSummary =
    pkgCount === 1
      ? `${versionOutput.updates[0]?.packageName} ${versionOutput.updates[0]?.newVersion}`
      : `${pkgCount} packages`;

  lines.push('<details>', `<summary><b>Release Preview</b> — ${pkgSummary}</summary>`, '');
  lines.push(...banner);
  lines.push(getIntroMessage(strategy, options?.standingPrNumber), '');

  // Package updates table
  lines.push('### Packages', '');
  lines.push('| Package | Version |', '|---------|---------|');
  for (const update of versionOutput.updates) {
    lines.push(`| \`${update.packageName}\` | ${update.newVersion} |`);
  }
  lines.push('');

  // Changelog section
  const sharedEntries = versionOutput.sharedEntries?.length ? versionOutput.sharedEntries : undefined;
  const hasPackageChangelogs = versionOutput.changelogs.some((cl) => cl.entries.length > 0);

  if (sharedEntries || hasPackageChangelogs) {
    lines.push('### Changelog', '');

    // Project-wide entries (CI, infra, shared-package commits) rendered once
    if (sharedEntries) {
      lines.push('<details>', '<summary><b>Project-wide changes</b></summary>', '');
      lines.push(...renderEntries(sharedEntries));
      lines.push('</details>', '');
    }

    // Per-package entries — only rendered when the package has unique changes
    for (const changelog of versionOutput.changelogs) {
      if (changelog.entries.length > 0) {
        lines.push(...formatPackageChangelog(changelog));
      }
    }
  }

  // Tags
  if (versionOutput.tags.length > 0) {
    lines.push('### Tags', '');
    for (const tag of versionOutput.tags) {
      lines.push(`- \`${tag}\``);
    }
    lines.push('');
  }

  if (mergedRows && mergedRows.length > 0) {
    lines.push(...renderMergeTable(mergedRows));
  }

  lines.push('---', FOOTER, '</details>');
  return lines.join('\n');
}

function renderStandingPRSnapshot(snapshot: StandingPRSnapshot): string[] {
  const updates = snapshot.manifest.versionOutput.updates;
  const pkgCount = updates.length;
  const gateBadge = snapshot.gateState === 'pending' ? `⏳ ${snapshot.gateReason}` : '✅ ready to merge';
  const ageMs = Math.max(0, Date.now() - new Date(snapshot.openedAt).getTime());
  const ageStr = formatDuration(ageMs);
  const pkgWord = pkgCount === 1 ? 'package' : 'packages';
  return [
    `**Standing release PR:** [#${snapshot.number}](${snapshot.url}) · ${pkgCount} ${pkgWord} queued · open ${ageStr} · ${gateBadge}`,
    '',
  ];
}

function renderQueuedTable(snapshot: StandingPRSnapshot): string[] {
  const changelogs = snapshot.manifest.versionOutput.changelogs.filter((cl) => cl.entries.length > 0);
  if (changelogs.length === 0) return [];
  const lines: string[] = [
    '',
    '### Currently queued for release',
    '',
    '| Package | Current | Next |',
    '|---------|---------|------|',
  ];
  for (const cl of changelogs) {
    lines.push(`| \`${cl.packageName}\` | ${cl.previousVersion ?? '—'} | ${cl.version} |`);
  }
  lines.push('');
  return lines;
}

function renderMergeTable(rows: MergedRow[]): string[] {
  const lines: string[] = [
    '### After merge — predicted release',
    '',
    '> Approximate. The standing PR rebuilds against `main` at merge time; if other commits land first, the prediction may shift.',
    '',
    '| Package | Standing PR | This PR | After merge |',
    '|---------|-------------|---------|-------------|',
  ];
  for (const row of rows) {
    const standing = row.standing ?? '—';
    const current = row.current ?? '—';
    let afterCell = row.afterMerge;
    if (row.status === 'escalated' && row.standing) afterCell += ` ⚠ escalated from ${row.standing}`;
    if (row.status === 'new-from-pr') afterCell += ' (new)';
    lines.push(`| \`${row.packageName}\` | ${standing} | ${current} | ${afterCell} |`);
  }
  lines.push('');
  return lines;
}

function renderEntries(entries: VersionChangelogEntry[]): string[] {
  const lines: string[] = [];
  const grouped = new Map<string, VersionChangelogEntry[]>();
  for (const entry of entries) {
    if (!grouped.has(entry.type)) grouped.set(entry.type, []);
    grouped.get(entry.type)?.push(entry);
  }
  const renderedTypes = new Set<string>();
  for (const type of Object.keys(TYPE_LABELS)) {
    const group = grouped.get(type);
    if (group && group.length > 0) {
      lines.push(...formatEntryGroup(type, group));
      renderedTypes.add(type);
    }
  }
  for (const [type, group] of grouped) {
    if (!renderedTypes.has(type) && group.length > 0) {
      lines.push(...formatEntryGroup(type, group));
    }
  }
  return lines;
}

function formatPackageChangelog(changelog: VersionPackageChangelog): string[] {
  const lines: string[] = [];
  const prevVersion = changelog.previousVersion ?? 'N/A';
  const summary = `<b>${changelog.packageName}</b> ${prevVersion} → ${changelog.version}`;

  lines.push('<details>', `<summary>${summary}</summary>`, '');
  lines.push(...renderEntries(changelog.entries));
  lines.push('</details>', '');
  return lines;
}

function formatEntryGroup(
  type: string,
  entries: { description: string; scope?: string; issueIds?: string[] }[],
): string[] {
  const label = TYPE_LABELS[type] ?? capitalize(type);
  const lines: string[] = [`#### ${label}`, ''];

  for (const entry of entries) {
    let line = `- ${entry.description}`;
    if (entry.scope) {
      line += ` (\`${entry.scope}\`)`;
    }
    if (entry.issueIds && entry.issueIds.length > 0) {
      line += ` ${entry.issueIds.join(', ')}`;
    }
    lines.push(line);
  }

  lines.push('');
  return lines;
}

function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
