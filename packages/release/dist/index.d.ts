import { PublishOutput, PublishResult, PipelineError } from '@releasekit/publish';

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
    /**
     * The pull request this entry shipped through, taken from the trailing `(#N)` GitHub appends to a
     * squash-merge commit subject. It marks which of the {@link issueIds} is the PR (the rest are closed
     * issues), so the changelog can render `(PR #N · closes #M)` instead of a flat ref list. The number
     * is also kept inside `issueIds` (the full flat list), so a consumer that ignores this field still
     * shows the ref. Optional and additive — absent means no identifiable PR (a non-squash commit or an
     * old manifest), and renderers fall back to the plain ref list.
     */
    prNumber?: string;
    scope?: string;
    originalType?: string;
    breaking?: boolean;
    /**
     * True when this entry is a fabricated `Update version to X` placeholder minted by the
     * version-groups engine for a lockstep carry — a group member bumped only to stay in sync, with
     * no commits of its own. It is not derived from a real commit. The preview formatter treats a
     * changelog whose entries are *all* synthetic as "no real changes" and collapses the package into
     * the "Also bumped" list instead of rendering a full block of placeholder noise.
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
interface VersionPackageChangelog {
    packageName: string;
    version: string;
    previousVersion: string | null;
    revisionRange: string;
    repoUrl: string | null;
    entries: VersionChangelogEntry[];
}
/**
 * The resolved action a package's version landed on — purely additive observability, it
 * never changes which version resolves. `'graduated'` means a prerelease was promoted to stable and
 * any requested bump was ignored; `'bumped'` is the ordinary commit/label-driven bump;
 * `'first-release'` is a package with no prior tag. Defined as a string-literal union (core cannot
 * import the version package, where the deriving logic lives).
 */
type VersionAction = 'first-release' | 'graduated' | 'bumped';
/**
 * The release channel a version sits on. Derived per-package and purely from the resolved
 * version: `'prerelease'` when the version carries a semver prerelease segment (`…-<preid>.N`), else
 * `'stable'`. A standing PR with permanently-mixed maturity carries both at once — some `'stable'`
 * packages, some `'prerelease'` — each advancing along its own line.
 */
type ReleaseChannel = 'stable' | 'prerelease';
/**
 * The `data` of @releasekit/version's `--json` envelope.
 * This is the primary interchange format between version and notes.
 */
