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

export function unlistedEntries<T extends SharedEntry>(entries: readonly T[], listed: readonly SharedEntry[]): T[] {
  const keys = new Set(listed.map(entryKey));
  return entries.filter((e) => !keys.has(entryKey(e)));
}

/** A shared package's own changelog already lists its commits. */
function sharedPackageEntriesFor<T extends SharedEntry>(shared: readonly T[], own: readonly SharedEntry[]): T[] {
  return unlistedEntries(
    shared.filter((e) => e.sharedPackage),
    own,
  );
}

/** Older manifests don't record a changelog's own shared-package entries, so they're picked from the run's. */
export function sharedPackageEntriesOf<T extends SharedEntry>(
  changelog: { entries: readonly SharedEntry[]; sharedPackageEntries?: readonly T[] },
  sharedEntries: readonly T[],
): T[] {
  return changelog.sharedPackageEntries
    ? [...changelog.sharedPackageEntries]
    : sharedPackageEntriesFor(sharedEntries, changelog.entries);
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

export interface BundledPackage<T> {
  packageName: string;
  /** Set when the package released more than once in the range. */
  firstVersion?: string;
  version: string;
  entries: T[];
}

interface BundledEntry {
  description: string;
  synthetic?: boolean;
}

/** `releases` holds the stored bundled releases and this run's changelog records. Placeholder entries are dropped. */
export function resolveBundled<T extends BundledEntry>(
  bundled: readonly { packageName: string; versions: readonly string[] }[] | undefined,
  releases: readonly { packageName: string; version: string; entries: readonly T[] }[],
): BundledPackage<T>[] {
  return (bundled ?? []).flatMap(({ packageName, versions }) => {
    const entries = versions.flatMap((version) =>
      (releases.find((r) => r.packageName === packageName && r.version === version)?.entries ?? []).filter(
        (e) => !e.synthetic && e.description !== `Update version to ${version}`,
      ),
    );
    const first = versions[0];
    const last = versions.at(-1);
    if (last === undefined || entries.length === 0) {
      return [];
    }
    return [{ packageName, ...(versions.length > 1 ? { firstVersion: first } : {}), version: last, entries }];
  });
}

export function renderBundledBlocks(
  packages: readonly BundledPackage<ChangelogBlockEntry>[],
  level: number,
  mode: ChangelogRefsMode,
  repoUrl: string | null,
): string[] {
  return packages.map((p) =>
    renderChangelogBlock(
      `${p.packageName} ${p.firstVersion ? `${p.firstVersion} → ` : ''}${p.version}`,
      level,
      p.entries,
      mode,
      repoUrl,
    ),
  );
}
