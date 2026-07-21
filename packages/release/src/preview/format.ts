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
  /**
   * Human-readable reason from the gate's per-PR evaluation when the PR's labels would not
   * trigger a release (e.g. "channel:prerelease requires a bump:* label"). When set, the
   * preview banner uses this in place of the generic "No bump label detected" message.
   */
  gateReason?: string;
  /** Standing-pr mode without `release:immediate` — bump/scope/channel labels are advisory only. */
  advisoryInStandingPr?: boolean;
  /** `release:immediate` is on the PR — preview should reflect a direct release, no standing-PR snapshot. */
  immediate?: boolean;
}

export interface FormatOptions {
  strategy?: ReleaseStrategy;
  standingPrNumber?: number;
  /** Snapshot of the current standing PR (link, manifest, gate state). Rendered when strategy === 'standing-pr'. */
  standingPrSnapshot?: StandingPRSnapshot;
  /** Per-package merge rows combining standing PR + this PR's contribution. Populated only when both exist. */
  mergedRows?: MergedRow[];
  labelContext?: LabelContext;
  /**
   * Warning block (rendered lines) shown while a prior release is partially published — gives the
   * maintainer the retry-vs-supersede choice. Populated by runPreview in standing-pr mode.
   */
  supersedeWarning?: string[];
  /** How bare `#NNN` issue/PR refs render in the changelog (`notes.changelog.refs`, default `link`). */
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
  if (!labelContext) return [];

  const lines: string[] = [];

  // `release:immediate` short-circuits all other label semantics — the PR is going to release
  // directly, so the standard banners ("labeled for X", "no bump label", scope) would only confuse.
  if (labelContext.immediate) {
    const immediateLabel = labelContext.labels?.immediate ?? 'release:immediate';

    // Build the descriptor (bump magnitude + channel) and the source-label list in parallel so
    // the banner reads "direct **minor prerelease** release (from `bump:minor`, `channel:prerelease`)"
    // — telling the reader both what will happen and which labels drove the decision.
    const descriptor: string[] = [];
    const sources: string[] = [];

    if (
      labelContext.bumpLabel === 'major' ||
      labelContext.bumpLabel === 'minor' ||
      labelContext.bumpLabel === 'patch'
    ) {
      descriptor.push(labelContext.bumpLabel);
      const bumpLabelName = labelContext.labels?.[labelContext.bumpLabel];
      if (bumpLabelName) sources.push(`\`${bumpLabelName}\``);
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

  // In standing-pr mode without the immediate label, all bump/scope/channel labels are advisory.
  // Show what was seen, point at the override surface (the standing PR) and the bypass label.
  if (labelContext.advisoryInStandingPr) {
    const seen: string[] = [];
    if (labelContext.bumpLabel) seen.push(`\`bump:${labelContext.bumpLabel}\``);
    if (labelContext.scopeLabels?.length) seen.push(...labelContext.scopeLabels.map((s) => `\`${s}\``));
    if (labelContext.stable) seen.push(`\`${labelContext.labels?.graduate ?? 'release:graduate'}\``);
    if (labelContext.prerelease) seen.push(`\`${labelContext.labels?.prerelease ?? 'channel:prerelease'}\``);
    const seenStr = seen.length ? ` (saw: ${seen.join(', ')})` : '';
    const immediateLabel = labelContext.labels?.immediate ?? 'release:immediate';
    lines.push(
      `> **Note:** Labels on this PR are advisory in standing-pr mode${seenStr}. Bumps come from conventional commits in the standing PR; override by editing labels on the standing PR itself. Add \`${immediateLabel}\` to bypass the standing PR and release this PR directly.`,
      '',
    );
    return lines;
  }

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

    // Only a channel modifier label is present (no bump label)
    if (labelContext.stable) {
      lines.push('> This PR is labeled for a **stable** release (graduation from prerelease).', '');
      return lines;
    }
    if (labelContext.prerelease) {
      // channel:prerelease modifier set, bump driven by conventional commits
      lines.push('> This PR is labeled for a **prerelease** release (bump from conventional commits).', '');
      return lines;
    }
  }

  return lines;
}

export function formatPreviewComment(result: ReleaseOutput | null, options?: FormatOptions): string {
  const strategy = options?.strategy ?? 'direct';
  const labelContext = options?.labelContext;
  // In standing-pr mode, the snapshot/merge are suppressed when `release:immediate` is set —
  // the preview is showing a direct-release outcome, not a queued-state outcome.
  const showStandingPrContext = strategy === 'standing-pr' && !labelContext?.immediate;
  const standingPrSnapshot = showStandingPrContext ? options?.standingPrSnapshot : undefined;
  const mergedRows = showStandingPrContext ? options?.mergedRows : undefined;
  const lines: string[] = [MARKER, ''];

  // Partial-publish supersede warning lives OUTSIDE the details block (and above the snapshot) so
  // the maintainer always sees that the prior release is incomplete and what their options are.
  if (showStandingPrContext && options?.supersedeWarning && options.supersedeWarning.length > 0) {
    lines.push(...options.supersedeWarning);
  }

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
    lines.push('', '---', ATTRIBUTION_FOOTER, '</details>');
    return lines.join('\n');
  }

