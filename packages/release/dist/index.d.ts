import { PublishOutput } from '@releasekit/publish';

interface PreviewOptions {
    config?: string;
    projectDir: string;
    pr?: string;
    repo?: string;
    dryRun: boolean;
    prerelease?: string | boolean;
    stable?: boolean;
    bump?: string;
}
declare function runPreview(options: PreviewOptions): Promise<void>;

/**
 * Shared types for the releasekit ecosystem.
 *
 * These types define the JSON contract between @releasekit/version (producer)
 * and @releasekit/notes (consumer). Changes here affect both packages.
 */
/**
 * A single changelog entry produced by @releasekit/version.
 */
interface VersionChangelogEntry {
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
interface VersionPackageChangelog {
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
interface VersionOutput {
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
interface VersionPackageUpdate {
    packageName: string;
    newVersion: string;
    filePath: string;
}

interface ReleaseOptions {
    config?: string;
    dryRun: boolean;
    bump?: string;
    prerelease?: string | boolean;
    sync: boolean;
    target?: string;
    branch?: string;
    skipNotes: boolean;
    skipPublish: boolean;
    skipGit: boolean;
    skipGithubRelease: boolean;
    skipVerification: boolean;
    json: boolean;
    verbose: boolean;
    quiet: boolean;
    projectDir: string;
    npmAuth?: 'auto' | 'oidc' | 'token';
}
interface ReleaseOutput {
    versionOutput: VersionOutput;
    notesGenerated: boolean;
    packageNotes?: Record<string, string>;
    releaseNotes?: Record<string, string>;
    publishOutput?: PublishOutput;
}

declare function runRelease(inputOptions: ReleaseOptions): Promise<ReleaseOutput | null>;

export { type PreviewOptions, type ReleaseOptions, type ReleaseOutput, runPreview, runRelease };
