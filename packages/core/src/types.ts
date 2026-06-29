/**
 * Shared types for the releasekit ecosystem.
 *
 * These types define the JSON contract between @releasekit/version (producer)
 * and @releasekit/notes (consumer). Changes here affect both packages.
 */

/**
 * A single changelog entry produced by @releasekit/version.
 */
export interface VersionChangelogEntry {
  type: string;
  description: string;
  issueIds?: string[];
  scope?: string;
  originalType?: string;
  breaking?: boolean;
  /**
   * True when this entry is a fabricated `Update version to X` placeholder minted by the
   * version-groups engine for a lockstep carry — a group member bumped only to stay in sync, with
   * no commits of its own. It is not derived from a real commit. The preview formatter treats a
   * changelog whose entries are *all* synthetic as "no real changes" and collapses the package into
   * the "Also bumped" list instead of rendering a full block of placeholder noise (#468).
   *
   * Only the groups engine sets it, and only on a clean empty extraction: an independently-released
   * package (single/async strategy) or an extraction-error fallback keeps its visible block, since
   * neither is a no-change carry. Optional and additive — absent means a real entry, so manifests
   * written before this field existed render exactly as before.
   */
  synthetic?: boolean;
}

/**
 * Changelog data for a single package, as emitted by @releasekit/version --json.
 */
export interface VersionPackageChangelog {
  packageName: string;
  version: string;
  previousVersion: string | null;
  revisionRange: string;
  repoUrl: string | null;
  entries: VersionChangelogEntry[];
}

/**
 * The resolved action a package's version landed on — purely additive observability (#420), it
 * never changes which version resolves. `'graduated'` means a prerelease was promoted to stable and
 * any requested bump was ignored; `'bumped'` is the ordinary commit/label-driven bump;
 * `'first-release'` is a package with no prior tag. Defined as a string-literal union (core cannot
 * import the version package, where the deriving logic lives).
 */
export type VersionAction = 'first-release' | 'graduated' | 'bumped';

/**
 * The release channel a version sits on (#485). Derived per-package and purely from the resolved
 * version: `'prerelease'` when the version carries a semver prerelease segment (`…-<preid>.N`), else
 * `'stable'`. A standing PR with permanently-mixed maturity carries both at once — some `'stable'`
 * packages, some `'prerelease'` — each advancing along its own line. #486 (per-package graduation)
 * and #487 (channel-grouped rendering) build on this.
 */
export type ReleaseChannel = 'stable' | 'prerelease';

/**
 * Derive a version's {@link ReleaseChannel}. Pure and dependency-free (core cannot import semver): a
 * semver prerelease is the hyphen-introduced segment that precedes any build-metadata `+`, so a
 * version is `'prerelease'` exactly when that leading segment contains a `-`. Consumers that only
 * hold a version string (and a manifest predating the persisted {@link VersionPackageUpdate.channel}
 * field) re-derive the channel with this.
 */
export function deriveReleaseChannel(version: string): ReleaseChannel {
  const core = version.split('+', 1)[0] ?? version;
  return core.includes('-') ? 'prerelease' : 'stable';
}

/**
 * The complete JSON output of @releasekit/version --json.
 * This is the primary interchange format between version and notes.
 */
export interface VersionOutput {
  dryRun: boolean;
  /**
   * Which versioning strategy produced this output. Lets consumers (preview, standing PR)
   * render sync releases as a single versioned unit instead of a package count. Optional
   * for backwards compatibility with manifests produced before this field existed.
   *
   * `'group'` is the version-groups engine (fixed/linked, and the implicit all-packages fixed
   * group that `version.sync: true` desugars to). `'sync'` remains for the legacy lockstep
   * strategy so existing consumers keep working unchanged.
   */
  strategy?: 'sync' | 'single' | 'async' | 'group';
  updates: VersionPackageUpdate[];
  changelogs: VersionPackageChangelog[];
  /**
   * Changelog entries from commits that don't touch any specific package directory
   * (CI, infrastructure, shared package changes). Stored separately so they can be
   * rendered once rather than duplicated across every per-package changelog.
   */
  sharedEntries?: VersionChangelogEntry[];
  commitMessage?: string;
  /** Consumer-facing tags from `tagTemplate` (e.g. `v1.2.3`). The publish pipeline pushes
   *  them and creates a GitHub Release for each. */
  tags: string[];
  /** Internal baseline-marker tags from `baselineTagTemplate` (e.g. `release/v1.2.3`).
   *  Pushed alongside `tags` but not used to create GitHub Releases — they exist purely
   *  so future version-bump and changelog calculations can find the previous release on
   *  the source branch's history when the consumer-facing tag has been force-moved off it. */
  baselineTags?: string[];
}

/**
 * A package update record in the version output.
 */
export interface VersionPackageUpdate {
  packageName: string;
  newVersion: string;
  filePath: string;
  /** Per-package git tag. Set only when each package has its own tag (async mode or sync+packageSpecificTags). Absent in sync mode with a single shared tag. */
  tag?: string;
  /**
   * True when this update is the workspace-root package.json, bumped only to keep the root
   * version in lockstep (sync mode). Root updates are not publishable packages — consumers
   * should exclude them from package counts and package lists.
   */
  isRoot?: boolean;
  /**
   * Name of the version group this package was released as part of (from `version.groups`, or
   * the implicit all-packages group that `version.sync: true` desugars to). Absent for packages
   * versioned independently. CI surfaces can use this to treat a fixed group atomically (e.g.
   * expand a scope label that matches part of a group to the whole group).
   */
  group?: string;
  /**
   * Role in a `--include-prerequisites` release: `'target'` for an explicitly-selected
   * (group-expanded) package that receives the bump/prerelease/stable override, `'prerequisite'`
   * for a changed transitive dependency pulled in to keep the targets installable (it keeps its own
   * commit-driven bump). Absent on plain releases and for the root lockstep bump — consumers treat
   * an absent role as a target.
   */
  role?: 'target' | 'prerequisite';
  /**
   * For a `'prerequisite'` update, the target package(s) it was pulled in for (a shared dependency
   * can serve several). Lets CI surfaces render "target → its prerequisites" without re-deriving
   * the dependency graph. Absent for targets.
   */
  prerequisiteOf?: string[];
  /**
   * The resolved version action for this update (#420): `'graduated'` (prerelease → stable, bump
   * ignored), `'bumped'` (commit/label-driven), or `'first-release'`. Purely additive observability —
   * it never affects which version resolved. Optional for backwards compatibility: standing-PR
   * manifests produced before this field existed won't carry it, so every consumer must tolerate
   * its absence (render nothing).
   */
  action?: VersionAction;
  /** Short human-readable reason for {@link action} (e.g. `Graduated 1.0.0-next.1 → 1.0.0 (bump ignored).`). Optional, same back-compat rule as {@link action}. */
  actionReason?: string;
  /**
   * The release channel this package's new version sits on (#485): `'prerelease'` when `newVersion`
   * carries a semver prerelease segment, else `'stable'`. Derived from the resolved version via
   * {@link deriveReleaseChannel}; a mixed standing PR carries both, each package advancing on its own
   * line. Purely additive observability — it never affects which version resolves. Optional for
   * backwards compatibility: standing-PR manifests written before this field existed omit it, so every
   * consumer must tolerate its absence (re-derive from `newVersion`). #486/#487 build on it.
   */
  channel?: ReleaseChannel;
}
