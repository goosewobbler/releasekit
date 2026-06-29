export interface LabelConfig {
  graduate: string;
  /** Prefix for per-package graduate labels (`graduate:<package>`); see #486. */
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

/**
 * The configured per-package graduate prefix, falling back to the default when a (possibly partial)
 * config omits it — an empty/absent prefix would otherwise match every label or crash on `startsWith`.
 */
function graduatePrefix(labels: Partial<LabelConfig> | undefined): string {
  return labels?.graduatePackagePrefix || DEFAULT_LABELS.graduatePackagePrefix;
}

/**
 * The per-package graduate label for a package (#486), e.g. `graduate:@scope/pkg`. Adding it to the
 * standing PR graduates that one prerelease package (and its fixed/linked group) to stable.
 */
export function graduatePackageLabel(packageName: string, labels?: Partial<LabelConfig>): string {
  return `${graduatePrefix(labels)}${packageName}`;
}

/**
 * Whether a label is a per-package graduate label (#486). The prefix alone (no package suffix) is not
 * a valid per-package graduate, so it doesn't match. Comparison is case-insensitive to mirror
 * GitHub's case-insensitive label uniqueness.
 */
export function isGraduatePackageLabel(label: string, labels?: Partial<LabelConfig>): boolean {
  const prefix = graduatePrefix(labels);
  return label.length > prefix.length && label.toLowerCase().startsWith(prefix.toLowerCase());
}

/**
 * The package name carried by a per-package graduate label (#486), or `undefined` when the label
 * isn't one. `graduate:@scope/pkg` → `@scope/pkg`.
 */
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
 * `release:graduate` wins over everything and returns undefined (graduation is bump-less).
 */
export function composeBumpFromLabels(prLabels: string[], labels: LabelConfig = DEFAULT_LABELS): string | undefined {
  if (prLabels.includes(labels.graduate)) return undefined;

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
