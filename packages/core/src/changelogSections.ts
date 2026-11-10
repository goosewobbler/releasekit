export const BREAKING_SECTION = 'Breaking';

/** No "shared across packages" descriptor: it isn't reliably true (`Update version to X` is package-specific). */
const DEMOTED_SECTION = 'Dependencies & version bumps';

/**
 * Several types fold onto one label (feat/added → Added), so entries group by label, not raw type. Key order is section
 * order: Keep a Changelog's sections first, as the published changelog lists them.
 */
const CHANGELOG_TYPE_LABELS: Record<string, string> = {
  added: 'Added',
  feat: 'Added',
  changed: 'Changed',
  deprecated: 'Deprecated',
  removed: 'Removed',
  fixed: 'Fixed',
  fix: 'Fixed',
  security: 'Security',
  perf: 'Performance',
  refactor: 'Refactored',
  docs: 'Documentation',
  chore: 'Chores',
  test: 'Tests',
  build: 'Build',
  ci: 'CI',
  revert: 'Reverts',
  style: 'Styles',
};

const CHANGELOG_LABEL_ORDER: readonly string[] = [...new Set(Object.values(CHANGELOG_TYPE_LABELS))];

function changelogTypeLabel(type: string): string {
  // hasOwn: a commit type like `constructor` would otherwise hit Object.prototype.
  return Object.hasOwn(CHANGELOG_TYPE_LABELS, type)
    ? (CHANGELOG_TYPE_LABELS[type] as string)
    : type.charAt(0).toUpperCase() + type.slice(1);
}

interface SectionEntry {
  type: string;
  scope?: string;
  breaking?: boolean;
}

interface GroupChangelogOptions {
  /** Non-breaking entries in these scopes move to a trailing section; a breaking one still leads. */
  demoteScopes?: readonly string[];
}

/**
 * Breaking entries lead under {@link BREAKING_SECTION}, out of their type group; the rest group by type label in
 * section order, then any other label in first-seen order. Empty sections are omitted.
 */
export function groupChangelogSections<T>(
  items: readonly T[],
  entryOf: (item: T) => SectionEntry,
  { demoteScopes = [] }: GroupChangelogOptions = {},
): { label: string; items: T[] }[] {
  const demote = new Set(demoteScopes);
  const breaking: T[] = [];
  const demoted: T[] = [];
  const byLabel = new Map<string, T[]>();
  for (const item of items) {
    const entry = entryOf(item);
    if (entry.breaking) {
      breaking.push(item);
    } else if (entry.scope !== undefined && demote.has(entry.scope)) {
      demoted.push(item);
    } else {
      const label = changelogTypeLabel(entry.type);
      const list = byLabel.get(label);
      if (list) {
        list.push(item);
      } else {
        byLabel.set(label, [item]);
      }
    }
  }

  const sections: { label: string; items: T[] }[] = [];
  if (breaking.length > 0) {
    sections.push({ label: BREAKING_SECTION, items: breaking });
  }
  for (const label of CHANGELOG_LABEL_ORDER) {
    const list = byLabel.get(label);
    if (list) {
      sections.push({ label, items: list });
      byLabel.delete(label);
    }
  }
  for (const [label, list] of byLabel) {
    sections.push({ label, items: list });
  }
  if (demoted.length > 0) {
    sections.push({ label: DEMOTED_SECTION, items: demoted });
  }
  return sections;
}

export function breakingFirst<T extends { breaking?: boolean }>(entries: readonly T[]): T[] {
  const breaking: T[] = [];
  const rest: T[] = [];
  for (const entry of entries) {
    (entry.breaking ? breaking : rest).push(entry);
  }
  return [...breaking, ...rest];
}