  const { versionOutput } = result;
  const isSync = versionOutput.strategy === 'sync';
  const pkgCount = versionOutput.updates.length;
  // Sync releases move as one unit — lead with the version range rather than a package
  // count (which would misleadingly include the root lockstep bump).
  let pkgSummary: string;
  if (isSync) {
    pkgSummary = syncVersionRange(versionOutput);
  } else if (pkgCount === 1) {
    const only = versionOutput.updates[0];
    // Annotate the resolved version action when present; absent on pre-field manifests.
    const annotation = only?.action ? ` (${only.action})` : '';
    pkgSummary = `${only?.packageName} ${only?.newVersion}${annotation}`;
  } else {
    pkgSummary = `${pkgCount} packages`;
  }

  lines.push('<details>', `<summary><b>Release Preview</b> — ${pkgSummary}</summary>`, '');
  lines.push(...banner);
  const effectiveStrategy = labelContext?.immediate ? 'direct' : strategy;
  lines.push(getIntroMessage(effectiveStrategy, options?.standingPrNumber), '');

  // Changelog section
  // How bare `#NNN` refs render + always-on mention escaping. All packages in a release
  // share one repo, so the first non-null changelog repoUrl governs the project-wide (shared) entries.
  const refs = options?.refs ?? 'link';
  const sharedRepoUrl = versionOutput.changelogs.find((cl) => cl.repoUrl)?.repoUrl ?? null;
  const sharedEntries = versionOutput.sharedEntries?.length ? versionOutput.sharedEntries : undefined;
  // A changelog whose entries are *all* synthetic `Update version to X` placeholders (a sync/
  // lockstep carry with no commits of its own) has nothing real to show — treat it like an empty
  // changelog so the package collapses into the "Also bumped" list below rather than rendering a
  // full block of placeholder noise.
  const hasRealEntries = (cl: VersionPackageChangelog) => cl.entries.some((e) => !e.synthetic);
  const hasPackageChangelogs = versionOutput.changelogs.some(hasRealEntries);

  // Packages carried along by sync versioning (no real changes of their own) are still in updates —
  // collect them so they remain visible as a compact list even though they don't drive the
  // changelog. The root lockstep bump is excluded: it isn't a publishable package, just the
  // workspace root version tracking the release.
  const packagesWithChangelog = new Set(versionOutput.changelogs.filter(hasRealEntries).map((cl) => cl.packageName));
  const syncBumpedOnly = versionOutput.updates.filter((u) => !u.isRoot && !packagesWithChangelog.has(u.packageName));

