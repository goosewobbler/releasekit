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
 * The complete JSON output of @releasekit/version --json.
 * This is the primary interchange format between version and notes.
 */
export interface VersionOutput {
  dryRun: boolean;
  updates: VersionPackageUpdate[];
  changelogs: VersionPackageChangelog[];
  /**
   * Changelog entries from commits that don't touch any specific package directory
   * (CI, infrastructure, shared package changes). Stored separately so they can be
   * rendered once rather than duplicated across every per-package changelog.
   */
  sharedEntries?: VersionChangelogEntry[];
  commitMessage?: string;
  tags: string[];
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
  /** When true, GitHub release draft creation is suppressed for this package while version bump, commit, tag, and npm publish still run. */
  skipReleaseDraft?: boolean;
}
