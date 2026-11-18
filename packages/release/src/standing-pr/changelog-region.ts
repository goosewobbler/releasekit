import type { ReleaseKitConfig } from '@releasekit/config';
import {
  type ChangelogRefsMode,
  groupChangelogSections,
  renderChangelogEntryLine,
  type VersionChangelogEntry,
  type VersionOutput,
} from '@releasekit/core';
import type { RowChangelogRenderer } from './selection-region.js';

/**
 * Two surfaces share one core: per-row changelogs ({@link makeRowChangelogRenderer}), where a prerequisite shared by
 * two units deliberately appears under each, and the combined footer ({@link renderCombinedFooter}), listing every
 * change once. Both read structured entries and never parse prose.
 */

/** `notes.changelog: false` gets the default: the standing PR and preview render changelogs regardless. */
export function configuredRefsMode(config: ReleaseKitConfig): ChangelogRefsMode {
  return (config.notes?.changelog || undefined)?.refs ?? 'link';
}

interface AttributedEntry {
  entry: VersionChangelogEntry;
  /** Absent for project-wide (`sharedEntries`) changes. */
  pkg?: string;
}

interface DedupedEntry {
  entry: VersionChangelogEntry;
  pkgs: Set<string>;
}

/** One commit yields identical entries in every package it touched; this key collapses them. Scope and the breaking
 *  flag are part of the identity: `fix(cli)` and `fix(router)` with one description are distinct changes. */
function dedupeKey(e: VersionChangelogEntry): string {
  return JSON.stringify([e.type, e.description, e.scope ?? null, e.issueIds ?? [], e.breaking === true]);
}

/** Drops synthetic lockstep-carry placeholders (`Update version to X`), which aren't real changes. */
function dedupe(attributed: AttributedEntry[]): DedupedEntry[] {
  const byKey = new Map<string, DedupedEntry>();
  const order: DedupedEntry[] = [];
  for (const { entry, pkg } of attributed) {
    if (entry.synthetic) {
      continue;
    }
    const key = dedupeKey(entry);
    let agg = byKey.get(key);
    if (!agg) {
      agg = { entry, pkgs: new Set() };
      byKey.set(key, agg);
      order.push(agg);
    }
    if (pkg) {
      agg.pkgs.add(pkg);
    }
  }
  return order;
}

function shortName(pkg: string): string {
  const slash = pkg.lastIndexOf('/');
  return slash === -1 ? pkg : pkg.slice(slash + 1);
}

interface RefRenderOptions {
  refs: ChangelogRefsMode;
  repoUrl: string | null;
}

function entryLine(d: DedupedEntry, attribution: boolean, refOpts: RefRenderOptions): string {
  const { entry, pkgs } = d;
  const attr = attribution && pkgs.size > 0 ? ` _(${[...pkgs].map(shortName).sort().join(', ')})_` : '';
  return renderChangelogEntryLine(entry, refOpts.refs, refOpts.repoUrl, attr);
}

function renderGrouped(deduped: DedupedEntry[], refOpts: RefRenderOptions): string[] {
  const distinct = new Set<string>();
  for (const d of deduped) {
    for (const p of d.pkgs) {
      distinct.add(p);
    }
  }
  const attribution = distinct.size > 1;
  return changelogSectionLines(
    deduped,
    (d) => d.entry,
    (d) => entryLine(d, attribution, refOpts),
  );
}

export function changelogSectionLines<T>(
  items: readonly T[],
  entryOf: (item: T) => VersionChangelogEntry,
  lineOf: (item: T) => string,
): string[] {
  const lines: string[] = [];
  for (const section of groupChangelogSections(items, entryOf)) {
    // A heading, not bold: inside the blockquote bold text collapses to near-zero spacing between sections.
    lines.push(`#### ${section.label}`, '', ...section.items.map(lineOf), '');
  }
  lines.pop();
  return lines;
}

/** The content is blockquoted but the `<details>` tags aren't: GitHub renders a `> `-prefixed raw-HTML block
 *  unreliably. Inner blank lines keep a bare `>` so the quote stays one contiguous block. */
export function wrapDetails(summary: string, inner: string[], indent = ''): string {
  const quotedInner = inner.map((l) => (l.length > 0 ? `${indent}> ${l}` : `${indent}>`));
  const lines = [`${indent}<details><summary>${summary}</summary>`, '', ...quotedInner, '', `${indent}</details>`];
  return lines.join('\n');
}

function pluralEntries(n: number): string {
  return `${n} ${n === 1 ? 'entry' : 'entries'}`;
}

/** Every package in a standing PR lives in the same repo, so any changelog's `repoUrl` serves the whole render. */
function repoUrlOf(changelogs: VersionOutput['changelogs']): string | null {
  return changelogs.find((cl) => cl.repoUrl)?.repoUrl ?? null;
}

/** The renderer returns `''` when the gated packages have no real entries. */
export function makeRowChangelogRenderer(
  changelogs: VersionOutput['changelogs'],
  refs: ChangelogRefsMode = 'link',
): RowChangelogRenderer {
  const byPkg = new Map(changelogs.map((cl) => [cl.packageName, cl]));
  const refOpts: RefRenderOptions = { refs, repoUrl: repoUrlOf(changelogs) };
  return (packageNames, heldBack, indent) => {
    const attributed: AttributedEntry[] = [];
    for (const name of packageNames) {
      const cl = byPkg.get(name);
      if (!cl) {
        continue;
      }
      for (const entry of cl.entries) {
        attributed.push({ entry, pkg: name });
      }
    }
    const deduped = dedupe(attributed);
    if (deduped.length === 0) {
      return '';
    }
    const summary = heldBack
      ? `<s>Changelog (${pluralEntries(deduped.length)})</s> — held back, won’t publish`
      : `Changelog (${pluralEntries(deduped.length)})`;
    return wrapDetails(summary, renderGrouped(deduped, refOpts), indent);
  };
}

/** Shared by the footer and the summary's change count so both read one authoritative set. */
function collectAttributed(versionOutput: VersionOutput, sharedOnly: boolean): AttributedEntry[] {
  const attributed: AttributedEntry[] = [];
  if (!sharedOnly) {
    for (const cl of versionOutput.changelogs) {
      for (const entry of cl.entries) {
        attributed.push({ entry, pkg: cl.packageName });
      }
    }
  }
  for (const entry of versionOutput.sharedEntries ?? []) {
    attributed.push({ entry });
  }
  return attributed;
}

export function countCombinedChanges(versionOutput: VersionOutput): number {
  return dedupe(collectAttributed(versionOutput, false)).length;
}

/** `sharedOnly` narrows to project-wide (`sharedEntries`) changes, which have no per-row home. */
export function renderCombinedFooter(
  versionOutput: VersionOutput,
  opts: { sharedOnly?: boolean; refs?: ChangelogRefsMode } = {},
): string {
  const deduped = dedupe(collectAttributed(versionOutput, !!opts.sharedOnly));
  if (deduped.length === 0) {
    return '';
  }
  const n = deduped.length;
  const summary = opts.sharedOnly
    ? `Show project-wide changes (${n} ${n === 1 ? 'change' : 'changes'})`
    : `Show all changes (${n} ${n === 1 ? 'change' : 'changes'}, de-duplicated)`;
  const refOpts: RefRenderOptions = { refs: opts.refs ?? 'link', repoUrl: repoUrlOf(versionOutput.changelogs) };
  return wrapDetails(summary, renderGrouped(deduped, refOpts));
}
