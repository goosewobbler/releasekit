import type { ReleaseChannel, VersionOutput } from '@releasekit/core';
import {
  deriveReleaseChannel,
  extractSelectionRegion,
  matchesPackageTarget,
  rkSelMarker,
  shouldMatchPackageTargets,
  wrapSelectionRegion,
} from '@releasekit/core';
import { getDistTag } from '@releasekit/publish';

type Update = VersionOutput['updates'][number];

/**
 * The ad-hoc *selection* region of a standing-PR body: a GitHub task-list where a ticked row means
 * "release this package in the next merge". The bot seeds it (all ticked by default — the same set
 * that would release today), a maintainer ticks/unticks rows on the PR, and the bot reads the choice
 * back on the next run to narrow the release set. State round-trips by marker slicing, never by
 * parsing prose: the package each row refers to comes from its `<!-- rk-sel:NAME -->` marker, and
 * only the GitHub `[x]`/`[ ]` glyph (the one thing a human can toggle) carries the checked state.
 *
 * Built over the core selection-region codec — the second markerRegion adapter after notes-region.
 */

const REGION_HEADING = '### Packages to release';
const REGION_HINT =
  '> Untick a package to hold it back from the next release, then save — the bot re-runs and updates this PR. ' +
  'Keep the `<!-- rk-sel... -->` marker comments; they identify each row.';

/** Render order for channel sections — stable first, prereleases after (#487). */
const CHANNEL_ORDER: readonly ReleaseChannel[] = ['stable', 'prerelease'] as const;

/** Section headings shown only when a standing PR mixes channels; a single-channel PR drops them so
 *  the flat list renders byte-for-byte as before. Each prerelease row carries its own dist-tag, so the
 *  heading stays generic rather than naming one tag. */
const SECTION_HEADING: Record<ReleaseChannel, string> = {
  stable: '#### Stable — advancing on `latest`',
  prerelease: '#### Prereleases — advancing on their pre-release dist-tag',
};

function checkbox(selected: boolean): string {
  return selected ? '[x]' : '[ ]';
}

/** The channel a row sits on: the per-package value stamped by #485, falling back to deriving it from
 *  the version for manifests written before that field existed (old PRs still open). */
function channelOf(update: Update): ReleaseChannel {
  return update.channel ?? deriveReleaseChannel(update.newVersion);
}

/** A release unit's channel is its primary's; an unchanged primary (no `primaryUpdate`) inherits it
 *  from its members, which are single-channel by construction for `linked`/`fixed` groups. */
function unitChannel(unit: ReleaseUnit): ReleaseChannel {
  if (unit.primaryUpdate) return channelOf(unit.primaryUpdate);
  const child = unit.children[0];
  return child ? channelOf(child) : 'stable';
}

/** Bucket items by channel, preserving input order within each bucket. */
function byChannel<T>(items: readonly T[], key: (item: T) => ReleaseChannel): Map<ReleaseChannel, T[]> {
  const map = new Map<ReleaseChannel, T[]>();
  for (const item of items) {
    const k = key(item);
    const list = map.get(k);
    if (list) list.push(item);
    else map.set(k, [item]);
  }
  return map;
}

/** Push a section heading, ensuring a blank line separates it from the rows above. */
function pushSectionHeading(lines: string[], channel: ReleaseChannel): void {
  if (lines[lines.length - 1] !== '') lines.push('');
  lines.push(SECTION_HEADING[channel], '');
}

/** The `→ <version>` label for a row. A prerelease row also surfaces the dist-tag channel it advances
 *  on (npm publishes a prerelease under its preid, e.g. `1.0.0-next.1` → `next`), so a mixed PR shows
 *  per-package maturity at a glance. */
