import {
  type ChangelogRefsMode,
  escapeChangelogMentions,
  neutralizeDescriptionRefs,
  renderIssueRefs,
  type VersionChangelogEntry,
  type VersionPackageChangelog,
} from '@releasekit/core';
import { ATTRIBUTION_FOOTER } from '../attribution.js';
import { formatDuration } from '../duration.js';
import { MARKER } from '../github.js';
import type { StandingPRSnapshot } from '../standing-pr/standing-pr.js';
import type { ReleaseOutput } from '../types.js';
import { publishableUpdates, syncVersionDisplay, syncVersionRange, toDisplayVersion } from '../version-display.js';
import type { MergedRow } from './merge.js';

export type ReleaseStrategy = 'manual' | 'direct' | 'standing-pr';

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
    graduate: string;
    prerelease: string;
    skip: string;
    immediate: string;
    major: string;
    minor: string;
    patch: string;
  };
  scopeLabels?: string[];
  gateReason?: string;
  advisoryInStandingPr?: boolean;
  immediate?: boolean;
}

export interface FormatOptions {
  strategy?: ReleaseStrategy;
  standingPrNumber?: number;
  standingPrSnapshot?: StandingPRSnapshot;
  mergedRows?: MergedRow[];
  labelContext?: LabelContext;
  supersedeWarning?: string[];
  refs?: ChangelogRefsMode;
}

function getNoChangesMessage(strategy: ReleaseStrategy): string {
  switch (strategy) {
    case 'manual':
      return 'Run the release workflow manually if a release is needed.';
    case 'direct':
      return 'Merging this PR will not trigger a release.';
    case 'standing-pr':
      return 'Merging this PR will not affect the release PR.';
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
    default:
      return 'If released, this PR would include:';
  }
}

function getLabelBanner(labelContext?: LabelContext): string[] {
  if (!labelContext) {
    return [];
  }

  const lines: string[] = [];

  // A direct release, so the other banners would only confuse.
  if (labelContext.immediate) {
    const immediateLabel = labelContext.labels?.immediate ?? 'release:immediate';

    const descriptor: string[] = [];
    const sources: string[] = [];

    if (
      labelContext.bumpLabel === 'major' ||
      labelContext.bumpLabel === 'minor' ||
      labelContext.bumpLabel === 'patch'
    ) {
      descriptor.push(labelContext.bumpLabel);
      const bumpLabelName = labelContext.labels?.[labelContext.bumpLabel];
      if (bumpLabelName) {
        sources.push(`\`${bumpLabelName}\``);
      }
    }
    if (labelContext.prerelease) {
      descriptor.push('prerelease');
      sources.push(`\`${labelContext.labels?.prerelease ?? 'channel:prerelease'}\``);
    }
    if (labelContext.stable) {
      descriptor.push('stable');
      sources.push(`\`${labelContext.labels?.graduate ?? 'release:graduate'}\``);
    }

    const releasePart = descriptor.length > 0 ? `**${descriptor.join(' ')}** release` : 'release';

    const annotations: string[] = [];
    annotations.push(sources.length > 0 ? `from ${sources.join(', ')}` : 'bump derived from conventional commits');
    if (labelContext.scopeLabels && labelContext.scopeLabels.length > 0) {
      annotations.push(`scope: ${labelContext.scopeLabels.map((s) => `\`${s}\``).join(', ')}`);
    }

    lines.push(
      `> **\`${immediateLabel}\`** — bypassing the standing PR for a direct ${releasePart} (${annotations.join('; ')}).`,
      '',
    );
    return lines;
  }

  if (labelContext.advisoryInStandingPr) {
    const seen: string[] = [];
    if (labelContext.bumpLabel) {
      seen.push(`\`bump:${labelContext.bumpLabel}\``);
    }
    if (labelContext.scopeLabels?.length) {
      seen.push(...labelContext.scopeLabels.map((s) => `\`${s}\``));
    }
    if (labelContext.stable) {
      seen.push(`\`${labelContext.labels?.graduate ?? 'release:graduate'}\``);
    }
    if (labelContext.prerelease) {
      seen.push(`\`${labelContext.labels?.prerelease ?? 'channel:prerelease'}\``);
    }
    const seenStr = seen.length ? ` (saw: ${seen.join(', ')})` : '';
    const immediateLabel = labelContext.labels?.immediate ?? 'release:immediate';
    lines.push(
      `> **Note:** Labels on this PR are advisory in standing-pr mode${seenStr}. Bumps come from conventional commits in the standing PR; override by editing labels on the standing PR itself. Add \`${immediateLabel}\` to bypass the standing PR and release this PR directly.`,
      '',
    );
    return lines;
  }

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

  if (labelContext.prereleaseConflict) {
    const labels = labelContext.labels;
    const graduateLabel = labels?.graduate ?? 'release:graduate';
    const prereleaseLabel = labels?.prerelease ?? 'channel:prerelease';
    lines.push(
      '> **Error:** Conflicting release type labels detected.',
      `> **Note:** Please use only one of \`${graduateLabel}\` or \`${prereleaseLabel}\` at a time.`,
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

    if (labelContext.stable) {
      lines.push('> This PR is labeled for a **stable** release (graduation from prerelease).', '');
      return lines;
    }
    if (labelContext.prerelease) {
      lines.push('> This PR is labeled for a **prerelease** release (bump from conventional commits).', '');
      return lines;
    }
  }

  return lines;
}