interface VersionOutput {
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
interface VersionPackageUpdate {
    packageName: string;
    newVersion: string;
    /**
     * The resolved baseline version this update bumped from — the package's prior release, in the same
     * consumer-tag display form the changelog carries ({@link VersionPackageChangelog.previousVersion}).
     * Absent for a first release and whenever the baseline was unreachable / fell back to all-history,
     * so consumers derive the bump magnitude only when it is present. Optional for backwards
     * compatibility: standing-PR manifests written before this field existed omit it (old PRs still
     * open), so every consumer must tolerate its absence (render a dash / skip the delta).
     */
    previousVersion?: string;
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
     * The resolved version action for this update: `'graduated'` (prerelease → stable, bump
     * ignored), `'bumped'` (commit/label-driven), or `'first-release'`. Purely additive observability —
     * it never affects which version resolved. Optional for backwards compatibility: standing-PR
     * manifests produced before this field existed won't carry it, so every consumer must tolerate
     * its absence (render nothing).
     */
    action?: VersionAction;
    /** Short human-readable reason for {@link action} (e.g. `Graduated 1.0.0-next.1 → 1.0.0 (bump ignored).`). Optional, same back-compat rule as {@link action}. */
    actionReason?: string;
    /**
     * The release channel this package's new version sits on: `'prerelease'` when `newVersion`
     * carries a semver prerelease segment, else `'stable'`. Derived from the resolved version via
     * {@link deriveReleaseChannel}; a mixed standing PR carries both, each package advancing on its own
     * line. Purely additive observability — it never affects which version resolves. Optional for
     * backwards compatibility: standing-PR manifests written before this field existed omit it, so every
     * consumer must tolerate its absence (re-derive from `newVersion`).
     */
    channel?: ReleaseChannel;
}

/**
 * Distinct comment marker for the partial-publish failure report. Kept separate from the
 * preview (`<!-- releasekit-preview -->`) and gate-notify markers so the report manages its
 * own idempotent comment on the release-driving PR.
 */
declare const FAILURE_MARKER = "<!-- releasekit-publish-failure -->";
/**
 * Machine-readable resolution status, encoded as an HTML comment immediately after the marker
 * so a later run (or the next standing-PR / preview) can detect whether the failure is still
 * outstanding without re-deriving it from a ledger. `unresolved` while a partial publish has
 * not been retried or superseded; `resolved` once a retry succeeds or a later release supersedes.
 */
type FailureReportStatus = 'unresolved' | 'resolved';
/** Release mode the failed publish ran in — drives the recovery instructions. */
type FailureReportMode = 'standing-pr' | 'direct' | 'manual';
/** Per-package outcome in the publish ledger. */
type LedgerStatus = 'published' | 'skipped' | 'failed' | 'not-attempted';
interface LedgerEntry {
    packageName: string;
    version: string;
    status: LedgerStatus;
    /** Registry the result came from, when known. */
    registry?: PublishResult['registry'];
    /** Human-readable detail — the skip reason or failure reason. */
    detail?: string;
}
/**
 * Derive the per-package ledger from the version input and the partial publish output.
 *
 * The publish ledger (`PublishOutput.npm` / `.cargo`) only carries entries for packages the
 * pipeline reached before failing. "Not attempted" packages are derived by diffing the input
 * updates against the packages that appear in the ledger — a package the pipeline never got to
 * simply has no result entry.
 */
declare function buildLedger(versionOutput: VersionOutput, publishOutput: PublishOutput | undefined): LedgerEntry[];
interface RecoveryContext {
    mode: FailureReportMode;
    /** Standing PR number (standing-pr mode) used to phrase the dispatch/retry instruction. */
    standingPrNumber?: number;
    /**
     * Whether the `release:retry` label flow is wired. When set, the label is the
     * primary standing-pr recovery path; dispatch is offered as the manual fallback. Defaults off
     * for callers that have not opted in (e.g. tests asserting the pre-retry-label copy).
     */
    retryLabelAvailable?: boolean;
}
interface FailureReportInput {
    versionOutput: VersionOutput;
    publishOutput: PublishOutput | undefined;
    /** Stage that failed (e.g. `npm-publish`, `verify`). */
    failedStage: string;
    /** Error message from the pipeline failure. */
    errorMessage: string;
    recovery: RecoveryContext;
}
/**
 * Render the partial-publish failure report comment body (marker-keyed, idempotent).
 * The status line encodes `unresolved` so the next standing PR / preview can detect the
 * outstanding failure and surface the supersede warning.
 */
declare function renderFailureReport(input: FailureReportInput): string;
/**
 * Render the resolved variant of the report — produced when a later publish for the same
 * release succeeds (retry or supersede). Keeps the marker so it updates the same comment, and
 * encodes `resolved` so the supersede warning clears.
 */
declare function renderResolvedReport(versionOutput: VersionOutput): string;
/**
 * Read the encoded resolution status from a failure-report comment body. Returns null when the
 * body is not a failure report (no marker). Bodies written before the status line existed are
 * treated as `unresolved` (the conservative default — surface the warning rather than hide it).
 */
declare function parseFailureReportStatus(body: string): FailureReportStatus | null;
interface SupersedeWarningInput {
    /** Release label of the partially-published prior release, e.g. `v0.24.0`. */
    previousLabel: string;
    published: number;
    total: number;
    /** Standing PR number carrying the failure report (the retry surface). */
    standingPrNumber?: number;
    /** Whether the `release:retry` label flow is wired — makes it the primary hint. */
    retryLabelAvailable?: boolean;
}
/**
 * Render the warning block shown on the NEXT standing PR (and the release preview) while a
 * prior release remains partially published. Gives the maintainer the honest retry-vs-supersede
 * choice described in the issue.
 */
declare function renderSupersedeWarning(input: SupersedeWarningInput): string[];

/**
 * `Forge` — the remote hosting platform's collaboration API (pull requests, marker comments,
 * labels, commit statuses, releases), behind one vendor-neutral interface.
 *
 * GitHub is the only forge today (`GitHubForge`); a GitLab/Bitbucket adapter would implement the
 * same interface with zero changes to callers. Methods take/return plain data — they never leak
 * Octokit request or response types — so the seam stays swappable and the in-memory fake can stand
 * in for the real platform in tests. `owner`/`repo`/auth are bound when an adapter is constructed,
 * so callers speak only in domain terms (branch, PR number, tag).
 */
type CommitStatusState = 'error' | 'failure' | 'pending' | 'success';
type PullRequestState = 'open' | 'closed';
type MergeMethod = 'merge' | 'squash' | 'rebase';
interface PullRequestRef {
    number: number;
    url: string;
}
/** An open standing-release PR, including its current label set. */
interface StandingPullRequest extends PullRequestRef {
    labels: string[];
}
/** A PR associated with a commit / closed window; `mergedAt` is null when it was closed unmerged. */
interface AssociatedPullRequest {
    number: number;
    mergedAt: string | null;
}
/** An open PR, enough to decide whether to refresh its preview (skip drafts/the standing PR) and to
 *  scope that preview's analysis (`baseSha`) without an event payload. */
interface OpenPullRequest {
    number: number;
    headRef: string;
    draft: boolean;
    baseSha: string;
}
/** An issue as returned by the issues endpoint (a PR is also an issue). */
interface IssueDetails {
    body: string;
    title: string;
    labels: string[];
    /** True when the issue is really a pull request (the API returns a `pull_request` field). */
    isPullRequest: boolean;
}
/** A reference to an issue after creation/lookup. */
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
}
/** The author of a comment, as reported by the forge. `type` is `'Bot'` for a GitHub App / bot
 *  actor (the tool itself), `'User'` for a human. Used to bind a machine-state marker comment (e.g.
 *  the release manifest) to the bot identity so a human-authored forgery is never trusted. */
