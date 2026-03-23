import type { VersionPackageChangelog } from '@releasekit/core';
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
}

export interface FormatOptions {
  strategy?: ReleaseStrategy;
  standingPrNumber?: number;
  labelContext?: LabelContext;
}

function getNoChangesMessage(strategy: ReleaseStrategy): string {
  switch (strategy) {
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
      return ['> [!WARNING]', '> This PR is marked to skip release.', ''];
    }
    if (labelContext.bumpLabel === 'major') {
      return ['> [!IMPORTANT]', '> This PR is labeled for a **major** release.', ''];
    }
  }

  if (labelContext.trigger === 'label') {
    if (labelContext.noBumpLabel) {
      return [
        '> [!NOTE]',
        '> No release label detected. Add a `release:patch`, `release:minor`, or `release:major` label to trigger a release.',
        '',
      ];
    }
    if (labelContext.bumpLabel) {
      return ['> [!NOTE]', `> This PR is labeled for a **${labelContext.bumpLabel}** release.`, ''];
    }
  }

  return [];
}

export function formatPreviewComment(result: ReleaseOutput | null, options?: FormatOptions): string {
  const strategy = options?.strategy ?? 'manual';
  const labelContext = options?.labelContext;
  const lines: string[] = [MARKER, '', '## Release Preview', ''];

  // Insert label-driven banner
  lines.push(...getLabelBanner(labelContext));

  // Label mode with no bump label — early return
  if (labelContext?.noBumpLabel) {
    lines.push('', '---', FOOTER);
    return lines.join('\n');
  }

  if (!result) {
    lines.push('> [!NOTE]', getNoChangesMessage(strategy));
    lines.push('', '---', FOOTER);
    return lines.join('\n');
  }

  const { versionOutput } = result;

  lines.push(getIntroMessage(strategy, options?.standingPrNumber), '');

  // Package updates table
  lines.push('### Packages', '');
  lines.push('| Package | Version |', '|---------|---------|');
  for (const update of versionOutput.updates) {
    lines.push(`| \`${update.packageName}\` | ${update.newVersion} |`);
  }
  lines.push('');

  // Changelog per package
  if (versionOutput.changelogs.length > 0) {
    lines.push('### Changelog', '');
    for (const changelog of versionOutput.changelogs) {
      lines.push(...formatPackageChangelog(changelog));
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

  lines.push('---', FOOTER);
  return lines.join('\n');
}

function formatPackageChangelog(changelog: VersionPackageChangelog): string[] {
  const lines: string[] = [];
  const prevVersion = changelog.previousVersion ?? 'N/A';
  const summary = `<b>${changelog.packageName}</b> ${prevVersion} → ${changelog.version}`;

  lines.push('<details>', `<summary>${summary}</summary>`, '');

  // Group entries by type
  const grouped = new Map<string, typeof changelog.entries>();
  for (const entry of changelog.entries) {
    const type = entry.type;
    if (!grouped.has(type)) {
      grouped.set(type, []);
    }
    grouped.get(type)?.push(entry);
  }

  // Render known types first in a stable order, then any unknown types
  const renderedTypes = new Set<string>();

  for (const type of Object.keys(TYPE_LABELS)) {
    const entries = grouped.get(type);
    if (entries && entries.length > 0) {
      lines.push(...formatEntryGroup(type, entries));
      renderedTypes.add(type);
    }
  }

  // Any remaining types not in TYPE_LABELS
  for (const [type, entries] of grouped) {
    if (!renderedTypes.has(type) && entries.length > 0) {
      lines.push(...formatEntryGroup(type, entries));
    }
  }

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