function versionDisplay(update: Update): string {
  if (channelOf(update) !== 'prerelease') return update.newVersion;
  // SEAM (#486): the per-package "graduate to stable" affordance — gated on a `graduate:<package>`
  // label — attaches to prerelease rows here once that mechanism merges. #487 renders the channel
  // grouping + dist-tag only; it deliberately renders no affordance yet.
  return `${update.newVersion} · \`${getDistTag(update.newVersion)}\``;
}

function row(
  update: VersionOutput['updates'][number],
  selected: boolean,
  opts: { indent?: boolean; bold?: boolean; prefix?: string } = {},
): string {
  const indent = opts.indent ? '  ' : '';
  const name = opts.bold ? `**\`${update.packageName}\`**` : `\`${update.packageName}\``;
  const prefix = opts.prefix ?? '';
  return `${indent}- ${checkbox(selected)} ${prefix}${name} → ${versionDisplay(update)} ${rkSelMarker(update.packageName)}`;
}

/** Config controlling the hierarchical (release-unit) render. Absent / empty `primaryPackages` keeps
 *  the flat per-package render — fully backward-compatible. */
export interface PrimaryConfig {
  /** Glob patterns or exact names declaring which packages drive releases (the unit anchors). */
  primaryPackages: string[];
  /** Render mode. streamlined: one toggle per primary, children read-only + cascaded. granular:
   *  every package keeps its own toggle, nested under its primary, no cascade. */
  selection: 'streamlined' | 'granular';
  /** `version.groups` — resolves an unchanged primary's group (its group-mates are its children). */
  groups: Record<string, { sync?: string; packages?: string[] }>;
  /** Every workspace package name. Resolves `primaryPackages` patterns to concrete primaries —
   *  including a primary that isn't bumping, which never appears in `updates`. */
  allPackageNames: string[];
}

/** A primary and the changed packages that ship with it. `primaryUpdate` is absent when the primary
 *  itself isn't bumping but still anchors changed members of its closure (common under `linked`). */
export interface ReleaseUnit {
  primaryName: string;
  primaryUpdate?: Update;
  children: Update[];
}

export interface SelectionHierarchy {
  units: ReleaseUnit[];
  /** Changed packages that are neither a primary nor a child of one — rendered as flat checkboxes. */
  orphans: Update[];
  /** child package name → the primary names that own it (a child can ship with several primaries). */
  childOwners: Map<string, string[]>;
  /** Names of the primaries that anchor a unit this run. */
  primaryNames: Set<string>;
}

/**
 * Resolve release units from the changed set. `children(P) = (P's group-mates ∪ P's changed
 * prerequisites) ∩ releasing − declaredPrimaries`. A declared primary that is itself a group-mate of
 * another stays a top-level peer (never nested). A primary anchors a unit when it is bumping OR any
 * member of its closure is — so an unchanged primary still leads its unit. Deterministic ordering.
 */
export function computeHierarchy(updates: Update[], cfg: PrimaryConfig): SelectionHierarchy {
  const { primaryPackages, groups, allPackageNames } = cfg;
  const updateByName = new Map(updates.map((u) => [u.packageName, u]));
  const declaredPrimaryNames = new Set(allPackageNames.filter((n) => shouldMatchPackageTargets(n, primaryPackages)));

  // A changed primary carries its group on its update; an unchanged one is resolved from config.
  const groupOfPrimary = (p: string): string | undefined => {
    const own = updateByName.get(p)?.group;
    if (own) return own;
    for (const [name, gc] of Object.entries(groups)) {
      if (shouldMatchPackageTargets(p, gc.packages ?? [])) return name;
    }
    return undefined;
  };

  const childrenOf = (p: string): Update[] => {
    const group = groupOfPrimary(p);
    const seen = new Set<string>();
    const result: Update[] = [];
    const add = (u: Update) => {
      if (u.packageName === p || declaredPrimaryNames.has(u.packageName) || seen.has(u.packageName)) return;
      seen.add(u.packageName);
      result.push(u);
    };
    if (group) for (const u of updates) if (u.group === group) add(u);
    for (const u of updates) if (u.role === 'prerequisite' && u.prerequisiteOf?.includes(p)) add(u);
    return result.sort((a, b) => a.packageName.localeCompare(b.packageName));
  };

  const units: ReleaseUnit[] = [];
  const childOwners = new Map<string, string[]>();
  const claimed = new Set<string>();
  for (const primaryName of [...declaredPrimaryNames].sort((a, b) => a.localeCompare(b))) {
    const children = childrenOf(primaryName);
    const primaryUpdate = updateByName.get(primaryName);
    if (!primaryUpdate && children.length === 0) continue; // declared but nothing in its unit changed
    units.push({ primaryName, primaryUpdate, children });
    for (const child of children) {
      childOwners.set(child.packageName, [...(childOwners.get(child.packageName) ?? []), primaryName]);
      claimed.add(child.packageName);
    }
  }

  const orphans = updates
    .filter((u) => !declaredPrimaryNames.has(u.packageName) && !claimed.has(u.packageName))
    .sort((a, b) => a.packageName.localeCompare(b.packageName));

  return { units, orphans, childOwners, primaryNames: new Set(units.map((u) => u.primaryName)) };
}

