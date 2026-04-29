export interface LabelConfig {
  stable: string;
  prerelease: string;
  skip: string;
  major: string;
  minor: string;
  patch: string;
}

export const DEFAULT_LABELS: LabelConfig = {
  stable: 'release:stable',
  prerelease: 'release:prerelease',
  skip: 'release:skip',
  major: 'bump:major',
  minor: 'bump:minor',
  patch: 'bump:patch',
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
