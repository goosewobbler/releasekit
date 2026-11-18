export const BREAKING_SECTION = 'Breaking';

/** No "shared across packages" descriptor: it isn't reliably true (`Update version to X` is package-specific). */
const DEMOTED_SECTION = 'Dependencies & version bumps';

/**
 * Several types fold onto one label (feat/added → Added), so entries group by label, not raw type. Key order is section
 * order: Keep a Changelog's sections first.
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

// Dependabot's default commit scopes.
const DEMOTED_SCOPES: ReadonlySet<string> = new Set(['deps', 'deps-dev']);

interface SectionEntry {
  type: string;
  scope?: string;
  breaking?: boolean;
}

export interface ChangelogSection<T> {
  label: string;
  items: T[];
}

export interface ChangelogCategories<T> {
  categories: readonly { name: string; entries: readonly T[] }[];
  /** Category names in render order. Unlisted categories follow, except Breaking, which leads. */
  order?: readonly string[];
}

/**
 * Breaking entries lead under {@link BREAKING_SECTION}, out of their group. Without `categorized`, the rest group by
 * type label in section order, then any other label in first-seen order, then `deps` and `deps-dev` entries. With it,
 * the rest keep their categories. Empty sections are omitted.
 */
export function groupChangelogSections<T>(
  items: readonly T[],
  entryOf: (item: T) => SectionEntry,
  categorized?: ChangelogCategories<T>,
): ChangelogSection<T>[] {
  if (categorized && categorized.categories.length > 0) {
    return groupByCategory(categorized, entryOf);
  }

  const breaking: T[] = [];
  const demoted: T[] = [];
  const byLabel = new Map<string, T[]>();
  for (const item of items) {
    const entry = entryOf(item);
    if (entry.breaking) {
      breaking.push(item);
    } else if (entry.scope !== undefined && DEMOTED_SCOPES.has(entry.scope)) {
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

  const sections: ChangelogSection<T>[] = [];
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

function groupByCategory<T>(
  { categories, order = [] }: ChangelogCategories<T>,
  entryOf: (item: T) => SectionEntry,
): ChangelogSection<T>[] {
  const breaking: T[] = [];
  const sections: ChangelogSection<T>[] = categories.map(({ name, entries }) => ({
    label: name,
    items: entries.filter((item) => {
      if (entryOf(item).breaking) {
        breaking.push(item);
        return false;
      }
      return true;
    }),
  }));

  // The LLM may name a Breaking category itself.
  const llmBreaking = sections.find((s) => s.label === BREAKING_SECTION);
  if (llmBreaking) {
    llmBreaking.items.unshift(...breaking);
  } else {
    sections.push({ label: BREAKING_SECTION, items: breaking });
  }

  const rank = (label: string): number => {
    const index = order.indexOf(label);
    if (index !== -1) {
      return index;
    }
    return label === BREAKING_SECTION ? -1 : order.length;
  };
  return sections.filter((s) => s.items.length > 0).sort((a, b) => rank(a.label) - rank(b.label));
}
