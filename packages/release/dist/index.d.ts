import { PublishOutput, PublishResult, PipelineError } from '@releasekit/publish';

interface VersionChangelogEntry {
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
interface VersionPackageChangelog {
    packageName: string;
    version: string;
    previousVersion: string | null;
    revisionRange: string;
    repoUrl: string | null;
    entries: VersionChangelogEntry[];
}
/** `'graduated'`: a prerelease promoted to stable, ignoring any requested bump. `'first-release'`: no prior tag. */
type VersionAction = 'first-release' | 'graduated' | 'bumped';
type ReleaseChannel = 'stable' | 'prerelease';
/**
 * The `data` of @releasekit/version's `--json` envelope, passed between pipeline stages and persisted in standing-PR
 * manifests. Open PRs carry old manifests, so new fields must be optional and consumers must tolerate their absence.
 */
interface VersionOutput {
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
interface VersionPackageUpdate {
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

declare const FAILURE_MARKER = "<!-- releasekit-publish-failure -->";
/** Lets a later run detect an outstanding failure without re-deriving it from a ledger. */
type FailureReportStatus = 'unresolved' | 'resolved';
type FailureReportMode = 'standing-pr' | 'direct' | 'manual';
type LedgerStatus = 'published' | 'skipped' | 'failed' | 'not-attempted';
interface LedgerEntry {
    packageName: string;
    version: string;
    status: LedgerStatus;
    registry?: PublishResult['registry'];
    detail?: string;
}
/** The publish output only has entries for packages the pipeline reached; any other update is `not-attempted`. */
declare function buildLedger(versionOutput: VersionOutput, publishOutput: PublishOutput | undefined): LedgerEntry[];
interface RecoveryContext {
    mode: FailureReportMode;
    standingPrNumber?: number;
    retryLabelAvailable?: boolean;
}
interface FailureReportInput {
    versionOutput: VersionOutput;
    publishOutput: PublishOutput | undefined;
    failedStage: string;
    errorMessage: string;
    recovery: RecoveryContext;
}
declare function renderFailureReport(input: FailureReportInput): string;
declare function renderResolvedReport(versionOutput: VersionOutput): string;
/** A report predating the status line reads as `unresolved`: surface the warning rather than hide it. */
declare function parseFailureReportStatus(body: string): FailureReportStatus | null;
interface SupersedeWarningInput {
    previousLabel: string;
    published: number;
    total: number;
    standingPrNumber?: number;
    retryLabelAvailable?: boolean;
}
declare function renderSupersedeWarning(input: SupersedeWarningInput): string[];

type CommitStatusState = 'error' | 'failure' | 'pending' | 'success';
type PullRequestState = 'open' | 'closed';
type MergeMethod = 'merge' | 'squash' | 'rebase';
interface PullRequestRef {
    number: number;
    url: string;
}
interface StandingPullRequest extends PullRequestRef {
    labels: string[];
}
interface AssociatedPullRequest {
    number: number;
    mergedAt: string | null;
}
/** Enough to refresh a PR's preview without its event payload. */
interface OpenPullRequest {
    number: number;
    headRef: string;
    draft: boolean;
    baseSha: string;
}
interface IssueDetails {
    body: string;
    title: string;
    labels: string[];
    /** The issues endpoint also returns PRs. */
    isPullRequest: boolean;
}
interface IssueRef {
    number: number;
    url: string;
}
type IssueState = 'open' | 'closed';
interface NewIssue {
    title: string;
    body: string;
    labels?: string[];
}
interface IssueChanges {
    title?: string;
    body?: string;
    state?: IssueState;
}
interface PullRequestDetails {
    body: string;
    labels: string[];
    headSha?: string;
}
interface CommentAuthor {
    login?: string;
    /** `'Bot'` for a GitHub App / bot actor, `'User'` for a human. */
    type?: string;
}
interface ForgeComment {
    id: number;
    body: string;
    user?: CommentAuthor;
}
interface NewPullRequest {
    title: string;
    body: string;
    head: string;
    base: string;
}
interface PullRequestChanges {
    title?: string;
    body?: string;
    state?: PullRequestState;
}
interface NewLabel {
    name: string;
    color: string;
    description: string;
}
type CreateLabelResult = 'created' | 'exists';
interface CommitStatus {
    sha: string;
    state: CommitStatusState;
    description: string;
    context: string;
}
interface ReleaseRef {
    id: number;
    url: string;
    tagName: string;
}
interface ReleaseSummary {
    tagName: string;
    draft: boolean;
    prerelease: boolean;
    body: string;
}
interface NewRelease {
    tagName: string;
    name: string;
    body: string;
    draft: boolean;
    prerelease: boolean;
    generateReleaseNotes?: boolean;
}
interface ReleaseChanges {
    tagName: string;
    name: string;
    body: string;
    draft: boolean;
    prerelease: boolean;
}
type RepoPermission = 'admin' | 'maintain' | 'write' | 'triage' | 'read' | 'none';
/**
 * The hosting platform's collaboration API behind one vendor-neutral interface. Methods take/return plain data, never
 * Octokit types, so the seam stays swappable and the in-memory fake can stand in for the platform. `owner`/`repo`/auth
 * are bound at construction, so callers speak only in domain terms.
 */
interface Forge {
    listPullRequestsForCommit(commitSha: string): Promise<AssociatedPullRequest[]>;
    /** The open PR whose head is `branch`. */
    findStandingPR(branch: string): Promise<StandingPullRequest | null>;
    /** PRs whose head is `branch`, most-recently-updated first. */
    listRecentlyClosedPullRequests(branch: string, limit: number): Promise<AssociatedPullRequest[]>;
    /** Most-recently-updated first; page-capped. */
    listOpenPullRequests(): Promise<OpenPullRequest[]>;
    getIssue(issueNumber: number): Promise<IssueDetails>;
    getPullRequest(prNumber: number): Promise<PullRequestDetails>;
    createPullRequest(pr: NewPullRequest): Promise<PullRequestRef>;
    updatePullRequest(prNumber: number, changes: PullRequestChanges): Promise<void>;
    mergePullRequest(prNumber: number, method: MergeMethod): Promise<void>;
    createIssue(issue: NewIssue): Promise<IssueRef>;
    updateIssue(issueNumber: number, changes: IssueChanges): Promise<void>;
    /** The most-recent open issue (not a PR) carrying `label`. */
    findOpenIssueByLabel(label: string): Promise<IssueRef | null>;
    /** The first comment whose body starts with `marker`. */
    findComment(prNumber: number, marker: string): Promise<ForgeComment | null>;
    createComment(prNumber: number, body: string): Promise<void>;
    updateComment(commentId: number, body: string): Promise<void>;
    upsertMarkerComment(prNumber: number, marker: string, body: string): Promise<void>;
    listLabelNames(): Promise<string[]>;
    /** Resolves to 'exists' rather than throwing when the label is already present. */
    createLabel(label: NewLabel): Promise<CreateLabelResult>;
    setLabels(issueNumber: number, labels: string[]): Promise<void>;
    /** Returns 'none' for an unknown/outside actor rather than throwing. */
    getActorPermission(username: string): Promise<RepoPermission>;
    /** Returns false only for a non-member; throws on an access error (e.g. a token without org-read scope) so the
     *  caller can surface it. */
    isTeamMember(org: string, teamSlug: string, username: string): Promise<boolean>;
    setCommitStatus(status: CommitStatus): Promise<void>;
    listReleases(): Promise<ReleaseSummary[]>;
    createRelease(release: NewRelease): Promise<ReleaseRef>;
    updateRelease(releaseId: number, release: ReleaseChanges): Promise<ReleaseRef>;
    getReleaseByTag(tag: string): Promise<ReleaseRef | null>;
}

interface PostFailureReportContext {
    forge: Forge;
    mode: FailureReportMode;
    /** Omitted with no PR (manual dispatch): the report goes to the step summary. */
    prNumber?: number;
    standingPrNumber?: number;
    retryLabelAvailable?: boolean;
}
declare function postFailureReport(ctx: PostFailureReportContext, versionOutput: VersionOutput, error: PipelineError): Promise<void>;
declare function resolveFailureReportIfPresent(forge: Forge, prNumber: number, versionOutput: VersionOutput): Promise<void>;
interface UnresolvedFailure {
    previousLabel: string;
    published: number;
    total: number;
    prNumber: number;
}
declare function detectUnresolvedFailure(forge: Forge, prNumber: number): Promise<UnresolvedFailure | null>;

interface PREvaluation {
    prNumber: number;
    labels: string[];
    shouldRelease: boolean;
    bump?: string;
    scope?: string;
    target?: string;
    stable?: boolean;
    blocked?: boolean;
    reason?: string;
    /** Decides whether a non-releasing verdict gets a notify comment; not simply "has release labels". */
    hasReleaseIntent: boolean;
}

interface GateOutput {
    shouldRelease: boolean;
    bump?: string;
    scope?: string;
    target?: string;
    stable?: boolean;
    labels: string[];
    prNumbers: number[];
    blocked?: boolean;
    reason?: string;
    evaluations: PREvaluation[];
}
interface GateOptions {
    config?: string;
    projectDir: string;
    scope?: string;
    json?: boolean;
    verbose?: boolean;
    quiet?: boolean;
    /** Comment on PRs whose release intent didn't produce a release; disable for dry runs and local scripts. */
    notify?: boolean;
}
declare function runGate(options: GateOptions): Promise<GateOutput>;

interface PreviewOptions {
    config?: string;
    projectDir: string;
    pr?: string;
    repo?: string;
    dryRun: boolean;
    prerelease?: string | boolean;
    stable?: boolean;
    bump?: string;
    target?: string;
    /** Overrides the event payload's base SHA: a post-release refresh runs on a push/dispatch event without one. */
    baseSha?: string;
}
declare function runPreview(options: PreviewOptions): Promise<void>;

interface ReleaseOptions {
    config?: string;
    dryRun: boolean;
    bump?: string;
    prerelease?: string | boolean;
    stable?: boolean;
    /** Package patterns to graduate to stable; `stable` graduates every prerelease. */
    graduate?: string[];
    /** Package patterns to shift onto a prerelease line; `prerelease` shifts every package. */
    prereleaseScope?: string[];
    /** Acknowledge a first-release bump on an already-stable manifest (silences the overshoot guard). */
    allowFirstBump?: boolean;
    sync: boolean;
    target?: string;
    /** Also release the changed internal dependencies of `target` packages (and the rest of their groups). */
    includePrerequisites?: boolean;
    /** Matched by exact package name. */
    exclude?: string[];
    scope?: string;
    branch?: string;
    skipNotes: boolean;
    /** Release notes only (LLM & per-version notes files); CHANGELOG.md is still written. */
    skipReleaseNotes?: boolean;
    /** CHANGELOG.md only; release notes are still generated. */
    skipChangelogs?: boolean;
    skipPublish: boolean;
    skipGit: boolean;
    skipGitCommit?: boolean;
    skipGithubRelease: boolean;
    skipVerification: boolean;
    json: boolean;
    verbose: boolean;
    quiet: boolean;
    projectDir: string;
    npmAuth?: 'auto' | 'oidc' | 'token';
    /** When set, scope commit analysis (bump type & changelog) to commits after this SHA. */
    baseRef?: string;
    /** Wins per package over generated notes. Set by the draft dispatch; not a CLI flag. */
    editedNotes?: Record<string, string>;
}
interface ReleaseOutput {
    versionOutput: VersionOutput;
    notesGenerated: boolean;
    packageNotes?: Record<string, string>;
    releaseNotes?: Record<string, string>;
    publishOutput?: PublishOutput;
}

declare function resolveScopeToTarget(scopeName: string, scopeLabels: Record<string, string>): string;
declare function runRelease(inputOptions: ReleaseOptions): Promise<ReleaseOutput | null>;

interface StandingPROptions {
    config?: string;
    projectDir: string;
    verbose: boolean;
    quiet: boolean;
    json: boolean;
    npmAuth?: string;
    /**
     * Bypass only the skip-pattern guard: post-release reconcile runs `standing-pr update` when HEAD is, by
     * definition, a release commit matching the skip pattern.
     */
    reconcile?: boolean;
    /** Ad-hoc CLI override: release only these comma-split package patterns (supplements label overrides). */
    target?: string;
    /** Ad-hoc CLI override: also release the changed prerequisites (and group members) of the targets. */
    includePrerequisites?: boolean;
}
interface StandingPRResult {
    action: 'created' | 'updated' | 'closed' | 'noop';
    prNumber?: number;
    prUrl?: string;
    versionOutput?: VersionOutput;
}
interface StandingPRMergeOutput {
    merged: true;
    prNumber: number;
}
type StandingPRMergeResult = ReleaseOutput | StandingPRMergeOutput | null;
/** Old manifests live in open PRs: fields added after v1 must stay optional and be tolerated when absent. */
interface StandingPRManifest {
    schemaVersion: 1 | 2;
    versionOutput: VersionOutput;
    releaseNotes: Record<string, string>;
    notesFiles: string[];
    createdAt: string;
    baseSha: string;
    /** When the standing PR was first created, preserved across updates. */
    firstUpdatedAt?: string;
    /**
     * Override-relevant labels on the standing PR when this manifest was computed, sorted, so publish can refuse a
     * manifest whose labels diverged from the merged PR.
     */
    overrideLabels?: string[];
    /** Packages unticked in the selection region. Provenance only - `versionOutput` already excludes them. */
    deselected?: string[];
    /**
     * Lets the channel-grouped render flag graduated rows; `versionOutput` already holds the stable versions. When
     * absent, consumers re-derive from each update's `channel`/`action`.
     */
    graduated?: string[];
    /**
     * Packages (and their groups) shifted onto a prerelease line by the per-row channel toggle. Provenance & round-trip
     * only - `versionOutput` already holds the prerelease versions.
     */
    prereleased?: string[];
}
declare function runStandingPRUpdate(options: StandingPROptions): Promise<StandingPRResult>;
/**
 * Every failure throws: once a PR is named there is no "nothing to do" outcome, so a returned result means the
 * publish ran.
 */
declare function publishFromManifest(prNumber: number, options: StandingPROptions): Promise<ReleaseOutput>;
/**
 * `null` means nothing to do (the caller reports success); anything that went wrong throws so a misconfiguration
 * can't read as a successful no-op. `pull_request: closed` fires for every closed PR, so non-release PRs must stay
 * quiet no-ops.
 */
declare function runStandingPRPublish(options: StandingPROptions, explicitPrNumber?: number): Promise<ReleaseOutput | null>;
declare function runStandingPRMerge(options: StandingPROptions, flags: {
    publish: boolean;
}): Promise<StandingPRMergeResult>;

interface NotesStepResult {
    packageNotes: Record<string, string>;
    releaseNotes?: Record<string, string>;
    files: string[];
}
declare function runVersionStep(options: ReleaseOptions): Promise<VersionOutput>;
declare function runNotesStep(versionOutput: VersionOutput, options: ReleaseOptions): Promise<NotesStepResult>;
declare function runPublishStep(versionOutput: VersionOutput, options: ReleaseOptions, releaseNotes?: Record<string, string>, additionalFiles?: string[]): Promise<ReleaseOutput['publishOutput']>;

export { FAILURE_MARKER, buildLedger, detectUnresolvedFailure, parseFailureReportStatus, postFailureReport, publishFromManifest, renderFailureReport, renderResolvedReport, renderSupersedeWarning, resolveFailureReportIfPresent, resolveScopeToTarget, runGate, runNotesStep, runPreview, runPublishStep, runRelease, runStandingPRMerge, runStandingPRPublish, runStandingPRUpdate, runVersionStep };
export type { FailureReportInput, FailureReportMode, FailureReportStatus, GateOptions, GateOutput, LedgerEntry, LedgerStatus, NotesStepResult, PreviewOptions, RecoveryContext, ReleaseOptions, ReleaseOutput, StandingPRManifest, StandingPRMergeOutput, StandingPRMergeResult, StandingPROptions, StandingPRResult, SupersedeWarningInput };