export function formatPreviewComment(result: ReleaseOutput | null, options?: FormatOptions): string {
  const strategy = options?.strategy ?? 'direct';
  const labelContext = options?.labelContext;
  const showStandingPrContext = strategy === 'standing-pr' && !labelContext?.immediate;
  const standingPrSnapshot = showStandingPrContext ? options?.standingPrSnapshot : undefined;
  const mergedRows = showStandingPrContext ? options?.mergedRows : undefined;
  const lines: string[] = [MARKER, ''];

  // The supersede warning and snapshot sit outside the details block so they're always visible.
  if (showStandingPrContext && options?.supersedeWarning && options.supersedeWarning.length > 0) {
    lines.push(...options.supersedeWarning);
  }

  if (standingPrSnapshot) {
    lines.push(...renderStandingPRSnapshot(standingPrSnapshot));
  }

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
    lines.push('', '---', ATTRIBUTION_FOOTER, '</details>');
    return lines.join('\n');
  }

  const { versionOutput } = result;
  const isSync = versionOutput.strategy === 'sync';
  const pkgCount = versionOutput.updates.length;
  // A package count would include the root lockstep bump, so sync leads with the version range.
  let pkgSummary: string;
  if (isSync) {
    pkgSummary = syncVersionRange(versionOutput);
  } else if (pkgCount === 1) {
    const only = versionOutput.updates[0];
    // `action` is absent on manifests that predate it.
    const annotation = only?.action ? ` (${only.action})` : '';
    pkgSummary = `${only?.packageName} ${only?.newVersion}${annotation}`;
  } else {
    pkgSummary = `${pkgCount} packages`;
  }

  lines.push('<details>', `<summary><b>Release Preview</b> — ${pkgSummary}</summary>`, '');
  lines.push(...banner);
  const effectiveStrategy = labelContext?.immediate ? 'direct' : strategy;
  lines.push(getIntroMessage(effectiveStrategy, options?.standingPrNumber), '');

  const refs = options?.refs ?? 'link';
  // All packages share one repo, so any changelog's repoUrl serves the shared entries.
  const sharedRepoUrl = versionOutput.changelogs.find((cl) => cl.repoUrl)?.repoUrl ?? null;
  const sharedEntries = versionOutput.sharedEntries?.length ? versionOutput.sharedEntries : undefined;
  // An all-synthetic changelog (a lockstep carry with no commits) collapses into the "Also bumped" list below.
  const hasRealEntries = (cl: VersionPackageChangelog) => cl.entries.some((e) => !e.synthetic);
  const hasPackageChangelogs = versionOutput.changelogs.some(hasRealEntries);

  const packagesWithChangelog = new Set(versionOutput.changelogs.filter(hasRealEntries).map((cl) => cl.packageName));
  const syncBumpedOnly = versionOutput.updates.filter((u) => !u.isRoot && !packagesWithChangelog.has(u.packageName));

  if (sharedEntries || hasPackageChangelogs || syncBumpedOnly.length > 0) {
    // Only content is blockquoted: GitHub renders a `> `-prefixed raw-HTML block (the disclosure tags) unreliably.
    lines.push('### Changelog', '');

    if (sharedEntries) {
      lines.push('<details>', '<summary><b>Project-wide changes</b></summary>', '');
      lines.push(...blockquote(renderEntries(sharedEntries, refs, sharedRepoUrl)));
      lines.push('', '</details>', '');
    }

    for (const changelog of versionOutput.changelogs) {
      if (hasRealEntries(changelog)) {
        lines.push(...formatPackageChangelog(changelog, refs));
      }
    }

    if (syncBumpedOnly.length > 0) {
      const bumped: string[] = [];
      if (isSync) {
        const syncListed = syncBumpedOnly;
        if (syncListed.length > 0) {
          const coversAll = syncListed.length === publishableUpdates(versionOutput).length;
          const heading = coversAll ? 'All packages' : 'Also bumped';
          bumped.push(`**${heading} → ${syncListed[0]?.newVersion}** (sync versioning)`, '');
          for (const u of syncListed) {
            bumped.push(`- \`${u.packageName}\``);
          }
        }
      } else {
        if (hasPackageChangelogs || sharedEntries) {
          bumped.push('**Also bumped** (sync versioning)', '');
        } else {
          bumped.push('**Bumped** (sync versioning — no individual changes)', '');
        }
        for (const u of syncBumpedOnly) {
          bumped.push(`- \`${u.packageName}\` → ${u.newVersion}`);
        }
      }
      if (bumped.length > 0) {
        lines.push(...blockquote(bumped), '');
      }
    }
  }

  if (mergedRows && mergedRows.length > 0) {
    lines.push(...renderMergeTable(mergedRows));
  }

  lines.push('---', ATTRIBUTION_FOOTER, '</details>');
  return lines.join('\n');
}

