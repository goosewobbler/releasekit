export type CommitStatusState = 'error' | 'failure' | 'pending' | 'success';
export type PullRequestState = 'open' | 'closed';
export type MergeMethod = 'merge' | 'squash' | 'rebase';

export interface PullRequestRef {
  number: number;
  url: string;
}

export interface StandingPullRequest extends PullRequestRef {
  labels: string[];
  /** Identifies the PR to `getAuthoredBody`. */
  nodeId: string;
}

export interface AssociatedPullRequest {
  number: number;
  mergedAt: string | null;
}

export interface OpenPullRequest {
  number: number;
  headRef: string;
  baseRef: string;
}

export interface IssueDetails {
  body: string;
  title: string;
  labels: string[];
  /** The issues endpoint also returns PRs. */
  isPullRequest: boolean;
  state: IssueState;
  author?: CommentAuthor;
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
  headSha?: string;
  headRef?: string;
  baseRef?: string;
  merged?: boolean;
  /** For a merged PR, the commit the merge put on the base branch. */
  mergeCommitSha?: string;
  mergedBy?: { login: string; type?: string };
}

export interface CommentAuthor {
  login?: string;
  /** `'Bot'` for a GitHub App / bot actor, `'User'` for a human. */
  type?: string;
}

export interface ForgeComment {
  id: number;
  /** Identifies the comment to `getAuthoredBody`. */
  nodeId: string;
  body: string;
  user?: CommentAuthor;
}

/**
 * A machine-state marker comment (the release manifest, previews, failure reports) is only trustworthy when a bot
 * wrote it. An unknown author is untrusted, since GitHub's API can report none.
 */
export function isBotComment(comment: Pick<ForgeComment, 'user'>): boolean {
  const user = comment.user;
  return user?.type === 'Bot' || user?.login?.endsWith('[bot]') === true;
}

/** A PR's, issue's or comment's body with who wrote it and who last edited it, read together. */
export interface AuthoredBody {
  body: string;
  author?: CommentAuthor;
  /** Unset when the body was never edited. */
  editor?: CommentAuthor;
  lastEditedAt?: string;
  /**
   * Who made each of the latest 100 revisions, newest first, ending with the original if it's among them. `undefined`
   * for an account that no longer exists.
   */
  editors: Array<CommentAuthor | undefined>;
}

export interface LabelEvent {
  action: 'labeled' | 'unlabeled';
  label: string;
  actor?: CommentAuthor;
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
  /** Up to `limit` open PRs into `base`, most-recently-updated first. */
  listOpenPullRequests(base: string, limit: number): Promise<OpenPullRequest[]>;
  getIssue(issueNumber: number): Promise<IssueDetails>;
  getPullRequest(prNumber: number): Promise<PullRequestDetails>;
  /** The body, author and editors of the PR, issue or comment `nodeId` identifies. */
  getAuthoredBody(nodeId: string): Promise<AuthoredBody>;
  createPullRequest(pr: NewPullRequest): Promise<PullRequestRef>;
  updatePullRequest(prNumber: number, changes: PullRequestChanges): Promise<void>;
  /** With `sha`, the merge fails unless the PR's head is still that commit. */
  mergePullRequest(prNumber: number, method: MergeMethod, sha?: string): Promise<void>;

  createIssue(issue: NewIssue): Promise<IssueRef>;
  updateIssue(issueNumber: number, changes: IssueChanges): Promise<void>;
  /** Open issues (not PRs) carrying `label`, most-recent first. */
  listOpenIssuesByLabel(label: string): Promise<IssueRef[]>;

  /** The first bot comment whose body starts with `marker`, else the first such comment by anyone. */
  findComment(prNumber: number, marker: string): Promise<ForgeComment | null>;
  createComment(prNumber: number, body: string): Promise<ForgeComment>;
  updateComment(commentId: number, body: string): Promise<ForgeComment>;
  upsertMarkerComment(prNumber: number, marker: string, body: string): Promise<ForgeComment>;

  listLabelNames(): Promise<string[]>;
  /** Resolves to 'exists' rather than throwing when the label is already present. */
  createLabel(label: NewLabel): Promise<CreateLabelResult>;
  setLabels(issueNumber: number, labels: string[]): Promise<void>;
  /** Every label added to or removed from an issue or PR, oldest first. */
  listLabelEvents(issueNumber: number): Promise<LabelEvent[]>;

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
