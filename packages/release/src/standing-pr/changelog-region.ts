import { DEFAULT_DEMOTE_SCOPES } from '@releasekit/config';
import {
  type ChangelogRefsMode,
  escapeChangelogMentions,
  neutralizeDescriptionRefs,
  renderIssueRefs,
  type VersionChangelogEntry,
  type VersionOutput,
} from '@releasekit/core';
import type { RowChangelogRenderer } from './selection-region.js';

/**
 * Two surfaces share one core: per-row changelogs ({@link makeRowChangelogRenderer}), where a prerequisite shared by
 * two units deliberately appears under each, and the combined footer ({@link renderCombinedFooter}), listing every
 * change once. Both read structured entries and never parse prose.
 */

/** Several types fold onto one label (feat/added → Added), so entries group by label, not raw type. */
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
  // A bare `@scope/pkg` or `@user` would be a GitHub mention (and could ping a real team), so always neutralise it.
  // Bare `#N` refs from the commit subject are de-duped against the appended refs.
  const appendedRefs = [...(entry.issueIds ?? []), entry.prNumber];
  const description = escapeChangelogMentions(
    neutralizeDescriptionRefs(entry.description, appendedRefs, refOpts.refs, refOpts.repoUrl),
  );
  const scope = entry.scope ? ` (\`${entry.scope}\`)` : '';
  const refs = renderIssueRefs(entry.issueIds ?? [], refOpts.refs, refOpts.repoUrl, entry.prNumber);
  const issues = refs ? ` ${refs}` : '';
  const attr = attribution && pkgs.size > 0 ? ` _(${[...pkgs].map(shortName).sort().join(', ')})_` : '';
  return `- ${entry.breaking ? '**BREAKING** ' : ''}${description}${scope}${issues}${attr}`;
}

/** No "shared across packages" descriptor: it isn't reliably true (`Update version to X` is package-specific). */
const DEMOTED_HEADING = 'Dependencies & version bumps';

/** Demoted entries are moved, never removed, so the caller's de-duplicated change count still holds. */
function renderGrouped(deduped: DedupedEntry[], refOpts: RefRenderOptions, demoteScopes: readonly string[]): string[] {
  const distinct = new Set<string>();
  for (const d of deduped) {
    for (const p of d.pkgs) {
      distinct.add(p);
    }
  }
  const attribution = distinct.size > 1;

  const demote = demoteScopes.length > 0;
  const promoted: DedupedEntry[] = [];
  const demoted: DedupedEntry[] = [];
  for (const d of deduped) {
    if (demote && d.entry.scope !== undefined && demoteScopes.includes(d.entry.scope)) {
      demoted.push(d);
    } else {
      promoted.push(d);
    }
  }

  const byLabel = new Map<string, DedupedEntry[]>();
  for (const d of promoted) {
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
    if (!list?.length) {
      return;
    }
    // A heading, not bold: inside the blockquote bold text collapses to near-zero spacing between sections.
    lines.push(`#### ${label}`, '');
    for (const d of list) {
      lines.push(entryLine(d, attribution, refOpts));
    }
    lines.push('');
  };
  const rendered = new Set<string>();
  for (const label of LABEL_ORDER) {
    emit(label);
    rendered.add(label);
  }
  for (const label of byLabel.keys()) {
    if (!rendered.has(label)) {
      emit(label);
    }
  }
  // Last, so low-signal dependency churn never crowds the user-facing changes.
  if (demoted.length > 0) {
    lines.push(`#### ${DEMOTED_HEADING}`, '');
    for (const d of demoted) {
      lines.push(entryLine(d, attribution, refOpts));
    }
    lines.push('');
  }
  if (lines[lines.length - 1] === '') {
    lines.pop();
  }
  return lines;
}

/** The content is blockquoted but the `<details>` tags aren't: GitHub renders a `> `-prefixed raw-HTML block
 *  unreliably. Inner blank lines keep a bare `>` so the quote stays one contiguous block. */
function wrapDetails(summary: string, inner: string[], indent: string): string {
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

/** The renderer returns `''` when the gated packages have no real entries; demoted entries count toward the total. */
export function makeRowChangelogRenderer(
  changelogs: VersionOutput['changelogs'],
  refs: ChangelogRefsMode = 'link',
  demoteScopes: readonly string[] = DEFAULT_DEMOTE_SCOPES,
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
    return wrapDetails(summary, renderGrouped(deduped, refOpts, demoteScopes), indent);
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
  opts: { sharedOnly?: boolean; refs?: ChangelogRefsMode; demoteScopes?: readonly string[] } = {},
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
  return wrapDetails(summary, renderGrouped(deduped, refOpts, opts.demoteScopes ?? DEFAULT_DEMOTE_SCOPES), '');
}
