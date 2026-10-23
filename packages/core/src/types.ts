export interface VersionChangelogEntry {
  type: string;
  description: string;
  issueIds?: string[];
  /**
   * The PR this entry shipped through, from the trailing `(#N)` GitHub appends to a squash-merge subject. Marks which
   * of the {@link issueIds} is the PR (the rest are closed issues); the number stays in `issueIds` too, so a consumer
   * that ignores this field still shows the ref. Absent when there's no identifiable PR (a non-squash commit or an
   * old manifest).
   */
  prNumber?: string;
  scope?: string;
  originalType?: string;
  breaking?: boolean;
  /**
   * True when this entry is a fabricated `Update version to X` placeholder minted by the version-groups engine for a
   * lockstep carry - a group member bumped only to stay in sync, with no commits of its own. Not set on an
   * extraction-error fallback, which isn't a no-change carry.
   */
  synthetic?: boolean;
}

export interface VersionPackageChangelog {
  packageName: string;
  version: string;
  previousVersion: string | null;
  revisionRange: string;
  repoUrl: string | null;
  entries: VersionChangelogEntry[];
}

/** `'graduated'`: a prerelease promoted to stable, ignoring any requested bump. `'first-release'`: no prior tag. */
export type VersionAction = 'first-release' | 'graduated' | 'bumped';

export type ReleaseChannel = 'stable' | 'prerelease';

/**
 * Hand-rolled because core doesn't depend on semver. Build metadata (after `+`) may itself contain `-`, so only the
 * part before it is checked.
 */
export function deriveReleaseChannel(version: string): ReleaseChannel {
  const buildIdx = version.indexOf('+');
  const core = buildIdx === -1 ? version : version.slice(0, buildIdx);
  return core.includes('-') ? 'prerelease' : 'stable';
}

/**
 * The `data` of @releasekit/version's `--json` envelope, passed between pipeline stages and persisted in standing-PR
 * manifests. Open PRs carry old manifests, so new fields must be optional and consumers must tolerate their absence.
 */
export interface VersionOutput {
  dryRun: boolean;
  /** Absent in older manifests. */
  strategy?: 'sync' | 'single' | 'async' | 'group';
  updates: VersionPackageUpdate[];
  changelogs: VersionPackageChangelog[];
  /** Entries from commits that touch no package directory. */
  sharedEntries?: VersionChangelogEntry[];
  commitMessage?: string;
  /** Consumer-facing tags from `tagTemplate`. */
  tags: string[];
  /**
   * Internal baseline-marker tags from `baselineTagTemplate`, pushed alongside `tags` but never given a GitHub
   * Release. They let later runs find the previous release on the source branch when the consumer-facing tag has
   * been force-moved off it.
   */
  baselineTags?: string[];
}

export interface VersionPackageUpdate {
  packageName: string;
  newVersion: string;
  /**
   * In the same consumer-tag display form as {@link VersionPackageChangelog.previousVersion}. Absent for a first
   * release, when the baseline was unreachable or fell back to all-history, and in older manifests.
   */
  previousVersion?: string;
  filePath: string;
  /** Absent when all packages share one tag. */
  tag?: string;
  /**
   * The workspace-root package.json, bumped only to keep the root version in lockstep. Not a publishable package, so
   * exclude it from package counts and lists.
   */
  isRoot?: boolean;
  group?: string;
  /**
   * Set in an `--include-prerequisites` release: `'target'` is an explicitly-selected (group-expanded) package that
   * gets the bump/prerelease/stable override; `'prerequisite'` is a changed transitive dependency pulled in to keep
   * the targets installable, which keeps its own commit-driven bump. Absent on plain releases and for the root
   * lockstep bump - treat an absent role as a target.
   */
  role?: 'target' | 'prerequisite';
  prerequisiteOf?: string[];
  /** Absent in older manifests. */
  action?: VersionAction;
  actionReason?: string;
  /** Absent in older manifests - re-derive it with {@link deriveReleaseChannel}. */
  channel?: ReleaseChannel;
}