function renderStandingPRSnapshot(snapshot: StandingPRSnapshot): string[] {
  const versionOutput = snapshot.manifest.versionOutput;
  const gateBadge = snapshot.gateState === 'pending' ? `⏳ ${snapshot.gateReason ?? 'pending'}` : '✅ ready to merge';
  const ageMs = Math.max(0, Date.now() - new Date(snapshot.openedAt).getTime());
  const ageStr = formatDuration(ageMs);

  let queuedSummary: string;
  if (versionOutput.strategy === 'sync') {
    // Sync emits one aggregated changelog, so counting changelogs would always say "1 package".
    const pkgCount = publishableUpdates(versionOutput).length;
    const pkgPart = pkgCount > 0 ? ` (${pkgCount} ${pkgCount === 1 ? 'package' : 'packages'})` : '';
    queuedSummary = `${syncVersionDisplay(versionOutput)} queued${pkgPart}`;
  } else {
    const pkgCount = versionOutput.changelogs.filter(
      (cl) => cl.entries.length > 0 || cl.version !== cl.previousVersion,
    ).length;
    queuedSummary = `${pkgCount} ${pkgCount === 1 ? 'package' : 'packages'} queued`;
  }

  return [
    `**Standing release PR:** [#${snapshot.number}](${snapshot.url}) · ${queuedSummary} · open ${ageStr} · ${gateBadge}`,
    '',
  ];
}

function renderQueuedTable(snapshot: StandingPRSnapshot): string[] {
  const changelogs = snapshot.manifest.versionOutput.changelogs.filter(
    (cl) => cl.entries.length > 0 || cl.version !== cl.previousVersion,
  );
  if (changelogs.length === 0) {
    return [];
  }
  const lines: string[] = [
    '',
    '### Currently queued for release',
    '',
    '| Package | Current | Next |',
    '|---------|---------|------|',
  ];
  for (const cl of changelogs) {
    lines.push(
      `| \`${cl.packageName}\` | ${cl.previousVersion ? toDisplayVersion(cl.previousVersion) : '—'} | ${cl.version} |`,
    );
  }
  lines.push('');
  return lines;
}

