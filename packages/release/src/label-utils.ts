export interface LabelConfig {
  stable: string;
  prerelease: string;
  skip: string;
  immediate: string;
  retry: string;
  previewNotes: string;
  major: string;
  minor: string;
  patch: string;
  withPrerequisites: string;
}

export const DEFAULT_LABELS: LabelConfig = {
  stable: 'channel:stable',
  prerelease: 'channel:prerelease',
  skip: 'release:skip',
  immediate: 'release:immediate',
  retry: 'release:retry',
  previewNotes: 'release:preview-notes',
  major: 'bump:major',
  minor: 'bump:minor',
  patch: 'bump:patch',
  withPrerequisites: 'release:with-prerequisites',
};

export interface LabelConflictResult {
  bumpConflict: boolean;
  bumpLabelsPresent: string[];
  prereleaseConflict: boolean;
  hasStable: boolean;
  hasPrerelease: boolean;
}

export function detectLabelConflicts(prLabels: string[], labels: LabelConfig = DEFAULT_LABELS): LabelConflictResult {
  const bumpLabelsPresent = [
    prLabels.includes(labels.major) && labels.major,
    prLabels.includes(labels.minor) && labels.minor,
    prLabels.includes(labels.patch) && labels.patch,
  ].filter(Boolean) as string[];

  const bumpConflict = bumpLabelsPresent.length > 1;

  const hasStable = prLabels.includes(labels.stable);
  const hasPrerelease = prLabels.includes(labels.prerelease);
  const prereleaseConflict = hasStable && hasPrerelease;

  return {
    bumpConflict,
    bumpLabelsPresent,
    prereleaseConflict,
    hasStable,
    hasPrerelease,
  };
}

/**
 * Compose the version bump from a PR's labels, including the prerelease channel. This is the
 * single source of truth for label → bump composition; every release path (gate, preview,
 * standing-PR) must use it so they agree on what a given label set means.
 *
 * When the prerelease label accompanies a `bump:*` label, the magnitude is composed into a
 * `pre*` bump (`premajor`/`preminor`/`prepatch`) — a *fresh* prerelease line at that magnitude.
 * Critically, `pre<type>` ESCALATES: `bump:major` + prerelease on `1.1.1-next.1` → `premajor`
 * → `2.0.0-next.0`. Passing `major` + a separate prerelease flag would instead increment the
 * existing prerelease (`1.1.1-next.2`) — the #335 degradation. To *iterate* an existing
 * prerelease (`2.0.0-next.0` → `2.0.0-next.1`), use the prerelease label alone (no `bump:*`),
 * which returns `'prerelease'`.
 *
 * `channel:stable` wins over everything and returns undefined (graduation is bump-less).
 */
export function composeBumpFromLabels(prLabels: string[], labels: LabelConfig = DEFAULT_LABELS): string | undefined {
  if (prLabels.includes(labels.stable)) return undefined;

  if (prLabels.includes(labels.prerelease)) {
    if (prLabels.includes(labels.major)) return 'premajor';
    if (prLabels.includes(labels.minor)) return 'preminor';
    if (prLabels.includes(labels.patch)) return 'prepatch';
    return 'prerelease';
  }

  if (prLabels.includes(labels.major)) return 'major';
  if (prLabels.includes(labels.minor)) return 'minor';
  if (prLabels.includes(labels.patch)) return 'patch';
  return undefined;
}
