import type { VersionOutput } from '@releasekit/core';
import {
  extractSelectionRegion,
  matchesPackageTarget,
  rkSelMarker,
  shouldMatchPackageTargets,
  wrapSelectionRegion,
} from '@releasekit/core';

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

function checkbox(selected: boolean): string {
  return selected ? '[x]' : '[ ]';
}

function row(
  update: VersionOutput['updates'][number],
  selected: boolean,
  opts: { indent?: boolean; bold?: boolean; prefix?: string } = {},
): string {
  const indent = opts.indent ? '  ' : '';
  const name = opts.bold ? `**\`${update.packageName}\`**` : `\`${update.packageName}\``;
  const prefix = opts.prefix ?? '';
  return `${indent}- ${checkbox(selected)} ${prefix}${name} → ${update.newVersion} ${rkSelMarker(update.packageName)}`;
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
  const label = unit.primaryUpdate ? `→ ${unit.primaryUpdate.newVersion}` : '— no change';
  return `- ${checkbox(selected)} **\`${unit.primaryName}\`** ${label} ${rkSelMarker(unit.primaryName)}`;
}

/** A streamlined child: a plain bullet (never a task item, so GitHub can't make it interactive and
 *  fight the cascade) and intentionally markerless — its state is derived from its primary each run. */
function childBullet(child: Update): string {
  return `  - \`${child.packageName}\` → ${child.newVersion} · coupled`;
}

function renderFlat(lines: string[], updates: Update[], selected: (name: string) => boolean): void {
  const prerequisites = updates.filter((u) => u.role === 'prerequisite');
  const rendered = new Set<string>();
  if (prerequisites.length > 0) {
    for (const target of updates.filter((u) => u.role === 'target')) {
      lines.push(row(target, selected(target.packageName), { bold: true }));
      rendered.add(target.packageName);
      for (const prereq of prerequisites.filter((p) => p.prerequisiteOf?.includes(target.packageName))) {
        lines.push(row(prereq, selected(prereq.packageName), { indent: true, prefix: '↳ prerequisite ' }));
        rendered.add(prereq.packageName);
      }
    }
  }
  // Flat rows for the plain-async case, and for any prerequisite whose target had no update entry of
  // its own (it would otherwise be silently dropped).
  for (const update of updates.filter((u) => !rendered.has(u.packageName))) {
    lines.push(row(update, selected(update.packageName)));
  }
}

function renderHierarchical(
  lines: string[],
  updates: Update[],
  selected: (name: string) => boolean,
  primary: PrimaryConfig,
): void {
  const hierarchy = computeHierarchy(updates, primary);
  const streamlined = primary.selection !== 'granular';
  for (const unit of hierarchy.units) {
    lines.push(primaryRow(unit, selected(unit.primaryName)));
    if (unit.children.length === 0) continue;
    if (streamlined) {
      // Children inside a collapsed pane as plain bullets — a blank line after <summary> lets GitHub
      // render the nested markdown list.
      lines.push(`  <details><summary>ships ${unit.children.length} coupled</summary>`, '');
      for (const child of unit.children) lines.push(childBullet(child));
      lines.push('  </details>');
    } else {
      // granular: every child keeps its own interactive, marker'd checkbox indented under the primary.
      for (const child of unit.children) {
        lines.push(row(child, selected(child.packageName), { indent: true }));
      }
    }
  }
  // Orphans — changed packages outside every known unit — stay flat top-level checkboxes (fail-safe).
  for (const orphan of hierarchy.orphans) {
    lines.push(row(orphan, selected(orphan.packageName)));
  }
}

/**
 * Render the selection region for a set of publishable updates. With `primary` set (non-empty
 * `primaryPackages`) it renders release units — primaries as parent rows with coupled members nested
 * beneath (streamlined: read-only bullets in a collapsed pane; granular: per-child checkboxes).
 * Otherwise rows render flat, grouping target → derived prerequisites when those roles are present.
 * Every row is ticked unless its package is in `deselected`. Returns the marker-wrapped block.
 */
export function renderSelectionRegion(
  updates: VersionOutput['updates'],
  deselected: ReadonlySet<string>,
  primary?: PrimaryConfig,
): string {
  const selected = (name: string) => !deselected.has(name);
  const lines: string[] = [REGION_HEADING, '', REGION_HINT, ''];

  if (primary && primary.primaryPackages.length > 0) {
    renderHierarchical(lines, updates, selected, primary);
  } else {
    renderFlat(lines, updates, selected);
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