interface CommentAuthor {
    login?: string;
    type?: string;
}
/** A located issue/PR comment. `user` is the comment's author when the forge reports one; absent on
 *  the in-memory fake / legacy paths that never recorded it. */
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
/** Whether `createLabel` actually created the label or found it already present (idempotent). */
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
/**
 * A user's permission level on the repository, highest→lowest. Vendor-neutral: GitHub's role names
 * map directly; another forge's roles would map to the nearest rung. `none` covers an outside/unknown
 * actor. Used to authorize who may steer the standing PR (selection, labels, merge).
 */
type RepoPermission = 'admin' | 'maintain' | 'write' | 'triage' | 'read' | 'none';
interface Forge {
    /** PRs associated with a commit (used to map merge commits back to their PRs). */
    listPullRequestsForCommit(commitSha: string): Promise<AssociatedPullRequest[]>;
    /** The open standing-release PR whose head is `branch`, with its labels, or null. */
    findStandingPR(branch: string): Promise<StandingPullRequest | null>;
    /** Recently-closed PRs whose head is `branch`, most-recently-updated first. */
    listRecentlyClosedPullRequests(branch: string, limit: number): Promise<AssociatedPullRequest[]>;
    /** All open PRs (number, head ref, draft flag, base SHA), most-recently-updated first, page-capped. */
    listOpenPullRequests(): Promise<OpenPullRequest[]>;
    /** Issue view of a PR (body, title, labels, and whether it is a PR). */
    getIssue(issueNumber: number): Promise<IssueDetails>;
    /** PR view (body + labels). */
    getPullRequest(prNumber: number): Promise<PullRequestDetails>;
    createPullRequest(pr: NewPullRequest): Promise<PullRequestRef>;
    updatePullRequest(prNumber: number, changes: PullRequestChanges): Promise<void>;
    mergePullRequest(prNumber: number, method: MergeMethod): Promise<void>;
    createIssue(issue: NewIssue): Promise<IssueRef>;
    /** Update an issue's title/body, or close it (`state: 'closed'`). */
    updateIssue(issueNumber: number, changes: IssueChanges): Promise<void>;
    /** The most-recent open issue (not a PR) carrying `label`, or null — for idempotent reuse of a
     *  single standing issue (e.g. the manual-mode release draft) instead of stacking new ones. */
    findOpenIssueByLabel(label: string): Promise<IssueRef | null>;
    /** The first comment whose body starts with `marker` (id + body), or null. */
    findComment(prNumber: number, marker: string): Promise<ForgeComment | null>;
    createComment(prNumber: number, body: string): Promise<void>;
    updateComment(commentId: number, body: string): Promise<void>;
    /** Create the marker comment, or update the existing one — never stack a second. */
    upsertMarkerComment(prNumber: number, marker: string, body: string): Promise<void>;
    /** Every label name defined on the repository. */
    listLabelNames(): Promise<string[]>;
    /** Create a label; resolves to 'exists' (not an error) when it is already present. */
    createLabel(label: NewLabel): Promise<CreateLabelResult>;
    /** Replace the full label set on an issue/PR. */
    setLabels(issueNumber: number, labels: string[]): Promise<void>;
    /** The actor's permission level on the repo (for gating who may steer the standing PR). Returns
     *  'none' for an unknown/outside actor rather than throwing. */
    getActorPermission(username: string): Promise<RepoPermission>;
    /** Whether `username` is an active member of `org`/`teamSlug`. Returns false when not a member;
     *  throws on an access error (e.g. a token without org-read scope) so the caller can surface it. */
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
    /** PR to comment on. Omit for manual dispatch with no PR — the report goes to the step summary. */
    prNumber?: number;
    standingPrNumber?: number;
    /** Whether the `release:retry` label flow is wired — makes it the primary hint. */
    retryLabelAvailable?: boolean;
}
/**
 * Post (or update) the partial-publish failure report. When a PR number is available the report
 * is a marker-keyed comment (idempotent — a repeat failure updates the same comment). With no PR
 * (manual dispatch) it is appended to the workflow step summary at `$GITHUB_STEP_SUMMARY`.
 */
