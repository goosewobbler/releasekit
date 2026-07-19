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

export type CommitStatusState = 'error' | 'failure' | 'pending' | 'success';
export type PullRequestState = 'open' | 'closed';
export type MergeMethod = 'merge' | 'squash' | 'rebase';

export interface PullRequestRef {
  number: number;
  url: string;
}

/** An open standing-release PR, including its current label set. */
export interface StandingPullRequest extends PullRequestRef {
  labels: string[];
}

/** A PR associated with a commit / closed window; `mergedAt` is null when it was closed unmerged. */
export interface AssociatedPullRequest {
  number: number;
  mergedAt: string | null;
}

/** An open PR, enough to decide whether to refresh its preview (skip drafts/the standing PR) and to
 *  scope that preview's analysis (`baseSha`) without an event payload. */
export interface OpenPullRequest {
  number: number;
  headRef: string;
  draft: boolean;
  baseSha: string;
}

/** An issue as returned by the issues endpoint (a PR is also an issue). */
export interface IssueDetails {
  body: string;
  title: string;
  labels: string[];
  /** True when the issue is really a pull request (the API returns a `pull_request` field). */
  isPullRequest: boolean;
}

/** A reference to an issue after creation/lookup. */
export interface IssueRef {
  number: number;
  url: string;
}

export type IssueState = 'open' | 'closed';

export interface NewIssue {
  title: string;
  body: string;
  labels?: string[];
}

export interface IssueChanges {
  title?: string;
  body?: string;
  state?: IssueState;
}

export interface PullRequestDetails {
  body: string;
  labels: string[];
}

/** The author of a comment, as reported by the forge. `type` is `'Bot'` for a GitHub App / bot
 *  actor (the tool itself), `'User'` for a human. Used to bind a machine-state marker comment (e.g.
 *  the release manifest) to the bot identity so a human-authored forgery is never trusted (#556). */
export interface CommentAuthor {
  login?: string;
  type?: string;
}

/** A located issue/PR comment. `user` is the comment's author when the forge reports one; absent on
 *  the in-memory fake / legacy paths that never recorded it. */
export interface ForgeComment {
  id: number;
  body: string;
  user?: CommentAuthor;
}

/**
 * Whether a marker comment was authored by the bot/app identity (the tool) rather than a human.
 * A machine-state marker (the release manifest, previews, failure reports) is only trustworthy when
 * the bot wrote it; a human-authored comment carrying the same marker is a forgery/pre-seed and must
 * not be adopted or trusted (#556).
 *
 * Fails open on an unknown author (`user` absent) — the real GitHub adapter always reports one, so
 * `undefined` only occurs on the fake/legacy paths, where treating it as ours preserves behavior.
 */
export function isBotComment(comment: Pick<ForgeComment, 'user'>): boolean {
  const user = comment.user;
  if (!user) return true;
  return user.type === 'Bot' || (user.login !== undefined && user.login.endsWith('[bot]'));
}

export interface NewPullRequest {
  title: string;
  body: string;
  head: string;
  base: string;
}

export interface PullRequestChanges {
  title?: string;
  body?: string;
  state?: PullRequestState;
}

export interface NewLabel {
  name: string;
  color: string;
  description: string;
}

/** Whether `createLabel` actually created the label or found it already present (idempotent). */
export type CreateLabelResult = 'created' | 'exists';

export interface CommitStatus {
  sha: string;
  state: CommitStatusState;
  description: string;
  context: string;
}

export interface ReleaseRef {
  id: number;
  url: string;
  tagName: string;
}

export interface ReleaseSummary {
  tagName: string;
  draft: boolean;
  prerelease: boolean;
  body: string;
}

export interface NewRelease {
  tagName: string;
  name: string;
  body: string;
  draft: boolean;
  prerelease: boolean;
  generateReleaseNotes?: boolean;
}

export interface ReleaseChanges {
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
export type RepoPermission = 'admin' | 'maintain' | 'write' | 'triage' | 'read' | 'none';

export interface Forge {
  // — Pull requests —
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

  // — Issues —
  createIssue(issue: NewIssue): Promise<IssueRef>;
  /** Update an issue's title/body, or close it (`state: 'closed'`). */
  updateIssue(issueNumber: number, changes: IssueChanges): Promise<void>;
  /** The most-recent open issue (not a PR) carrying `label`, or null — for idempotent reuse of a
   *  single standing issue (e.g. the manual-mode release draft) instead of stacking new ones. */
  findOpenIssueByLabel(label: string): Promise<IssueRef | null>;

  // — Marker comments —
  /** The first comment whose body starts with `marker` (id + body), or null. */
  findComment(prNumber: number, marker: string): Promise<ForgeComment | null>;
  createComment(prNumber: number, body: string): Promise<void>;
  updateComment(commentId: number, body: string): Promise<void>;
  /** Create the marker comment, or update the existing one — never stack a second. */
  upsertMarkerComment(prNumber: number, marker: string, body: string): Promise<void>;

  // — Labels —
  /** Every label name defined on the repository. */
  listLabelNames(): Promise<string[]>;
  /** Create a label; resolves to 'exists' (not an error) when it is already present. */
  createLabel(label: NewLabel): Promise<CreateLabelResult>;
  /** Replace the full label set on an issue/PR. */
  setLabels(issueNumber: number, labels: string[]): Promise<void>;

  // — Authorization —
  /** The actor's permission level on the repo (for gating who may steer the standing PR). Returns
   *  'none' for an unknown/outside actor rather than throwing. */
  getActorPermission(username: string): Promise<RepoPermission>;
  /** Whether `username` is an active member of `org`/`teamSlug`. Returns false when not a member;
   *  throws on an access error (e.g. a token without org-read scope) so the caller can surface it. */
  isTeamMember(org: string, teamSlug: string, username: string): Promise<boolean>;

  // — Commit status —
  setCommitStatus(status: CommitStatus): Promise<void>;

  // — Releases —
  listReleases(): Promise<ReleaseSummary[]>;
  createRelease(release: NewRelease): Promise<ReleaseRef>;
  updateRelease(releaseId: number, release: ReleaseChanges): Promise<ReleaseRef>;
  getReleaseByTag(tag: string): Promise<ReleaseRef | null>;
}
