import type { VersionOutput } from '@releasekit/core';
import { extractSelectionRegion, rkSelMarker, wrapSelectionRegion } from '@releasekit/core';
import semver from 'semver';

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

/** A ` (minor)`-style bump suffix derived from the package's previous→new version, when known. */
export function bumpSuffix(versionOutput: VersionOutput, packageName: string, newVersion: string): string {
  const previous = versionOutput.changelogs.find((c) => c.packageName === packageName)?.previousVersion;
  if (!previous) return '';
  const kind = semver.diff(previous, newVersion);
  return kind ? ` (${kind})` : '';
}

function checkbox(selected: boolean): string {
  return selected ? '[x]' : '[ ]';
}

function row(
  versionOutput: VersionOutput,
  update: VersionOutput['updates'][number],
  selected: boolean,
  opts: { indent?: boolean; bold?: boolean; prefix?: string } = {},
): string {
  const indent = opts.indent ? '  ' : '';
  const name = opts.bold ? `**\`${update.packageName}\`**` : `\`${update.packageName}\``;
  const prefix = opts.prefix ?? '';
  const suffix = bumpSuffix(versionOutput, update.packageName, update.newVersion);
  return `${indent}- ${checkbox(selected)} ${prefix}${name} → ${update.newVersion}${suffix} ${rkSelMarker(update.packageName)}`;
}

/**
 * Render the selection region for a set of publishable updates. When prerequisite roles are present
 * (a `--include-prerequisites` / `release:with-prerequisites` run) rows group target → its derived
 * prerequisites; otherwise they render flat. Every row is ticked unless its package is in
 * `deselected`. Returns the marker-wrapped block ready to embed in the PR body.
 */
export function renderSelectionRegion(
  versionOutput: VersionOutput,
  updates: VersionOutput['updates'],
  deselected: ReadonlySet<string>,
): string {
  const selected = (name: string) => !deselected.has(name);
  const lines: string[] = [REGION_HEADING, '', REGION_HINT, ''];
  const prerequisites = updates.filter((u) => u.role === 'prerequisite');
  const rendered = new Set<string>();

  if (prerequisites.length > 0) {
    for (const target of updates.filter((u) => u.role === 'target')) {
      lines.push(row(versionOutput, target, selected(target.packageName), { bold: true }));
      rendered.add(target.packageName);
      for (const prereq of prerequisites.filter((p) => p.prerequisiteOf?.includes(target.packageName))) {
        lines.push(
          row(versionOutput, prereq, selected(prereq.packageName), { indent: true, prefix: '↳ prerequisite ' }),
        );
        rendered.add(prereq.packageName);
      }
    }
  }
  // Flat rows for the plain-async case, and for any prerequisite whose target had no update entry of
  // its own (it would otherwise be silently dropped — see renderPrerequisiteSet's orphan handling).
  for (const update of updates.filter((u) => !rendered.has(u.packageName))) {
    lines.push(row(versionOutput, update, selected(update.packageName)));
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
      warnings.push({
        packageName: update.packageName,
        reason: `\`${update.packageName}\` belongs to independent group \`${update.group}\` — unticking it ships a partial group.`,
      });
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
