export type CommitStatusState = 'error' | 'failure' | 'pending' | 'success';
export type PullRequestState = 'open' | 'closed';
export type MergeMethod = 'merge' | 'squash' | 'rebase';

export interface PullRequestRef {
  number: number;
  url: string;
}

export interface StandingPullRequest extends PullRequestRef {
  labels: string[];
}

export interface AssociatedPullRequest {
  number: number;
  mergedAt: string | null;
}

/** Enough to refresh a PR's preview without its event payload. */
export interface OpenPullRequest {
  number: number;
  headRef: string;
  draft: boolean;
  baseSha: string;
}

export interface IssueDetails {
  body: string;
  title: string;
  labels: string[];
  /** The issues endpoint also returns PRs. */
  isPullRequest: boolean;
}

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

export interface CommentAuthor {
  login?: string;
  /** `'Bot'` for a GitHub App / bot actor, `'User'` for a human. */
  type?: string;
}

export interface ForgeComment {
  id: number;
  body: string;
  user?: CommentAuthor;
}

/**
 * A machine-state marker comment (the release manifest, previews, failure reports) is only trustworthy when the bot
 * wrote it; a human-authored comment carrying the same marker is a forgery and must not be adopted.
 *
 * Fails open on an unknown author - the GitHub adapter always reports one, so `user` is only absent on the fake/legacy
 * paths.
 */
export function isBotComment(comment: Pick<ForgeComment, 'user'>): boolean {
  const user = comment.user;
  if (!user) {
    return true;
  }
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

export type RepoPermission = 'admin' | 'maintain' | 'write' | 'triage' | 'read' | 'none';

/**
 * The hosting platform's collaboration API behind one vendor-neutral interface. Methods take/return plain data, never
 * Octokit types, so the seam stays swappable and the in-memory fake can stand in for the platform. `owner`/`repo`/auth
 * are bound at construction, so callers speak only in domain terms.
 */
export interface Forge {
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