/**
 * Expand a maintainer's deselection (the unticked primaries + orphans read back from the body) into
 * the full set of held-back packages. A child is held back only when *every* primary owning it is
 * deselected (reference-counted) — so a shared package keeps releasing while any of its owners do.
 */
export function cascadeDeselection(hierarchy: SelectionHierarchy, deselected: ReadonlySet<string>): Set<string> {
  const effective = new Set<string>();
  const deselectedPrimaries = new Set(
    hierarchy.units.filter((u) => deselected.has(u.primaryName)).map((u) => u.primaryName),
  );
  // A directly held-back *child* only reaches here from a legacy flat body the first run after
  // `primaryPackages` is enabled (streamlined children carry no marker, so steady state never has
  // one). Escalate it to holding its whole unit: a package a maintainer held back must never silently
  // ship, and holding the unit keeps the render coherent (the primary shows unticked) (#471).
  for (const [child, owners] of hierarchy.childOwners) {
    if (deselected.has(child)) for (const owner of owners) deselectedPrimaries.add(owner);
  }
  for (const p of deselectedPrimaries) effective.add(p);
  for (const orphan of hierarchy.orphans) if (deselected.has(orphan.packageName)) effective.add(orphan.packageName);
  for (const [child, owners] of hierarchy.childOwners) {
    if (owners.every((o) => deselectedPrimaries.has(o))) effective.add(child);
  }
  return effective;
}

/**
 * Warn (never throw) about `primaryPackages` entries that can't do anything: a pattern matching no
 * known package, or one matching a `version.skip` package (never released, so it cannot anchor).
 */
export function validatePrimaryPackages(
  primaryPackages: string[],
  allPackageNames: string[],
  skip: string[],
): string[] {
  const warnings: string[] = [];
  for (const pattern of primaryPackages) {
    const matches = allPackageNames.filter((n) => matchesPackageTarget(n, pattern));
    if (matches.length === 0) {
      warnings.push(`primaryPackages entry \`${pattern}\` matches no known package — it has no effect.`);
      continue;
    }
    const skipped = matches.filter((n) => shouldMatchPackageTargets(n, skip));
    if (skipped.length > 0) {
      const list = skipped.map((n) => `\`${n}\``).join(', ');
      warnings.push(
        `primaryPackages entry \`${pattern}\` matches ${list}, which version.skip excludes — a skipped package never releases, so it cannot anchor a unit.`,
      );
    }
  }
  return warnings;
}

/** A primary's task-list row: bold name, interactive checkbox, identity marker. Renders `— no change`
 *  when the primary anchors its unit without bumping. */
