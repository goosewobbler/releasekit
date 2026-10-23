export interface LabelConfig {
  graduate: string;
  graduatePackagePrefix: string;
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
  graduate: 'release:graduate',
  graduatePackagePrefix: 'graduate:',
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

/** Falls back on an empty prefix too, which would otherwise match every label. */
function graduatePrefix(labels: Partial<LabelConfig> | undefined): string {
  return labels?.graduatePackagePrefix || DEFAULT_LABELS.graduatePackagePrefix;
}

export function graduatePackageLabel(packageName: string, labels?: Partial<LabelConfig>): string {
  return `${graduatePrefix(labels)}${packageName}`;
}

/** Case-insensitive, like GitHub's label uniqueness. The bare prefix doesn't match. */
export function isGraduatePackageLabel(label: string, labels?: Partial<LabelConfig>): boolean {
  const prefix = graduatePrefix(labels);
  return label.length > prefix.length && label.toLowerCase().startsWith(prefix.toLowerCase());
}

export function graduatedPackageFromLabel(label: string, labels?: Partial<LabelConfig>): string | undefined {
  return isGraduatePackageLabel(label, labels) ? label.slice(graduatePrefix(labels).length) : undefined;
}

export interface LabelConflictResult {
  bumpConflict: boolean;
  bumpLabelsPresent: string[];
  prereleaseConflict: boolean;
  hasGraduate: boolean;
  hasPrerelease: boolean;
}

export function detectLabelConflicts(prLabels: string[], labels: LabelConfig = DEFAULT_LABELS): LabelConflictResult {
  const bumpLabelsPresent = [
    prLabels.includes(labels.major) && labels.major,
    prLabels.includes(labels.minor) && labels.minor,
    prLabels.includes(labels.patch) && labels.patch,
  ].filter(Boolean) as string[];

  const bumpConflict = bumpLabelsPresent.length > 1;

  const hasGraduate = prLabels.includes(labels.graduate);
  const hasPrerelease = prLabels.includes(labels.prerelease);
  const prereleaseConflict = hasGraduate && hasPrerelease;

  return {
    bumpConflict,
    bumpLabelsPresent,
    prereleaseConflict,
    hasGraduate,
    hasPrerelease,
  };
}

/**
 * The single source of truth for label → bump composition. Prerelease & `bump:*` composes a `pre*` bump, which
 * escalates to a fresh line (`bump:major` on `1.1.1-next.1` → `2.0.0-next.0`); `major` plus a separate prerelease
 * flag would only increment the existing line. The prerelease label alone iterates it. Graduation is bump-less.
 */
export function composeBumpFromLabels(prLabels: string[], labels: LabelConfig = DEFAULT_LABELS): string | undefined {
  if (prLabels.includes(labels.graduate)) {
    return undefined;
  }

  if (prLabels.includes(labels.prerelease)) {
    if (prLabels.includes(labels.major)) {
      return 'premajor';
    }
    if (prLabels.includes(labels.minor)) {
      return 'preminor';
    }
    if (prLabels.includes(labels.patch)) {
      return 'prepatch';
    }
    return 'prerelease';
  }

  if (prLabels.includes(labels.major)) {
    return 'major';
  }
  if (prLabels.includes(labels.minor)) {
    return 'minor';
  }
  if (prLabels.includes(labels.patch)) {
    return 'patch';
  }
  return undefined;
}