function renderMergeTable(rows: MergedRow[]): string[] {
  // 'standing-only' rows are queued content unrelated to this PR; counting them would always suppress the message.
  const prParticipatingRows = rows.filter((r) => r.status !== 'standing-only');
  const allUnchanged = prParticipatingRows.length > 0 && prParticipatingRows.every((r) => r.status === 'unchanged');
  const outsideScope = prParticipatingRows.length === 0;

  if (allUnchanged || outsideScope) {
    const prose = outsideScope
      ? "> This PR's packages are outside the standing PR's current scope — they will be picked up when the standing PR rebuilds after merge."
      : "> No version escalation — this PR's changes will be included in the queued release without affecting the projected versions.";
    const lines: string[] = ['### After merge — predicted release', '', prose, ''];
    if (rows.length > 0) {
      lines.push(
        '| Package | Standing PR | This PR | After merge |',
        '|---------|-------------|---------|-------------|',
      );
      for (const row of rows) {
        lines.push(`| \`${row.packageName}\` | ${row.standing ?? '—'} | ${row.current ?? '—'} | ${row.afterMerge} |`);
      }
      lines.push('');
    }
    return lines;
  }

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
    if (row.status === 'escalated' && row.standing) {
      afterCell += ` ⚠ escalated from ${row.standing}`;
    }
    if (row.status === 'new-from-pr') {
      afterCell += ' (new)';
    }
    lines.push(`| \`${row.packageName}\` | ${standing} | ${current} | ${afterCell} |`);
  }
  lines.push('');
  return lines;
}

function renderEntries(entries: VersionChangelogEntry[], refs: ChangelogRefsMode, repoUrl: string | null): string[] {
  const lines: string[] = [];
  const grouped = new Map<string, VersionChangelogEntry[]>();
  for (const entry of entries) {
    if (!grouped.has(entry.type)) {
      grouped.set(entry.type, []);
    }
    grouped.get(entry.type)?.push(entry);
  }
  const renderedTypes = new Set<string>();
  for (const type of Object.keys(TYPE_LABELS)) {
    const group = grouped.get(type);
    if (group && group.length > 0) {
      lines.push(...formatEntryGroup(type, group, refs, repoUrl));
      renderedTypes.add(type);
    }
  }
  for (const [type, group] of grouped) {
    if (!renderedTypes.has(type) && group.length > 0) {
      lines.push(...formatEntryGroup(type, group, refs, repoUrl));
    }
  }
  return lines;
}

function formatPackageChangelog(changelog: VersionPackageChangelog, refs: ChangelogRefsMode): string[] {
  const lines: string[] = [];
  const prevVersion = changelog.previousVersion ? toDisplayVersion(changelog.previousVersion) : 'N/A';
  const summary = `<b>${changelog.packageName}</b> ${prevVersion} → ${changelog.version}`;

  lines.push('<details>', `<summary>${summary}</summary>`, '');
  lines.push(...blockquote(renderEntries(changelog.entries, refs, changelog.repoUrl)));
  lines.push('', '</details>', '');
  return lines;
}

function formatEntryGroup(
  type: string,
  entries: { description: string; scope?: string; issueIds?: string[]; prNumber?: string; breaking?: boolean }[],
  refs: ChangelogRefsMode,
  repoUrl: string | null,
): string[] {
  const label = TYPE_LABELS[type] ?? capitalize(type);
  const lines: string[] = [`#### ${label}`, ''];

  for (const entry of entries) {
    // The scope is backticked, so only the description needs mention escaping. Bare `#N` refs from the commit
    // subject are de-duped against the appended refs.
    const appendedRefs = [...(entry.issueIds ?? []), entry.prNumber];
    const description = escapeChangelogMentions(
      neutralizeDescriptionRefs(entry.description, appendedRefs, refs, repoUrl),
    );
    let line = `- ${entry.breaking ? '**BREAKING** ' : ''}${description}`;
    if (entry.scope) {
      line += ` (\`${entry.scope}\`)`;
    }
    // renderIssueRefs includes its own parens.
    const renderedRefs = renderIssueRefs(entry.issueIds ?? [], refs, repoUrl, entry.prNumber);
    if (renderedRefs) {
      line += ` ${renderedRefs}`;
    }
    lines.push(line);
  }

  lines.push('');
  return lines;
}

function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/** Blank lines keep a bare `>` so the quote stays one contiguous block. */
function blockquote(lines: string[]): string[] {
  const trimmed = [...lines];
  while (trimmed.length > 0 && trimmed[trimmed.length - 1] === '') {
    trimmed.pop();
  }
  return trimmed.map((l) => (l.length > 0 ? `> ${l}` : '>'));
}