declare function postFailureReport(ctx: PostFailureReportContext, versionOutput: VersionOutput, error: PipelineError): Promise<void>;
/**
 * On a successful publish, flip any existing failure report for this release to resolved. This
 * also clears the supersede warning on the next standing PR / preview. No-op when no report
 * exists. Safe to call unconditionally after a successful publish.
 */
declare function resolveFailureReportIfPresent(forge: Forge, prNumber: number, versionOutput: VersionOutput): Promise<void>;
interface UnresolvedFailure {
    /** Release label of the partially-published prior release, e.g. `v0.24.0`. */
    previousLabel: string;
    published: number;
    total: number;
    /** PR number carrying the failure report (the retry surface). */
    prNumber: number;
}
/**
 * Detect an unresolved partial-publish failure on a given PR by locating the failure-report
 * comment (marker) and reading its encoded resolution status. Returns null when there is no
 * report or it is already resolved. The published/total fraction is recovered from the ledger
 * embedded in the report body so the caller doesn't need the original pipeline output.
 */
declare function detectUnresolvedFailure(forge: Forge, prNumber: number): Promise<UnresolvedFailure | null>;

/**
 * Per-PR release decision. Captures whether a single PR's labels would trigger a release,
 * the resulting bump/scope/target, and the reason for any non-releasing verdict.
 *
 * The gate evaluates each PR in isolation — labels are NEVER unioned across PRs.
 */
