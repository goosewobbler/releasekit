import { type ChangelogEntryLineInput, type ChangelogRefsMode, renderChangelogEntryLine } from './changelogRefs.js';
import { groupChangelogSections } from './changelogSections.js';

export const PROJECT_WIDE_HEADING = 'Project-wide changes';

export interface ChangelogBlockEntry extends ChangelogEntryLineInput {
  type: string;
  breaking?: boolean;
}

interface SharedEntry {
  type: string;
  description: string;
  sharedPackage?: boolean;
}

const entryKey = (e: SharedEntry) => `${e.type}:${e.description}`;

/** A shared package's own changelog already lists its commits. */
export function unlistedEntries<T extends SharedEntry>(entries: readonly T[], listed: readonly SharedEntry[]): T[] {
  const keys = new Set(listed.map(entryKey));
  return entries.filter((e) => !keys.has(entryKey(e)));
}

export function sharedPackageEntriesFor<T extends SharedEntry>(shared: readonly T[], own: readonly SharedEntry[]): T[] {
  return unlistedEntries(
    shared.filter((e) => e.sharedPackage),
    own,
  );
}

export function renderChangelogSections(
  entries: readonly ChangelogBlockEntry[],
  level: number,
  mode: ChangelogRefsMode,
  repoUrl: string | null,
): string[] {
  const hashes = '#'.repeat(level);
  return groupChangelogSections(entries, (e) => e).map(
    (section) =>
      `${hashes} ${section.label}\n\n${section.items.map((e) => renderChangelogEntryLine(e, mode, repoUrl)).join('\n')}`,
  );
}

export function renderChangelogBlock(
  heading: string,
  level: number,
  entries: readonly ChangelogBlockEntry[],
  mode: ChangelogRefsMode,
  repoUrl: string | null,
): string {
  return [`${'#'.repeat(level)} ${heading}`, ...renderChangelogSections(entries, level + 1, mode, repoUrl)].join(
    '\n\n',
  );
}
