import type { ReleaseChannel, VersionOutput } from '@releasekit/core';
import {
  deriveReleaseChannel,
  extractSelectionRegion,
  matchesPackageTarget,
  rkGradMarker,
  rkPreMarker,
  rkSelMarker,
  shouldMatchPackageTargets,
  wrapSelectionRegion,
} from '@releasekit/core';
import { getDistTag } from '@releasekit/publish';

type Update = VersionOutput['updates'][number];

/**
 * The standing-PR body's selection region: a task list where a ticked row releases that package on the next merge.
 * State round-trips by marker slicing, never prose: identity comes from each row's `<!-- rk-sel:NAME -->` marker and
 * the checked state only from the `[x]`/`[ ]` glyph, the one thing a human can toggle.
 */

const REGION_HEADING = '### Packages to release';
const REGION_HINT =
  '> Untick a package to hold it back from the next release, then save — the bot re-runs and updates this PR. ' +
  'Keep the `<!-- rk-sel... -->` marker comments; they identify each row.';

const CHANNEL_ORDER: readonly ReleaseChannel[] = ['stable', 'prerelease'] as const;

/** Generic because each prerelease row carries its own dist-tag. */
const SECTION_HEADING: Record<ReleaseChannel, string> = {
  stable: '#### Stable — advancing on `latest`',
  prerelease: '#### Prereleases — advancing on their pre-release dist-tag',
};

function checkbox(selected: boolean): string {
  return selected ? '[x]' : '[ ]';
}

/** Derived from the version when absent: manifests in still-open PRs can predate the `channel` field. */
function channelOf(update: Update): ReleaseChannel {
  return update.channel ?? deriveReleaseChannel(update.newVersion);
}

/** An unchanged primary inherits its members' channel, single by construction for `linked`/`fixed` groups. */
function unitChannel(unit: ReleaseUnit): ReleaseChannel {
  if (unit.primaryUpdate) {
    return channelOf(unit.primaryUpdate);
  }
  const child = unit.children[0];
  return child ? channelOf(child) : 'stable';
}

function byChannel<T>(items: readonly T[], key: (item: T) => ReleaseChannel): Map<ReleaseChannel, T[]> {
  const map = new Map<ReleaseChannel, T[]>();
  for (const item of items) {
    const k = key(item);
    const list = map.get(k);
    if (list) {
      list.push(item);
    } else {
      map.set(k, [item]);
    }
  }
  return map;
}

function pushSectionHeading(lines: string[], channel: ReleaseChannel): void {
  if (lines[lines.length - 1] !== '') {
    lines.push('');
  }
  lines.push(SECTION_HEADING[channel], '');
}

