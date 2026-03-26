import type { VersionChangelogEntry, VersionPackageChangelog } from '@releasekit/core';
import type { ReleaseOutput } from './types.js';

export type ReleaseStrategy = 'manual' | 'direct' | 'standing-pr' | 'scheduled';

const MARKER = '<!-- releasekit-preview -->';
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
  labels?: {
    stable: string;
    prerelease: string;
    skip: string;
    major: string;
    minor: string;
    patch: string;
  };
}

export interface FormatOptions {
  strategy?: ReleaseStrategy;
  standingPrNumber?: number;
  labelContext?: LabelContext;
}

function getNoChangesMessage(strategy: ReleaseStrategy): string {
  switch (strategy) {
    case 'manual':
      return '> No releasable changes detected. Run the release workflow manually if a release is needed.';
    case 'direct':
      return '> No releasable changes detected. Merging this PR will not trigger a release.';
    case 'standing-pr':
      return '> No releasable changes detected. Merging this PR will not affect the release PR.';
    case 'scheduled':
      return '> No releasable changes detected. These changes will not be included in the next scheduled release.';
    default:
      return '> No releasable changes detected.';
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

  if (labelContext.trigger === 'commit') {
    if (labelContext.skip) {
      return ['> **Warning:** This PR is marked to skip release.', ''];
    }
    if (labelContext.bumpLabel === 'major') {
      return ['> **Important:** This PR is labeled for a **major** release.', ''];
    }
  }

  if (labelContext.trigger === 'label') {
    if (labelContext.noBumpLabel) {
      const labels = labelContext.labels;
      const labelExamples = labels
        ? `\`${labels.patch}\`, \`${labels.minor}\`, or \`${labels.major}\``
        : 'a release label (e.g., `release:patch`, `release:minor`, `release:major`)';
      return ['> No release label detected.', `> **Note:** Add ${labelExamples} to trigger a release.`, ''];
    }
    if (labelContext.bumpLabel) {
      return [`> This PR is labeled for a **${labelContext.bumpLabel}** release.`, ''];
    }
  }

  return [];
}

export function formatPreviewComment(result: ReleaseOutput | null, options?: FormatOptions): string {
  const strategy = options?.strategy ?? 'direct';
  const labelContext = options?.labelContext;
  const lines: string[] = [MARKER, ''];

  // Insert label-driven banner (outside the details block)
  const banner = getLabelBanner(labelContext);

  if (!result) {
    // No changes or noBumpLabel — simple collapsed comment
    lines.push('<details>', '<summary><b>Release Preview</b> — no release</summary>', '');
    lines.push(...banner);
    if (!labelContext?.noBumpLabel) {
      lines.push('> **Note:**', getNoChangesMessage(strategy));
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

  lines.push('---', FOOTER, '</details>');
  return lines.join('\n');
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

export { MARKER };