  if (sharedEntries || hasPackageChangelogs || syncBumpedOnly.length > 0) {
    // The changelog body sets itself apart with a Markdown blockquote (a left vertical bar), but the
    // <details>/<summary>/</details> disclosure tags stay un-quoted — a `> `-prefixed raw-HTML block
    // renders unreliably on GitHub. So each disclosure renders normally and only its inner content (and
    // the plain-markdown "Also bumped" lists) carries the quote bar. The `### Changelog` heading and the
    // `Project-wide changes` summary are likewise un-quoted.
    lines.push('### Changelog', '');

    // Project-wide entries (CI, infra, shared-package commits) rendered once
    if (sharedEntries) {
      lines.push('<details>', '<summary><b>Project-wide changes</b></summary>', '');
      lines.push(...blockquote(renderEntries(sharedEntries, refs, sharedRepoUrl)));
      lines.push('', '</details>', '');
    }

    // Per-package entries — only rendered when the package has real (non-synthetic) changes
    for (const changelog of versionOutput.changelogs) {
      if (hasRealEntries(changelog)) {
        lines.push(...formatPackageChangelog(changelog, refs));
      }
    }

    // List sync-bumped packages that have no individual commits so they aren't invisible
    if (syncBumpedOnly.length > 0) {
      const bumped: string[] = [];
      if (isSync) {
        // Sync mode: every package moves to the same version — say that once in the heading
        // and list bare names (the root lockstep bump is already excluded from syncBumpedOnly).
        const syncListed = syncBumpedOnly;
        if (syncListed.length > 0) {
          // Claim "All packages" only when the list covers every publishable package —
          // packages with their own changelog entries render above and drop out of this list.
          const coversAll = syncListed.length === publishableUpdates(versionOutput).length;
          const heading = coversAll ? 'All packages' : 'Also bumped';
          bumped.push(`**${heading} → ${syncListed[0]?.newVersion}** (sync versioning)`, '');
          for (const u of syncListed) bumped.push(`- \`${u.packageName}\``);
        }
      } else {
        if (hasPackageChangelogs || sharedEntries) bumped.push('**Also bumped** (sync versioning)', '');
        else bumped.push('**Bumped** (sync versioning — no individual changes)', '');
        for (const u of syncBumpedOnly) bumped.push(`- \`${u.packageName}\` → ${u.newVersion}`);
      }
      if (bumped.length > 0) lines.push(...blockquote(bumped), '');
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
    // Sync mode emits a single aggregated changelog, so counting changelogs would always say
    // "1 package" — lead with the queued version instead, with the real package count
    // (excluding the root lockstep bump) as detail.
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
  if (changelogs.length === 0) return [];
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
  // Only rows the current PR participates in ('unchanged' or 'escalated') determine whether the
  // short-circuit message renders. 'standing-only' rows are pre-existing queued content
  // unrelated to this PR — including them would suppress the message in any real scenario.
  const prParticipatingRows = rows.filter((r) => r.status !== 'standing-only');
  const allUnchanged = prParticipatingRows.length > 0 && prParticipatingRows.every((r) => r.status === 'unchanged');
  // When length === 0 the current PR's packages are entirely outside the standing PR's scope —
  // they are NOT yet in the queue and won't be released until the standing PR rebuilds after merge.
  // This needs a different message from allUnchanged (where they ARE already in the queue).
  const outsideScope = prParticipatingRows.length === 0;

  if (allUnchanged || outsideScope) {
    const prose = outsideScope
      ? "> This PR's packages are outside the standing PR's current scope — they will be picked up when the standing PR rebuilds after merge."
      : "> No version escalation — this PR's changes will be included in the queued release without affecting the projected versions.";
    const lines: string[] = ['### After merge — predicted release', '', prose, ''];
    // Show all rows so reviewers can see what's already queued.
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
    if (row.status === 'escalated' && row.standing) afterCell += ` ⚠ escalated from ${row.standing}`;
    if (row.status === 'new-from-pr') afterCell += ' (new)';
    lines.push(`| \`${row.packageName}\` | ${standing} | ${current} | ${afterCell} |`);
  }
  lines.push('');
  return lines;
}

function renderEntries(entries: VersionChangelogEntry[], refs: ChangelogRefsMode, repoUrl: string | null): string[] {
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

  // The disclosure tags stay un-quoted (a `> `-prefixed raw-HTML block renders unreliably on GitHub);
  // only the entry content carries the blockquote bar, after the plain blank line below the summary.
  lines.push('<details>', `<summary>${summary}</summary>`, '');
  lines.push(...blockquote(renderEntries(changelog.entries, refs, changelog.repoUrl)));
  lines.push('', '</details>', '');
  return lines;
}

function formatEntryGroup(
  type: string,
  entries: { description: string; scope?: string; issueIds?: string[]; prNumber?: string }[],
  refs: ChangelogRefsMode,
  repoUrl: string | null,
): string[] {
  const label = TYPE_LABELS[type] ?? capitalize(type);
  const lines: string[] = [`#### ${label}`, ''];

  for (const entry of entries) {
    // Always neutralise `@`-mentions in the description; the scope is already backticked (safe). Bare
    // `#N` refs carried over from the commit subject are neutralised / de-duped against the label.
    const appendedRefs = [...(entry.issueIds ?? []), entry.prNumber];
    let line = `- ${escapeChangelogMentions(neutralizeDescriptionRefs(entry.description, appendedRefs, refs, repoUrl))}`;
    if (entry.scope) {
      line += ` (\`${entry.scope}\`)`;
    }
    // renderIssueRefs returns the complete group including its own parens — append it bare.
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

/** Prefix each line with `> ` (blank lines keep a bare `>`) so the block renders as one contiguous
 *  Markdown blockquote. Trailing blanks are dropped so the quote ends cleanly before the next block. */
function blockquote(lines: string[]): string[] {
  const trimmed = [...lines];
  while (trimmed.length > 0 && trimmed[trimmed.length - 1] === '') trimmed.pop();
  return trimmed.map((l) => (l.length > 0 ? `> ${l}` : '>'));
}
