import type { CIConfig } from '@releasekit/config';
import type { Forge } from '@releasekit/forge';
import { DEFAULT_LABELS, graduatePackageLabel } from './label-utils.js';

/** `color` and `description` apply only on create; an existing label is left as is. */
export interface LabelDefinition {
  name: string;
  color: string;
  description: string;
}

const COLOR_BUMP = '0e8a16'; // green - magnitude controls
const COLOR_CHANNEL = '1d76db'; // blue - release channel
const COLOR_RELEASE = 'd93f0b'; // orange - release-flow toggles
const COLOR_SCOPE = '5319e7'; // purple - scope targeting
const COLOR_STANDING = 'ededed'; // grey - standing PR markers

/**
 * `graduatablePackages` seeds the `graduate:<package>` labels, since GitHub can only apply labels that exist. Callers
 * without it (the label-sync command) omit it; the next standing-PR update mints them.
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

  // Channel-blue like the prerelease label: they steer channel.
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

  // A rename or scope label can collide with a reserved name; the first definition wins.
  const seen = new Set<string>();
  return definitions.filter((def) => {
    if (!def.name || seen.has(def.name)) {
      return false;
    }
    seen.add(def.name);
    return true;
  });
}

/** Lowercased: GitHub label names are unique case-insensitively. */
async function listRepoLabelNames(forge: Forge): Promise<Set<string>> {
  const names = await forge.listLabelNames();
  return new Set(names.map((name) => name.toLowerCase()));
}

export interface LabelSyncResult {
  created: string[];
  existing: string[];
}

/** Existing labels are never requested: Octokit logs each rejected create as a 422, which reads like a CI failure. */
export async function syncLabels(forge: Forge, definitions: LabelDefinition[]): Promise<LabelSyncResult> {
  const repoLabels = await listRepoLabelNames(forge);
  const created: string[] = [];
  const existing: string[] = [];

  for (const def of definitions) {
    if (repoLabels.has(def.name.toLowerCase())) {
      existing.push(def.name);
      continue;
    }
    const result = await forge.createLabel({ name: def.name, color: def.color, description: def.description });
    repoLabels.add(def.name.toLowerCase());
    (result === 'created' ? created : existing).push(def.name);
  }

  return { created, existing };
}

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
