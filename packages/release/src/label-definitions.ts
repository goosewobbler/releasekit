import type { CIConfig } from '@releasekit/config';
import type { Forge } from '@releasekit/forge';
import { DEFAULT_LABELS, graduatePackageLabel } from './label-utils.js';

/**
 * Canonical definition of a label ReleaseKit relies on. `name` honours `ci.labels` renames
 * and `ci.scopeLabels` keys; `color`/`description` are fixed canonical values applied on create.
 */
export interface LabelDefinition {
  name: string;
  color: string;
  description: string;
}

// Colours are grouped by family so labels are visually scannable in the GitHub picker.
const COLOR_BUMP = '0e8a16'; // green — magnitude controls
const COLOR_CHANNEL = '1d76db'; // blue — release channel
const COLOR_RELEASE = 'd93f0b'; // orange — release-flow toggles
const COLOR_SCOPE = '5319e7'; // purple — scope targeting
const COLOR_STANDING = 'ededed'; // grey — standing PR markers (matches legacy createLabel colour)

/**
 * Derive the full set of labels implied by the resolved config: bump magnitudes, channel
 * modifiers, the release-flow toggles, every configured `scope:*` label, and the standing-PR
 * labels. Honours `ci.labels` renames and `ci.scopeLabels`. The result is deduped by name —
 * if a rename collides with another label (or a scope label reuses a reserved name) the first
 * definition wins, so we never emit two definitions for the same label name.
 *
 * `graduatablePackages` (#486) seeds the per-package `graduate:<package>` labels — GitHub can only
 * apply labels that already exist, so the standing-PR update passes the names of packages currently
 * on a prerelease line so a maintainer can pick one from the label picker. Callers without that
 * context (the label-sync command) omit it; those labels are then minted lazily on the next update.
 */
export function deriveLabelDefinitions(
  ciConfig: CIConfig | undefined,
  graduatablePackages: string[] = [],
): LabelDefinition[] {
  const labels = ciConfig?.labels ?? DEFAULT_LABELS;
  const scopeLabels = ciConfig?.scopeLabels ?? {};
  const standingPrLabels = ciConfig?.standingPr?.labels ?? ['release'];

  const definitions: LabelDefinition[] = [
    { name: labels.patch, color: COLOR_BUMP, description: 'ReleaseKit: request a patch version bump' },
    { name: labels.minor, color: COLOR_BUMP, description: 'ReleaseKit: request a minor version bump' },
    { name: labels.major, color: COLOR_BUMP, description: 'ReleaseKit: request a major version bump' },
    {
      name: labels.prerelease,
      color: COLOR_CHANNEL,
      description: 'ReleaseKit: release to the prerelease channel',
    },
    {
      name: labels.graduate,
      color: COLOR_RELEASE,
      description: 'ReleaseKit: graduate a prerelease to its stable base version',
    },
    { name: labels.skip, color: COLOR_RELEASE, description: 'ReleaseKit: skip the release for this change' },
    {
      name: labels.immediate,
      color: COLOR_RELEASE,
      description: 'ReleaseKit: bypass the standing PR and release immediately',
    },
    {
      name: labels.retry,
      color: COLOR_RELEASE,
      description: 'ReleaseKit: retry a failed publish on this merged standing PR',
    },
    {
      name: labels.previewNotes,
      color: COLOR_RELEASE,
      description: 'ReleaseKit: generate editable release notes in the standing PR body',
    },
    {
      name: labels.withPrerequisites,
      color: COLOR_RELEASE,
      description: "ReleaseKit: also release the targeted packages' changed prerequisites",
    },
  ];

  for (const scopeLabel of Object.keys(scopeLabels)) {
    definitions.push({
      name: scopeLabel,
      color: COLOR_SCOPE,
      description: 'ReleaseKit: scope the release to a subset of packages',
    });
  }

  // Per-package graduate labels (#486): one `graduate:<package>` per package currently on a
  // prerelease line, so a maintainer can graduate just that package (and its lockstep group) to
  // stable from the GitHub label picker. Channel-blue like the prerelease label — they steer channel.
  for (const pkg of graduatablePackages) {
    definitions.push({
      name: graduatePackageLabel(pkg, labels),
      color: COLOR_CHANNEL,
      description: 'ReleaseKit: graduate this prerelease package to its stable base version',
    });
  }

  for (const standingLabel of standingPrLabels) {
    definitions.push({
      name: standingLabel,
      color: COLOR_STANDING,
      description: 'ReleaseKit: marks this PR for automated release',
    });
  }

  // Dedupe by name — renames or scope labels could collide with a reserved name; keep the
  // first (more specific) definition so each label is created exactly once.
  const seen = new Set<string>();
  return definitions.filter((def) => {
    if (!def.name || seen.has(def.name)) return false;
    seen.add(def.name);
    return true;
  });
}

/**
 * Fetch all label names currently defined in the repo (paginated). Returns a Set of lowercased
 * names so callers can do case-insensitive comparisons; GitHub's `createLabel` API uses
 * case-insensitive uniqueness, so `bump:minor` and `Bump:Minor` are the same label.
 */
async function listRepoLabelNames(forge: Forge): Promise<Set<string>> {
  const names = await forge.listLabelNames();
  return new Set(names.map((name) => name.toLowerCase()));
}

export interface LabelSyncResult {
  created: string[];
  existing: string[];
}

/**
 * Idempotently create every config-implied label that is missing from the repo. Already-existing
 * labels are left untouched (createLabel throws 422; ignored). Returns which labels were created
 * vs already present.
 */
export async function syncLabels(forge: Forge, definitions: LabelDefinition[]): Promise<LabelSyncResult> {
  const created: string[] = [];
  const existing: string[] = [];

  for (const def of definitions) {
    // The forge treats GitHub's "already exists" 422 as idempotent (returns 'exists') and surfaces
    // any other failure (auth, rate limit, validation) by throwing.
    const result = await forge.createLabel({ name: def.name, color: def.color, description: def.description });
    (result === 'created' ? created : existing).push(def.name);
  }

  return { created, existing };
}

/**
 * Check (no mutations) which config-implied labels are missing from the repo. Returns the list
 * of missing label names; an empty list means the repo is fully provisioned.
 */
export async function checkLabels(
  forge: Forge,
  definitions: LabelDefinition[],
): Promise<{ missing: string[]; present: string[] }> {
  const existing = await listRepoLabelNames(forge);
  const missing: string[] = [];
  const present: string[] = [];
  for (const def of definitions) {
    if (existing.has(def.name.toLowerCase())) {
      present.push(def.name);
    } else {
      missing.push(def.name);
    }
  }
  return { missing, present };
}