function primaryRow(unit: ReleaseUnit, selected: boolean): string {
  const label = unit.primaryUpdate ? `→ ${versionDisplay(unit.primaryUpdate)}` : '— no change';
  return `- ${checkbox(selected)} **\`${unit.primaryName}\`** ${label} ${rkSelMarker(unit.primaryName)}`;
}

/** A streamlined child: a plain bullet (never a task item, so GitHub can't make it interactive and
 *  fight the cascade) and intentionally markerless — its state is derived from its primary each run. */
function childBullet(child: Update): string {
  return `  - \`${child.packageName}\` → ${versionDisplay(child)} · coupled`;
}

/**
 * Renders the collapsed per-row changelog for the package(s) a checkbox gates, indented to nest under
 * its row, returning `''` when those packages have no changelog entries. Injected by the caller so
 * selection-region stays free of changelog formatting (the implementation lives in
 * `changelog-region.ts`). #487 reuses it unchanged when it regroups *where* rows are placed.
 */
export type RowChangelogRenderer = (packageNames: string[], heldBack: boolean, indent: string) => string;

/** Append a per-row changelog block (if any) for the packages a row gates. No-op without a renderer. */
function attachChangelog(
  lines: string[],
  rowChangelog: RowChangelogRenderer | undefined,
  packageNames: string[],
  heldBack: boolean,
  indent: string,
): void {
  if (!rowChangelog) return;
  const block = rowChangelog(packageNames, heldBack, indent);
  if (block) lines.push(block);
}

/** Render the flat (no-primary) rows for a single channel's updates: target → its derived
 *  prerequisites where those roles are present, otherwise plain per-package rows. */
function renderFlatSection(
  lines: string[],
  updates: Update[],
  selected: (name: string) => boolean,
  rowChangelog?: RowChangelogRenderer,
): void {
  const prerequisites = updates.filter((u) => u.role === 'prerequisite');
  const rendered = new Set<string>();
  if (prerequisites.length > 0) {
    for (const target of updates.filter((u) => u.role === 'target')) {
      lines.push(row(target, selected(target.packageName), { bold: true }));
      rendered.add(target.packageName);
      attachChangelog(lines, rowChangelog, [target.packageName], !selected(target.packageName), '  ');
      for (const prereq of prerequisites.filter((p) => p.prerequisiteOf?.includes(target.packageName))) {
        lines.push(row(prereq, selected(prereq.packageName), { indent: true, prefix: '↳ prerequisite ' }));
        rendered.add(prereq.packageName);
        attachChangelog(lines, rowChangelog, [prereq.packageName], !selected(prereq.packageName), '    ');
      }
    }
  }
  // Flat rows for the plain-async case, and for any prerequisite whose target had no update entry of
  // its own (it would otherwise be silently dropped).
  for (const update of updates.filter((u) => !rendered.has(u.packageName))) {
    lines.push(row(update, selected(update.packageName)));
    attachChangelog(lines, rowChangelog, [update.packageName], !selected(update.packageName), '  ');
  }
}

/** Flat render split into channel sections (#487): stable then prereleases, each a self-contained
 *  flat list. A single-channel PR drops the headings and renders exactly as before.
 *
 *  Caveat: the `↳ prerequisite` nesting in `renderFlatSection` only holds when a target and its
 *  prerequisite share a channel. A cross-channel prerequisite (e.g. a `-next` dependency of a stable
 *  target) lands in its own channel section and renders as a flat row without the `↳` label —
 *  channel grouping wins over prerequisite nesting in that rare mixed-maturity case. */
function renderFlat(
  lines: string[],
  updates: Update[],
  selected: (name: string) => boolean,
  rowChangelog?: RowChangelogRenderer,
): void {
  const updatesByChannel = byChannel(updates, channelOf);
  const channels = CHANNEL_ORDER.filter((c) => (updatesByChannel.get(c)?.length ?? 0) > 0);
  const showHeadings = channels.length > 1;
  for (const channel of channels) {
    if (showHeadings) pushSectionHeading(lines, channel);
    renderFlatSection(lines, updatesByChannel.get(channel) ?? [], selected, rowChangelog);
  }
}

