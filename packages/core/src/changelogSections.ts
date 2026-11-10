export const BREAKING_SECTION = 'Breaking';

/** Several types fold onto one label (feat/added → Added), so entries group by label, not raw type. */
const CHANGELOG_TYPE_LABELS: Record<string, string> = {
  feat: 'Added',
  fix: 'Fixed',
  added: 'Added',
  changed: 'Changed',
  deprecated: 'Deprecated',
  removed: 'Removed',
  fixed: 'Fixed',
  perf: 'Performance',
  refactor: 'Refactored',
  security: 'Security',
  docs: 'Documentation',
  chore: 'Chores',
  test: 'Tests',
  build: 'Build',
  ci: 'CI',
  revert: 'Reverts',
  style: 'Styles',
};

export const CHANGELOG_LABEL_ORDER: readonly string[] = [...new Set(Object.values(CHANGELOG_TYPE_LABELS))];

export function changelogTypeLabel(type: string): string {
  return CHANGELOG_TYPE_LABELS[type] ?? type.charAt(0).toUpperCase() + type.slice(1);
}

export interface ChangelogSection<T> {
  label: string;
  items: T[];
}

/**
 * Breaking entries lead under {@link BREAKING_SECTION}, out of their type group; the rest group by type label in
 * `labelOrder`, then any other label in first-seen order. Empty sections are omitted.
 */
export function groupChangelogSections<T>(
  items: readonly T[],
  entryOf: (item: T) => { type: string; breaking?: boolean },
  labelOrder: readonly string[] = CHANGELOG_LABEL_ORDER,
): ChangelogSection<T>[] {
  const breaking: T[] = [];
  const byLabel = new Map<string, T[]>();
  for (const item of items) {
    const entry = entryOf(item);
    if (entry.breaking) {
      breaking.push(item);
      continue;
    }
    const label = changelogTypeLabel(entry.type);
    const list = byLabel.get(label);
    if (list) {
      list.push(item);
    } else {
      byLabel.set(label, [item]);
    }
  }

  const sections: ChangelogSection<T>[] = [];
  if (breaking.length > 0) {
    sections.push({ label: BREAKING_SECTION, items: breaking });
  }
  for (const label of labelOrder) {
    const list = byLabel.get(label);
    if (list) {
      sections.push({ label, items: list });
      byLabel.delete(label);
    }
  }
  for (const [label, list] of byLabel) {
    sections.push({ label, items: list });
  }
  return sections;
}