interface PREvaluation {
    prNumber: number;
    labels: string[];
    shouldRelease: boolean;
    bump?: string;
    scope?: string;
    target?: string;
    stable?: boolean;
    /** Hard error: conflicting labels on the SAME PR (e.g. bump:major + bump:minor). */
    blocked?: boolean;
    reason?: string;
    /**
     * True when the PR has any release-related label (bump:*, release:*, or any configured scope:*).
     * The notifier uses this to decide whether a non-releasing verdict warrants a comment.
     * PRs with no release intent stay silent.
     */
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
    /**
     * Per-PR verdicts. The gate evaluates each PR independently — labels are NEVER unioned.
     * This array reflects every PR found in the window since the last release tag.
     */
    evaluations: PREvaluation[];
}
interface GateOptions {
    config?: string;
    projectDir: string;
    scope?: string;
    json?: boolean;
    verbose?: boolean;
    quiet?: boolean;
    /**
     * When true (default), the gate posts a comment on PRs whose labels indicated release
     * intent but did not produce a release (e.g. `channel:prerelease` without `bump:*`, or
     * conflicting bump labels). Disable for dry-runs / local scripts.
     */
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
    /**
     * Explicit base SHA for the advisory standing-pr commit-range scoping. The single-PR preview path
     * reads this from the GitHub Actions `pull_request` event payload, but a post-release refresh runs
     * on a push/dispatch event with no such payload — so the refresh runner supplies it per PR. Takes
     * precedence over the event payload when set.
     */
    baseSha?: string;
}
declare function runPreview(options: PreviewOptions): Promise<void>;