/** Render one release unit (primary row + its coupled members), streamlined or granular. */
function renderUnit(
  lines: string[],
  unit: ReleaseUnit,
  selected: (name: string) => boolean,
  streamlined: boolean,
  rowChangelog?: RowChangelogRenderer,
): void {
  lines.push(primaryRow(unit, selected(unit.primaryName)));
  const heldBack = !selected(unit.primaryName);
  if (streamlined) {
    if (unit.children.length > 0) {
      // Children inside a collapsed pane as plain bullets — a blank line after <summary> lets GitHub
      // render the nested markdown list.
      lines.push(`  <details><summary>ships ${unit.children.length} coupled</summary>`, '');
      for (const child of unit.children) lines.push(childBullet(child));
      lines.push('  </details>');
    }
    // The streamlined unit ships primary + coupled members together, so its changelog aggregates
    // them all — a shared prerequisite re-appears under every owning unit (self-contained by design).
    attachChangelog(
      lines,
      rowChangelog,
      [unit.primaryName, ...unit.children.map((c) => c.packageName)],
      heldBack,
      '  ',
    );
  } else {
    // granular: every package toggles on its own, so each row carries only its own changes.
    attachChangelog(lines, rowChangelog, [unit.primaryName], heldBack, '  ');
    for (const child of unit.children) {
      lines.push(row(child, selected(child.packageName), { indent: true }));
      attachChangelog(lines, rowChangelog, [child.packageName], !selected(child.packageName), '    ');
    }
  }
}

/** Render an orphan — a changed package outside every known unit — as a flat top-level checkbox. */
function renderOrphan(
  lines: string[],
  orphan: Update,
  selected: (name: string) => boolean,
  rowChangelog?: RowChangelogRenderer,
): void {
  lines.push(row(orphan, selected(orphan.packageName)));
  attachChangelog(lines, rowChangelog, [orphan.packageName], !selected(orphan.packageName), '  ');
}

function renderHierarchical(
  lines: string[],
  updates: Update[],
  selected: (name: string) => boolean,
  primary: PrimaryConfig,
  rowChangelog?: RowChangelogRenderer,
): void {
  const hierarchy = computeHierarchy(updates, primary);
  const streamlined = primary.selection !== 'granular';
  // A unit stays intact and lands in its primary's channel section (#487); orphans land in their own.
  const unitsByChannel = byChannel(hierarchy.units, unitChannel);
  const orphansByChannel = byChannel(hierarchy.orphans, channelOf);
  const channels = CHANNEL_ORDER.filter(
    (c) => (unitsByChannel.get(c)?.length ?? 0) > 0 || (orphansByChannel.get(c)?.length ?? 0) > 0,
  );
  const showHeadings = channels.length > 1;
  for (const channel of channels) {
    if (showHeadings) pushSectionHeading(lines, channel);
    for (const unit of unitsByChannel.get(channel) ?? []) renderUnit(lines, unit, selected, streamlined, rowChangelog);
    // Orphans stay flat top-level checkboxes (fail-safe), grouped under their own channel.
    for (const orphan of orphansByChannel.get(channel) ?? []) renderOrphan(lines, orphan, selected, rowChangelog);
  }
}

/**
 * Render the selection region for a set of publishable updates. With `primary` set (non-empty
 * `primaryPackages`) it renders release units — primaries as parent rows with coupled members nested
 * beneath (streamlined: read-only bullets in a collapsed pane; granular: per-child checkboxes).
 * Otherwise rows render flat, grouping target → derived prerequisites when those roles are present.
 * Every row is ticked unless its package is in `deselected`. When `rowChangelog` is supplied, each
 * row gets its co-located collapsed changelog covering exactly the package(s) that row gates.
 *
 * Rows are grouped into channel sections (#487): a **Stable** section (advancing on `latest`) and a
 * **Prereleases** section (advancing on each row's pre-release dist-tag). The hierarchy/flat render is
 * preserved *within* each section — a unit lands in its primary's channel. When every package shares
 * one channel the headings are dropped, so single-channel PRs render byte-for-byte as before. Returns
 * the marker-wrapped block.
 */
