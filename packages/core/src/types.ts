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
}