function versionDisplay(update: Update): string {
  if (channelOf(update) !== 'prerelease') {
    return update.newVersion;
  }
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

export interface PrimaryConfig {
  primaryPackages: string[];
  /** streamlined: one toggle per primary, children cascade. granular: every package keeps its own toggle. */
  selection: 'streamlined' | 'granular';
  groups: Record<string, { sync?: string; packages?: string[] }>;
  /** Needed to resolve a primary that isn't bumping, which never appears in `updates`. */
  allPackageNames: string[];
}

export interface ReleaseUnit {
  primaryName: string;
  /** Absent when the primary isn't bumping but still anchors changed members (common under `linked`). */
  primaryUpdate?: Update;
  children: Update[];
  groupSync?: string;
}

export interface SelectionHierarchy {
  units: ReleaseUnit[];
  /** Changed packages outside every unit. */
  orphans: Update[];
  /** A child can ship with several primaries. */
  childOwners: Map<string, string[]>;
  primaryNames: Set<string>;
}

/**
 * `children(P) = (P's group-mates ∪ P's changed prerequisites) ∩ releasing − declaredPrimaries`, so a primary that is
 * another's group-mate stays a top-level peer. A primary anchors a unit when it or any member of its closure is
 * bumping.
 */
export function computeHierarchy(updates: Update[], cfg: PrimaryConfig): SelectionHierarchy {
  const { primaryPackages, groups, allPackageNames } = cfg;
  const updateByName = new Map(updates.map((u) => [u.packageName, u]));
  const declaredPrimaryNames = new Set(allPackageNames.filter((n) => shouldMatchPackageTargets(n, primaryPackages)));

  // A changed primary carries its group on its update; an unchanged one is resolved from config.
  const groupOfPrimary = (p: string): string | undefined => {
    const own = updateByName.get(p)?.group;
    if (own) {
      return own;
    }
    for (const [name, gc] of Object.entries(groups)) {
      if (shouldMatchPackageTargets(p, gc.packages ?? [])) {
        return name;
      }
    }
    return undefined;
  };

  const childrenOf = (p: string): Update[] => {
    const group = groupOfPrimary(p);
    const seen = new Set<string>();
    const result: Update[] = [];
    const add = (u: Update) => {
      if (u.packageName === p || declaredPrimaryNames.has(u.packageName) || seen.has(u.packageName)) {
        return;
      }
      seen.add(u.packageName);
      result.push(u);
    };
    if (group) {
      for (const u of updates) {
        if (u.group === group) {
          add(u);
        }
      }
    }
    for (const u of updates) {
      if (u.role === 'prerequisite' && u.prerequisiteOf?.includes(p)) {
        add(u);
      }
    }
    return result.sort((a, b) => a.packageName.localeCompare(b.packageName));
  };

  const units: ReleaseUnit[] = [];
  const childOwners = new Map<string, string[]>();
  const claimed = new Set<string>();
  for (const primaryName of [...declaredPrimaryNames].sort((a, b) => a.localeCompare(b))) {
    const children = childrenOf(primaryName);
    const primaryUpdate = updateByName.get(primaryName);
    if (!primaryUpdate && children.length === 0) {
      continue;
    }
    const group = groupOfPrimary(primaryName);
    const groupSync = group ? groups[group]?.sync : undefined;
    units.push({ primaryName, primaryUpdate, children, groupSync });
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

/** A child is held back only when every primary owning it is, so a shared package releases while any owner does. */
export function cascadeDeselection(hierarchy: SelectionHierarchy, deselected: ReadonlySet<string>): Set<string> {
  const effective = new Set<string>();
  const deselectedPrimaries = new Set(
    hierarchy.units.filter((u) => deselected.has(u.primaryName)).map((u) => u.primaryName),
  );
  // A held-back child only arrives from a flat body on the first run after `primaryPackages` is enabled (streamlined
  // children carry no marker). Hold its whole unit: a held-back package must never silently ship.
  for (const [child, owners] of hierarchy.childOwners) {
    if (deselected.has(child)) {
      for (const owner of owners) {
        deselectedPrimaries.add(owner);
      }
    }
  }
  for (const p of deselectedPrimaries) {
    effective.add(p);
  }
  for (const orphan of hierarchy.orphans) {
    if (deselected.has(orphan.packageName)) {
      effective.add(orphan.packageName);
    }
  }
  for (const [child, owners] of hierarchy.childOwners) {
    if (owners.every((o) => deselectedPrimaries.has(o))) {
      effective.add(child);
    }
  }
  return effective;
}

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

function primaryRow(unit: ReleaseUnit, selected: boolean): string {
  const label = unit.primaryUpdate ? `→ ${versionDisplay(unit.primaryUpdate)}` : '— no change';
  return `- ${checkbox(selected)} **\`${unit.primaryName}\`** ${label} ${rkSelMarker(unit.primaryName)}`;
}

/** `independent` members version on their own lines but ship atomically (`bundled`); `fixed`/`linked` members
 *  share a version (`coupled`). */
function couplingWord(groupSync?: string): string {
  return groupSync === 'independent' ? 'bundled' : 'coupled';
}

/** A prerequisite isn't a group member, so it keeps the neutral `coupled` wording. */
function childWord(child: Update, groupSync?: string): string {
  return child.role === 'prerequisite' ? 'coupled' : couplingWord(groupSync);
}

function unitWord(unit: ReleaseUnit): string {
  return unit.children.some((c) => childWord(c, unit.groupSync) === 'bundled') ? 'bundled' : 'coupled';
}

/** Never a task item (GitHub would make it interactive and fight the cascade) and markerless: its state derives
 *  from its primary each run. */
function childBullet(child: Update, groupSync?: string): string {
  return `  - \`${child.packageName}\` → ${versionDisplay(child)} · ${childWord(child, groupSync)}`;
}

/** Injected so this module stays free of changelog formatting (see changelog-region.ts). */
export type RowChangelogRenderer = (packageNames: string[], heldBack: boolean, indent: string) => string;

function attachChangelog(
  lines: string[],
  rowChangelog: RowChangelogRenderer | undefined,
  packageNames: string[],
  heldBack: boolean,
  indent: string,
): void {
  if (!rowChangelog) {
    return;
  }
  const block = rowChangelog(packageNames, heldBack, indent);
  if (block) {
    lines.push(block);
  }
}

/** Shifts one package's channel without narrowing the release; ticks round-trip via {@link extractChannelSelection}. */
export interface ChannelToggleConfig {
  prereleased: ReadonlySet<string>;
  graduated: ReadonlySet<string>;
  prereleaseIdentifier?: string;
}

function stableBase(version: string): string {
  return version.split('-')[0] ?? version;
}

function attachChannelToggle(
  lines: string[],
  update: Update,
  selected: boolean,
  indent: string,
  channel: ChannelToggleConfig | undefined,
): void {
  if (!channel || !selected) {
    return;
  }
  const name = update.packageName;
  if (channelOf(update) === 'stable') {
    const preid = channel.prereleaseIdentifier ?? 'next';
    const ticked = channel.prereleased.has(name);
    lines.push(
      `${indent}- ${checkbox(ticked)} ship as prerelease → \`${update.newVersion}-${preid}.0\` · \`${preid}\` ${rkPreMarker(name)}`,
    );
  } else {
    const ticked = channel.graduated.has(name);
    lines.push(
      `${indent}- ${checkbox(ticked)} graduate to stable → \`${stableBase(update.newVersion)}\` ${rkGradMarker(name)}`,
    );
  }
}

function renderFlatSection(
  lines: string[],
  updates: Update[],
  selected: (name: string) => boolean,
  rowChangelog?: RowChangelogRenderer,
  channel?: ChannelToggleConfig,
): void {
  const prerequisites = updates.filter((u) => u.role === 'prerequisite');
  const rendered = new Set<string>();
  if (prerequisites.length > 0) {
    for (const target of updates.filter((u) => u.role === 'target')) {
      lines.push(row(target, selected(target.packageName), { bold: true }));
      rendered.add(target.packageName);
      attachChannelToggle(lines, target, selected(target.packageName), '  ', channel);
      attachChangelog(lines, rowChangelog, [target.packageName], !selected(target.packageName), '  ');
      for (const prereq of prerequisites.filter((p) => p.prerequisiteOf?.includes(target.packageName))) {
        lines.push(row(prereq, selected(prereq.packageName), { indent: true, prefix: '↳ prerequisite ' }));
        rendered.add(prereq.packageName);
        attachChannelToggle(lines, prereq, selected(prereq.packageName), '    ', channel);
        attachChangelog(lines, rowChangelog, [prereq.packageName], !selected(prereq.packageName), '    ');
      }
    }
  }
  // Also catches a prerequisite whose target has no update entry of its own, which would otherwise be dropped.
  for (const update of updates.filter((u) => !rendered.has(u.packageName))) {
    lines.push(row(update, selected(update.packageName)));
    attachChannelToggle(lines, update, selected(update.packageName), '  ', channel);
    attachChangelog(lines, rowChangelog, [update.packageName], !selected(update.packageName), '  ');
  }
}

/** A cross-channel prerequisite (e.g. a `-next` dependency of a stable target) lands in its own channel section as
 *  a flat row without the `↳` label: channel grouping wins over prerequisite nesting. */
function renderFlat(
  lines: string[],
  updates: Update[],
  selected: (name: string) => boolean,
  rowChangelog?: RowChangelogRenderer,
  channelToggle?: ChannelToggleConfig,
): void {
  const updatesByChannel = byChannel(updates, channelOf);
  const channels = CHANNEL_ORDER.filter((c) => (updatesByChannel.get(c)?.length ?? 0) > 0);
  const showHeadings = channels.length > 1;
  for (const channel of channels) {
    if (showHeadings) {
      pushSectionHeading(lines, channel);
    }
    renderFlatSection(lines, updatesByChannel.get(channel) ?? [], selected, rowChangelog, channelToggle);
  }
}

function renderUnit(
  lines: string[],
  unit: ReleaseUnit,
  selected: (name: string) => boolean,
  streamlined: boolean,
  rowChangelog?: RowChangelogRenderer,
  channel?: ChannelToggleConfig,
): void {
  lines.push(primaryRow(unit, selected(unit.primaryName)));
  const heldBack = !selected(unit.primaryName);
  // An unchanged primary has no version to shift, so no toggle; a changed one's toggle shifts its whole group.
  if (unit.primaryUpdate) {
    attachChannelToggle(lines, unit.primaryUpdate, !heldBack, '  ', channel);
  }
  if (streamlined) {
    if (unit.children.length > 0) {
      // The blank line after <summary> lets GitHub render the nested markdown list.
      lines.push(`  <details><summary>ships ${unit.children.length} ${unitWord(unit)}</summary>`, '');
      for (const child of unit.children) {
        lines.push(childBullet(child, unit.groupSync));
      }
      lines.push('  </details>');
    }
    // The unit ships together, so its changelog aggregates every member; a shared prerequisite repeats under each
    // owner.
    attachChangelog(
      lines,
      rowChangelog,
      [unit.primaryName, ...unit.children.map((c) => c.packageName)],
      heldBack,
      '  ',
    );
  } else {
    attachChangelog(lines, rowChangelog, [unit.primaryName], heldBack, '  ');
    for (const child of unit.children) {
      lines.push(row(child, selected(child.packageName), { indent: true }));
      attachChannelToggle(lines, child, selected(child.packageName), '    ', channel);
      attachChangelog(lines, rowChangelog, [child.packageName], !selected(child.packageName), '    ');
    }
  }
}

function renderOrphan(
  lines: string[],
  orphan: Update,
  selected: (name: string) => boolean,
  rowChangelog?: RowChangelogRenderer,
  channel?: ChannelToggleConfig,
): void {
  lines.push(row(orphan, selected(orphan.packageName)));
  attachChannelToggle(lines, orphan, selected(orphan.packageName), '  ', channel);
  attachChangelog(lines, rowChangelog, [orphan.packageName], !selected(orphan.packageName), '  ');
}

function renderHierarchical(
  lines: string[],
  updates: Update[],
  selected: (name: string) => boolean,
  primary: PrimaryConfig,
  rowChangelog?: RowChangelogRenderer,
  channelToggle?: ChannelToggleConfig,
): void {
  const hierarchy = computeHierarchy(updates, primary);
  const streamlined = primary.selection !== 'granular';
  // A unit stays intact in its primary's channel section.
  const unitsByChannel = byChannel(hierarchy.units, unitChannel);
  const orphansByChannel = byChannel(hierarchy.orphans, channelOf);
  const channels = CHANNEL_ORDER.filter(
    (c) => (unitsByChannel.get(c)?.length ?? 0) > 0 || (orphansByChannel.get(c)?.length ?? 0) > 0,
  );
  const showHeadings = channels.length > 1;
  for (const channel of channels) {
    if (showHeadings) {
      pushSectionHeading(lines, channel);
    }
    for (const unit of unitsByChannel.get(channel) ?? []) {
      renderUnit(lines, unit, selected, streamlined, rowChangelog, channelToggle);
    }
    for (const orphan of orphansByChannel.get(channel) ?? []) {
      renderOrphan(lines, orphan, selected, rowChangelog, channelToggle);
    }
  }
}

export function renderSelectionRegion(
  updates: VersionOutput['updates'],
  deselected: ReadonlySet<string>,
  primary?: PrimaryConfig,
  rowChangelog?: RowChangelogRenderer,
  channelToggle?: ChannelToggleConfig,
): string {
  const selected = (name: string) => !deselected.has(name);
  const lines: string[] = [REGION_HEADING, '', REGION_HINT, ''];

  if (primary && primary.primaryPackages.length > 0) {
    renderHierarchical(lines, updates, selected, primary, rowChangelog, channelToggle);
  } else {
    renderFlat(lines, updates, selected, rowChangelog, channelToggle);
  }

  return wrapSelectionRegion(lines.join('\n'));
}

/** `undefined` when the body has no selection region (a sync release, or a body predating the feature). */
export function extractSelection(body: string): { deselected: string[] } | undefined {
  const region = extractSelectionRegion(body);
  if (region === undefined) {
    return undefined;
  }

  const deselected: string[] = [];
  for (const line of region.split('\n')) {
    const markerStart = line.indexOf('<!-- rk-sel:');
    if (markerStart === -1) {
      continue;
    }
    const nameStart = markerStart + '<!-- rk-sel:'.length;
    const nameEnd = line.indexOf(' -->', nameStart);
    if (nameEnd === -1) {
      continue;
    }
    const name = line.slice(nameStart, nameEnd);
    // Selected unless explicitly empty; a fixed substring check, not a backtracking regex.
    if (line.slice(0, markerStart).includes('[ ]')) {
      deselected.push(name);
    }
  }
  return { deselected };
}

function markerHits(region: string, marker: string): Array<{ name: string; ticked: boolean; unticked: boolean }> {
  const open = `<!-- ${marker}:`;
  const hits: Array<{ name: string; ticked: boolean; unticked: boolean }> = [];
  for (const line of region.split('\n')) {
    const markerStart = line.indexOf(open);
    if (markerStart === -1) {
      continue;
    }
    const nameStart = markerStart + open.length;
    const nameEnd = line.indexOf(' -->', nameStart);
    if (nameEnd === -1) {
      continue;
    }
    const before = line.slice(0, markerStart);
    hits.push({
      name: line.slice(nameStart, nameEnd),
      ticked: before.includes('[x]'),
      unticked: before.includes('[ ]'),
    });
  }
  return hits;
}

/** A held-back row's channel toggle is dropped: its channel is moot. */
export function extractChannelSelection(body: string): { prereleased: string[]; graduated: string[] } {
  const region = extractSelectionRegion(body);
  if (region === undefined) {
    return { prereleased: [], graduated: [] };
  }
  const heldBack = new Set(
    markerHits(region, 'rk-sel')
      .filter((h) => h.unticked)
      .map((h) => h.name),
  );
  const pick = (marker: string): string[] =>
    markerHits(region, marker)
      .filter((h) => h.ticked && !heldBack.has(h.name))
      .map((h) => h.name);
  return { prereleased: pick('rk-pre'), graduated: pick('rk-grad') };
}

/**
 * The `rk-pre` toggle is the explicit in-body action, so it wins over a graduate label or `rk-grad` naming the same
 * package. Otherwise the engine's `stableOnly` would silently publish stable while the PR shows the toggle ticked.
 */
export function resolveChannelConflicts(
  graduate: readonly string[],
  prereleaseScope: readonly string[],
): { graduate: string[]; conflicts: string[] } {
  // Graduate entries can be globs (prereleaseScope never is), so match by target rather than string equality.
  const conflicts = graduate.filter((target) =>
    prereleaseScope.some((name) => shouldMatchPackageTargets(name, [target])),
  );
  const conflicting = new Set(conflicts);
  return {
    graduate: graduate.filter((target) => !conflicting.has(target)),
    conflicts,
  };
}

export interface SelectionWarning {
  packageName: string;
  reason: string;
}

/** Lockstep (`fixed`/`linked`) members aren't warned about: upstream ignores their untick. */
export function selectionWarnings(
  updates: VersionOutput['updates'],
  deselected: ReadonlySet<string>,
  groups: Record<string, { sync?: string }>,
): SelectionWarning[] {
  const warnings: SelectionWarning[] = [];
  for (const update of updates) {
    if (!deselected.has(update.packageName)) {
      continue;
    }
    if (update.group && groups[update.group]?.sync === 'independent') {
      // A primary cascading the whole group out is coherent; only a partial hold-back splits it.
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