export function renderSelectionRegion(
  updates: VersionOutput['updates'],
  deselected: ReadonlySet<string>,
  primary?: PrimaryConfig,
  rowChangelog?: RowChangelogRenderer,
): string {
  const selected = (name: string) => !deselected.has(name);
  const lines: string[] = [REGION_HEADING, '', REGION_HINT, ''];

  if (primary && primary.primaryPackages.length > 0) {
    renderHierarchical(lines, updates, selected, primary, rowChangelog);
  } else {
    renderFlat(lines, updates, selected, rowChangelog);
  }

  return wrapSelectionRegion(lines.join('\n'));
}

/**
 * Read the maintainer's prior selection back from a live PR body: the package names whose row is
 * unticked (`[ ]`). Returns `undefined` when no selection region is present (a body that predates
 * this feature, or a sync release that carries none). Pure marker slicing — the package identity is
 * taken from the `rk-sel` marker, the checked state from the glyph anchored to that marker's line.
 */
export function extractSelection(body: string): { deselected: string[] } | undefined {
  const region = extractSelectionRegion(body);
  if (region === undefined) return undefined;

  const deselected: string[] = [];
  for (const line of region.split('\n')) {
    const markerStart = line.indexOf('<!-- rk-sel:');
    if (markerStart === -1) continue;
    const nameStart = markerStart + '<!-- rk-sel:'.length;
    const nameEnd = line.indexOf(' -->', nameStart);
    if (nameEnd === -1) continue;
    const name = line.slice(nameStart, nameEnd);
    // A row is selected unless its checkbox glyph is explicitly empty. `includes('[ ]')` is a fixed
    // substring check on the row text before the marker — no prose parsing, no backtracking regex.
    if (line.slice(0, markerStart).includes('[ ]')) deselected.push(name);
  }
  return { deselected };
}

export interface SelectionWarning {
  packageName: string;
  reason: string;
}

/**
 * Coherence warnings for a deselection. Unticking a member of an `independent` group ships a partial
 * group; unticking a prerequisite that a still-ticked target depends on may publish that target
 * against an unreleased dependency. Lockstep (`fixed`/`linked`) members are handled upstream (their
 * untick is ignored, not warned here) since they cannot be held back individually.
 */
export function selectionWarnings(
  updates: VersionOutput['updates'],
  deselected: ReadonlySet<string>,
  groups: Record<string, { sync?: string }>,
): SelectionWarning[] {
  const warnings: SelectionWarning[] = [];
  for (const update of updates) {
    if (!deselected.has(update.packageName)) continue;
    if (update.group && groups[update.group]?.sync === 'independent') {
      // Only a *partial* hold-back splits the group. When a primary toggle cascades the whole
      // independent group out together, every member is deselected — coherent, so don't warn.
      const partial = updates.some((u) => u.group === update.group && !deselected.has(u.packageName));
      if (partial) {
        warnings.push({
          packageName: update.packageName,
          reason: `\`${update.packageName}\` belongs to independent group \`${update.group}\` — unticking it ships a partial group.`,
        });
      }
    }
    const dependents = (update.prerequisiteOf ?? []).filter((t) => !deselected.has(t));
    if (dependents.length > 0) {
      const list = dependents.map((t) => `\`${t}\``).join(', ');
      warnings.push({
        packageName: update.packageName,
        reason: `\`${update.packageName}\` is a prerequisite of still-selected ${list} — unticking it publishes ${dependents.length > 1 ? 'them' : 'it'} against an unreleased dependency.`,
      });
    }
  }
  return warnings;
}
