import type { VersionChangelogEntry, VersionOutput } from '@releasekit/core';
import type { RowChangelogRenderer } from './selection-region.js';

/**
 * Changelog rendering for the standing PR. Two surfaces share one core:
 *
 *  - **Per-row changelogs** ({@link makeRowChangelogRenderer}) — a collapsed `<details>` co-located
 *    with each releasable row, showing only the changes that ship with that row's release unit
 *    (primary + coupled members + changed prerequisites). A prerequisite shared by two units appears
 *    under each — the unit-centric view is self-contained, so the duplication is intentional.
 *  - **Combined footer** ({@link renderCombinedFooter}) — one default-collapsed block listing every
 *    change once, flat and de-duplicated across packages, grouped by change type. It is the
 *    whole-release view the per-row panes can't give.
 *
 * Both read straight from {@link VersionOutput.changelogs} / `sharedEntries` and never parse prose.
 */

/** Keep-a-Changelog bucket labels keyed by conventional-commit type. Several types fold onto one
 *  label (feat/added → Added), so deduped entries are grouped by *label*, not raw type. */
const CHANGELOG_TYPE_LABELS: Record<string, string> = {
  feat: 'Added',
  fix: 'Fixed',
  added: 'Added',
  changed: 'Changed',
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

/** The distinct labels in first-occurrence order — the order type buckets render in. */
const LABEL_ORDER: string[] = (() => {
  const seen = new Set<string>();
  const order: string[] = [];
  for (const label of Object.values(CHANGELOG_TYPE_LABELS)) {
    if (!seen.has(label)) {
      seen.add(label);
      order.push(label);
    }
  }
  return order;
})();

function labelFor(type: string): string {
  return CHANGELOG_TYPE_LABELS[type] ?? type.charAt(0).toUpperCase() + type.slice(1);
}

interface AttributedEntry {
  entry: VersionChangelogEntry;
  /** The package this entry was emitted for; absent for project-wide (`sharedEntries`) changes. */
  pkg?: string;
}

interface DedupedEntry {
  entry: VersionChangelogEntry;
  /** Packages the (de-duplicated) change touched, for inline attribution. */
  pkgs: Set<string>;
}

/** Identity of the underlying change: the same commit/PR yields an identical type + description +
 *  scope (+ issue refs) across every package it touched, so this key collapses those N copies into
 *  one. Scope is part of the identity — two commits sharing a description but differing in scope
 *  (`fix(cli)` vs `fix(router)`) are distinct changes and must not merge into a mis-attributed line. */
function dedupeKey(e: VersionChangelogEntry): string {
  return JSON.stringify([e.type, e.description, e.scope ?? null, e.issueIds ?? []]);
}

/** De-duplicate by underlying change, preserving first-seen order and collecting contributing
 *  packages. Synthetic lockstep-carry placeholders (`Update version to X`, #468) are dropped — they
 *  are not real changes. */
function dedupe(attributed: AttributedEntry[]): DedupedEntry[] {
  const byKey = new Map<string, DedupedEntry>();
  const order: DedupedEntry[] = [];
  for (const { entry, pkg } of attributed) {
    if (entry.synthetic) continue;
    const key = dedupeKey(entry);
    let agg = byKey.get(key);
    if (!agg) {
      agg = { entry, pkgs: new Set() };
      byKey.set(key, agg);
      order.push(agg);
    }
    if (pkg) agg.pkgs.add(pkg);
  }
  return order;
}

/** Compact attribution label for a package — drops an npm scope prefix (`@wdio/foo` → `foo`). */
function shortName(pkg: string): string {
  const slash = pkg.lastIndexOf('/');
  return slash === -1 ? pkg : pkg.slice(slash + 1);
}

function entryLine(d: DedupedEntry, attribution: boolean): string {
  const { entry, pkgs } = d;
  const scope = entry.scope ? ` (\`${entry.scope}\`)` : '';
  const issues = entry.issueIds?.length ? ` ${entry.issueIds.join(', ')}` : '';
  const attr = attribution && pkgs.size > 0 ? ` _(${[...pkgs].map(shortName).sort().join(', ')})_` : '';
  return `- ${entry.description}${scope}${issues}${attr}`;
}

/** Render the deduped entries as flat, type-grouped Markdown (no per-package sections). */
function renderGrouped(deduped: DedupedEntry[]): string[] {
  const distinct = new Set<string>();
  for (const d of deduped) for (const p of d.pkgs) distinct.add(p);
  // Attribution only earns its place when the list spans more than one package.
  const attribution = distinct.size > 1;

  const byLabel = new Map<string, DedupedEntry[]>();
  for (const d of deduped) {
    const label = labelFor(d.entry.type);
    let list = byLabel.get(label);
    if (!list) {
      list = [];
      byLabel.set(label, list);
    }
    list.push(d);
  }

  const lines: string[] = [];
  const emit = (label: string): void => {
    const list = byLabel.get(label);
    if (!list?.length) return;
    lines.push(`**${label}**`, '');
    for (const d of list) lines.push(entryLine(d, attribution));
    lines.push('');
  };
  const rendered = new Set<string>();
  for (const label of LABEL_ORDER) {
    emit(label);
    rendered.add(label);
  }
  for (const label of byLabel.keys()) if (!rendered.has(label)) emit(label);
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/** Wrap inner Markdown in a collapsed `<details>`, indenting every non-blank line so the block nests
 *  cleanly under its list-item row (`indent` is '' for the top-level footer). */
function wrapDetails(summary: string, inner: string[], indent: string): string {
  const lines = [`<details><summary>${summary}</summary>`, '', ...inner, '', '</details>'];
  return lines.map((l) => (l.length > 0 ? `${indent}${l}` : '')).join('\n');
}

function pluralEntries(n: number): string {
  return `${n} ${n === 1 ? 'entry' : 'entries'}`;
}

/**
 * Build the per-row changelog renderer for a set of package changelogs. The returned function takes
 * the package names a checkbox gates (a streamlined unit aggregates primary + coupled members +
 * changed prerequisites; every other row gates a single package), whether the row is held back, and
 * the indent that nests the block under its row. It returns the collapsed `<details>` block, or `''`
 * when those packages have no real changelog entries.
 *
 * #487 regroups *where* rows are placed; it reuses this renderer unchanged to keep *how* changelogs
 * attach to a row identical.
 */
export function makeRowChangelogRenderer(changelogs: VersionOutput['changelogs']): RowChangelogRenderer {
  const byPkg = new Map(changelogs.map((cl) => [cl.packageName, cl]));
  return (packageNames, heldBack, indent) => {
    const attributed: AttributedEntry[] = [];
    for (const name of packageNames) {
      const cl = byPkg.get(name);
      if (!cl) continue;
      for (const entry of cl.entries) attributed.push({ entry, pkg: name });
    }
    const deduped = dedupe(attributed);
    if (deduped.length === 0) return '';
    const summary = heldBack
      ? `<s>Changelog (${pluralEntries(deduped.length)})</s> — held back, won’t publish`
      : `Changelog (${pluralEntries(deduped.length)})`;
    return wrapDetails(summary, renderGrouped(deduped), indent);
  };
}

/**
 * The combined footer: one default-collapsed block listing every change in `versionOutput` once,
 * flat and de-duplicated across packages, grouped by change type. Driven by the *write* output, which
 * already excludes held-back packages, so the footer always reflects exactly what will publish.
 * Returns `''` when there are no real entries.
 */
export function renderCombinedFooter(versionOutput: VersionOutput): string {
  const attributed: AttributedEntry[] = [];
  for (const cl of versionOutput.changelogs) {
    for (const entry of cl.entries) attributed.push({ entry, pkg: cl.packageName });
  }
  for (const entry of versionOutput.sharedEntries ?? []) attributed.push({ entry });
  const deduped = dedupe(attributed);
  if (deduped.length === 0) return '';
  const n = deduped.length;
  const summary = `Show all changes (${n} ${n === 1 ? 'change' : 'changes'}, de-duplicated)`;
  return wrapDetails(summary, renderGrouped(deduped), '');
}
