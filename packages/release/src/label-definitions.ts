import type { Octokit } from '@octokit/rest';
import type { CIConfig } from '@releasekit/config';
import { DEFAULT_LABELS } from './label-utils.js';

/**
 * Canonical definition of a label ReleaseKit relies on. `name` honours `ci.labels` renames
 * and `ci.scopeLabels` keys; `color`/`description` are fixed canonical values applied on
 * create. The colours are grouped by family so the label picker reads coherently.
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
 */
export function deriveLabelDefinitions(ciConfig: CIConfig | undefined): LabelDefinition[] {
  const labels = ciConfig?.labels ?? DEFAULT_LABELS;
  const scopeLabels = ciConfig?.scopeLabels ?? {};
  const standingPrLabels = ciConfig?.standingPr?.labels ?? ['release'];

  const definitions: LabelDefinition[] = [
    { name: labels.patch, color: COLOR_BUMP, description: 'ReleaseKit: request a patch version bump' },
    { name: labels.minor, color: COLOR_BUMP, description: 'ReleaseKit: request a minor version bump' },
    { name: labels.major, color: COLOR_BUMP, description: 'ReleaseKit: request a major version bump' },
    { name: labels.stable, color: COLOR_CHANNEL, description: 'ReleaseKit: release to the stable channel' },
    {
      name: labels.prerelease,
      color: COLOR_CHANNEL,
      description: 'ReleaseKit: release to the prerelease channel',
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
  ];

  for (const scopeLabel of Object.keys(scopeLabels)) {
    definitions.push({
      name: scopeLabel,
      color: COLOR_SCOPE,
      description: 'ReleaseKit: scope the release to a subset of packages',
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
async function listRepoLabelNames(octokit: Octokit, owner: string, repo: string): Promise<Set<string>> {
  const names = new Set<string>();
  const iterator = octokit.paginate.iterator(octokit.rest.issues.listLabelsForRepo, {
    owner,
    repo,
    per_page: 100,
  });
  for await (const response of iterator) {
    for (const label of response.data) {
      names.add(label.name.toLowerCase());
    }
  }
  return names;
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
export async function syncLabels(
  octokit: Octokit,
  owner: string,
  repo: string,
  definitions: LabelDefinition[],
): Promise<LabelSyncResult> {
  const created: string[] = [];
  const existing: string[] = [];

  for (const def of definitions) {
    try {
      await octokit.rest.issues.createLabel({
        owner,
        repo,
        name: def.name,
        color: def.color,
        description: def.description,
      });
      created.push(def.name);
    } catch (err) {
      // 422 means the label already exists — that's the idempotent happy path. Any other
      // status is a real failure (auth, rate limit) and should surface to the caller.
      if (isAlreadyExistsError(err)) {
        existing.push(def.name);
      } else {
        throw err;
      }
    }
  }

  return { created, existing };
}

/**
 * Check (no mutations) which config-implied labels are missing from the repo. Returns the list
 * of missing label names; an empty list means the repo is fully provisioned.
 */
export async function checkLabels(
  octokit: Octokit,
  owner: string,
  repo: string,
  definitions: LabelDefinition[],
): Promise<{ missing: string[]; present: string[] }> {
  const existing = await listRepoLabelNames(octokit, owner, repo);
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

function isAlreadyExistsError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const status = (err as { status?: number }).status;
  return status === 422;
}