interface ReleaseOptions {
    config?: string;
    dryRun: boolean;
    bump?: string;
    prerelease?: string | boolean;
    stable?: boolean;
    /** Per-package graduation: package name patterns to graduate to stable, leaving other
     *  prereleases on their line. Distinct from `stable`, which graduates ALL prereleases. */
    graduate?: string[];
    /** Per-package prerelease: package name patterns to shift onto a prerelease line, leaving
     *  every other package on its projected version. The symmetric twin of `graduate`; distinct from
     *  `prerelease`, which shifts ALL packages. */
    prereleaseScope?: string[];
    /** Acknowledge a first-release bump on an already-stable manifest (silences the overshoot guard). */
    allowFirstBump?: boolean;
    sync: boolean;
    target?: string;
    /** Also release the changed internal dependencies of `target` packages (and the rest of their groups). */
    includePrerequisites?: boolean;
    /** Package names to drop from the release set (standing-PR ad-hoc deselection). Exact name match. */
    exclude?: string[];
    scope?: string;
    branch?: string;
    skipNotes: boolean;
    /**
     * Skip release-notes generation (LLM + RELEASE_NOTES.md write) inside the notes step.
     * Per-package CHANGELOG.md is unaffected. Used by the standing-pr update path so the
     * standing-pr workflow doesn't depend on LLM availability and doesn't re-pay for an
     * LLM call on every push to main.
     */
    skipReleaseNotes?: boolean;
    /**
     * Skip changelog file writes (CHANGELOG.md) inside the notes step. LLM + release-notes
     * generation are unaffected. Used by `publishFromManifest` to regenerate only the
     * release notes against an already-bumped tree.
     */
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
    /** When set, scope commit analysis (bump type + changelog) to commits after this SHA. */
    baseRef?: string;
    /**
     * Per-package human-edited release notes that win over freshly generated notes (edited wins per
     * package, new packages fall back to fresh). Set by the manual-mode draft dispatch from the
     * edited tracking-issue body; not a CLI flag.
     */
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
     * Bypass ONLY the skip-pattern guard at the top of `runStandingPRUpdate`. The guard exists to
     * stop push-triggered runs reacting to a release's own commits, but the post-release reconcile
     * flow deliberately runs `standing-pr update` right after a release — when HEAD is, by
     * definition, a release commit that matches the skip pattern. Reconcile callers explicitly
     * intend an update, so they opt out via this flag. All other guards/behaviour are unchanged.
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
interface StandingPRManifest {
    schemaVersion: 1 | 2;
    versionOutput: VersionOutput;
    releaseNotes: Record<string, string>;
    notesFiles: string[];
    createdAt: string;
    baseSha: string;
    /** ISO timestamp of when this standing PR was first created. Preserved across updates. Added in schema v2. */
    firstUpdatedAt?: string;
    /**
     * Override-relevant labels (bump/channel/scope) present on the standing PR when this manifest was
     * computed, sorted. Lets publish refuse a manifest whose labels diverged from the merged PR.
     * Optional: absent on manifests written before this field existed — consumers must tolerate that.
     */
    overrideLabels?: string[];
    /**
     * Packages a maintainer unticked in the PR's selection region, so they were held back from this
     * release (excluded from `versionOutput`). Recorded for provenance/auditing; the release set is
     * already narrowed in `versionOutput`. Optional: absent when nothing was deselected, and on
     * manifests written before this field existed.
     */
    deselected?: string[];
    /**
     * Packages graduated from prerelease to stable on this update, driven by `graduate:<package>`
     * labels (or the whole-batch `release:graduate`). Group-atomic — a graduated fixed/linked group lists
     * every releasing member. Recorded for provenance and so consumers (the channel-grouped render)
     * can flag a row as graduated; the resolved stable versions already live in `versionOutput`. Optional:
     * absent when nothing graduated, and on manifests written before this field existed (consumers
     * re-derive from each update's `channel` / `action`).
     */
    graduated?: string[];
    /**
     * Packages shifted onto a prerelease line this update via the per-row channel toggle, scoped
     * to just these packages (and their groups) without narrowing the release. Recorded for provenance
     * and round-trip; the resolved prerelease versions already live in `versionOutput`. Optional: absent
     * when nothing was channel-shifted, and on manifests written before this field existed.
     */
    prereleased?: string[];
}
declare function runStandingPRUpdate(options: StandingPROptions): Promise<StandingPRResult>;
/**
 * Publish the release described by a merged standing PR's manifest. Every failure throws — there is
 * no "nothing to do" outcome once a specific PR has been named, so a caller that gets a result back
 * knows the publish ran.
 */
declare function publishFromManifest(prNumber: number, options: StandingPROptions): Promise<ReleaseOutput>;
/**
 * Publish from a merged standing release PR.
 *
 * `null` means "nothing to do" — this run legitimately had no release to publish, and the caller
 * reports success. Everything that went *wrong* throws: the JSON envelope reports `status: "error"`
 * on those, so an agent or workflow can't read a misconfiguration as a successful no-op. The
 * distinction matters most on the `pull_request: closed` trigger, which fires for every closed PR
 * and must stay a quiet no-op for the ones that aren't the release branch.
 */
declare function runStandingPRPublish(options: StandingPROptions, explicitPrNumber?: number): Promise<ReleaseOutput | null>;
declare function runStandingPRMerge(options: StandingPROptions, flags: {
    publish: boolean;
}): Promise<ReleaseOutput | null>;

interface NotesStepResult {
    packageNotes: Record<string, string>;
    releaseNotes?: Record<string, string>;
    files: string[];
}
declare function runVersionStep(options: ReleaseOptions): Promise<VersionOutput>;
declare function runNotesStep(versionOutput: VersionOutput, options: ReleaseOptions): Promise<NotesStepResult>;
declare function runPublishStep(versionOutput: VersionOutput, options: ReleaseOptions, releaseNotes?: Record<string, string>, additionalFiles?: string[]): Promise<ReleaseOutput['publishOutput']>;

export { FAILURE_MARKER, buildLedger, detectUnresolvedFailure, parseFailureReportStatus, postFailureReport, publishFromManifest, renderFailureReport, renderResolvedReport, renderSupersedeWarning, resolveFailureReportIfPresent, resolveScopeToTarget, runGate, runNotesStep, runPreview, runPublishStep, runRelease, runStandingPRMerge, runStandingPRPublish, runStandingPRUpdate, runVersionStep };
export type { FailureReportInput, FailureReportMode, FailureReportStatus, GateOptions, GateOutput, LedgerEntry, LedgerStatus, NotesStepResult, PreviewOptions, RecoveryContext, ReleaseOptions, ReleaseOutput, StandingPRManifest, StandingPROptions, StandingPRResult, SupersedeWarningInput };
