import type {
  AssociatedPullRequest,
  AuthoredBody,
  CommentAuthor,
  CommitStatus,
  CreateLabelResult,
  Forge,
  ForgeComment,
  IssueChanges,
  IssueDetails,
  IssueRef,
  IssueState,
  LabelEvent,
  MergeMethod,
  NewIssue,
  NewLabel,
  NewPullRequest,
  NewRelease,
  OpenPullRequest,
  PullRequestChanges,
  PullRequestDetails,
  PullRequestRef,
  ReleaseChanges,
  ReleaseRef,
  ReleaseSummary,
  RepoPermission,
  StandingPullRequest,
} from './types.js';
import { isBotComment } from './types.js';

/** The default author of seeded comments and issues, and of the fake's own writes. */
export const FAKE_BOT: CommentAuthor = { login: 'github-actions[bot]', type: 'Bot' };

interface FakeComment {
  id: number;
  nodeId: string;
  body: string;
  /** Left undefined, a seeded comment is visible from any PR's `findComment`. */
  prNumber?: number;
  /** Left undefined, a seeded comment reads as written by {@link FAKE_BOT}. */
  user?: CommentAuthor;
  /** As {@link AuthoredBody.editors}. */
  editors: Array<CommentAuthor | undefined>;
}

function commentNodeId(id: number): string {
  return `IC_${id}`;
}

/** Left undefined, a seeded issue is open. */
type FakeIssue = Omit<IssueDetails, 'state'> & { state?: IssueState };

/** `nodeId` defaults to `PR_<number>`. */
export type FakeStandingPullRequest = Omit<StandingPullRequest, 'nodeId'> & { nodeId?: string };

export interface FakeForgeSeed {
  standingPR?: FakeStandingPullRequest | null;
  recentlyClosedPRs?: AssociatedPullRequest[];
  openPullRequests?: OpenPullRequest[];
  pullRequestsForCommit?: Record<string, AssociatedPullRequest[]>;
  issues?: Record<number, FakeIssue>;
  openIssues?: Array<{ number: number; url: string; labels: string[] }>;
  pullRequests?: Record<number, PullRequestDetails>;
  /** A comment's `editor` seeds one edit by that account. */
  comments?: Array<Omit<FakeComment, 'nodeId' | 'editors'> & { editor?: CommentAuthor }>;
  labelNames?: string[];
  releases?: ReleaseSummary[];
  releasesByTag?: Record<string, ReleaseRef>;
  actorPermissions?: Record<string, RepoPermission>;
  /** Keyed by `org/team-slug`. */
  teamMemberships?: Record<string, string[]>;
  /**
   * Keyed by node ID. A PR's node (`PR_<number>`) defaults to its `pullRequests` body, opened by the bot and never
   * edited.
   */
  authoredBodies?: Record<string, AuthoredBody>;
  /** Unseeded, the standing PR's labels read as applied by the bot. */
  labelEvents?: Record<number, LabelEvent[]>;
  /** Who the fake's comment and issue writes are attributed to: the token's account. Defaults to {@link FAKE_BOT}. */
  actor?: CommentAuthor;
}

export class FakeForge implements Forge {
  standingPR: FakeStandingPullRequest | null;
  private readonly recentlyClosedPRs: AssociatedPullRequest[];
  private readonly openPullRequests: OpenPullRequest[];
  private readonly pullRequestsForCommit: Record<string, AssociatedPullRequest[]>;
  private readonly issues: Record<number, IssueDetails>;
  private openIssues: Array<{ number: number; url: string; labels: string[] }>;
  private readonly pullRequestDetails: Record<number, PullRequestDetails>;
  comments: FakeComment[];
  labelNames: string[];
  private readonly releases: ReleaseSummary[];
  private readonly releasesByTag: Record<string, ReleaseRef>;
  private readonly actorPermissions: Record<string, RepoPermission>;
  private readonly teamMemberships: Record<string, string[]>;
  private readonly authoredBodies: Record<string, AuthoredBody>;
  private readonly labelEvents: Record<number, LabelEvent[]>;
  private readonly actor: CommentAuthor;

  // Recorded writes, for assertions.
  readonly createdComments: Array<{ prNumber: number; body: string }> = [];
  readonly updatedComments: Array<{ commentId: number; body: string }> = [];
  readonly upsertedComments: Array<{ prNumber: number; marker: string; body: string }> = [];
  readonly createdPullRequests: NewPullRequest[] = [];
  readonly updatedPullRequests: Array<{ prNumber: number; changes: PullRequestChanges }> = [];
  readonly mergedPullRequests: Array<{ prNumber: number; method: MergeMethod; sha?: string }> = [];
  readonly createdIssues: NewIssue[] = [];
  readonly updatedIssues: Array<{ issueNumber: number; changes: IssueChanges }> = [];
  readonly createdLabels: NewLabel[] = [];
  readonly setLabelsCalls: Array<{ issueNumber: number; labels: string[] }> = [];
  readonly commitStatuses: CommitStatus[] = [];
  readonly createdReleases: NewRelease[] = [];
  readonly updatedReleases: Array<{ releaseId: number; release: ReleaseChanges }> = [];

  private nextCommentId: number;
  // Issues and PRs share one number space on GitHub.
  private nextNumber = 42;
  private nextReleaseId = 1;

  constructor(seed: FakeForgeSeed = {}) {
    this.standingPR = seed.standingPR ?? null;
    this.recentlyClosedPRs = seed.recentlyClosedPRs ?? [];
    this.openPullRequests = seed.openPullRequests ?? [];
    this.pullRequestsForCommit = seed.pullRequestsForCommit ?? {};
    this.issues = Object.fromEntries(
      Object.entries(seed.issues ?? {}).map(([n, issue]) => [n, { ...issue, state: issue.state ?? 'open' }]),
    );
    this.openIssues = [...(seed.openIssues ?? [])];
    // Issues seeded for getIssue are also discoverable by listOpenIssuesByLabel, as on GitHub.
    for (const [num, details] of Object.entries(this.issues)) {
      const n = Number(num);
      if (!details.isPullRequest && details.state === 'open' && !this.openIssues.some((i) => i.number === n)) {
        this.openIssues.push({ number: n, url: `https://github.com/fake/fake/issues/${n}`, labels: details.labels });
      }
    }
    this.pullRequestDetails = seed.pullRequests ?? {};
    this.comments = (seed.comments ?? []).map(({ editor, ...c }) => {
      const user = c.user ?? FAKE_BOT;
      return { ...c, nodeId: commentNodeId(c.id), user, editors: editor ? [editor, user] : [] };
    });
    this.labelNames = [...(seed.labelNames ?? [])];
    this.releases = seed.releases ?? [];
    this.releasesByTag = seed.releasesByTag ?? {};
    this.actorPermissions = seed.actorPermissions ?? {};
    this.teamMemberships = seed.teamMemberships ?? {};
    this.authoredBodies = seed.authoredBodies ?? {};
    this.labelEvents = seed.labelEvents ?? {};
    this.actor = seed.actor ?? FAKE_BOT;
    this.nextCommentId = Math.max(0, ...this.comments.map((c) => c.id)) + 1;
  }

  async isTeamMember(org: string, teamSlug: string, username: string): Promise<boolean> {
    // GitHub resolves org/team slugs and usernames case-insensitively.
    const lcUser = username.toLowerCase();
    const lcKey = `${org}/${teamSlug}`.toLowerCase();
    const key = Object.keys(this.teamMemberships).find((k) => k.toLowerCase() === lcKey);
    return (key ? this.teamMemberships[key] : []).some((m) => m.toLowerCase() === lcUser);
  }

  async getActorPermission(username: string): Promise<RepoPermission> {
    const lc = username.toLowerCase();
    const key = Object.keys(this.actorPermissions).find((k) => k.toLowerCase() === lc);
    return (key !== undefined ? this.actorPermissions[key] : undefined) ?? 'none';
  }

  async listPullRequestsForCommit(commitSha: string): Promise<AssociatedPullRequest[]> {
    return this.pullRequestsForCommit[commitSha] ?? [];
  }

  async findStandingPR(_branch: string): Promise<StandingPullRequest | null> {
    return this.standingPR && { nodeId: `PR_${this.standingPR.number}`, ...this.standingPR };
  }

  async listRecentlyClosedPullRequests(_branch: string, limit: number): Promise<AssociatedPullRequest[]> {
    return this.recentlyClosedPRs.slice(0, limit);
  }

  async listOpenPullRequests(base: string, limit: number): Promise<OpenPullRequest[]> {
    return this.openPullRequests.filter((pr) => pr.baseRef === base).slice(0, limit);
  }

  async getIssue(issueNumber: number): Promise<IssueDetails> {
    const issue = this.issues[issueNumber] ?? { body: '', title: '', labels: [], isPullRequest: true, state: 'open' };
    return { author: FAKE_BOT, ...issue };
  }

  async getPullRequest(prNumber: number): Promise<PullRequestDetails> {
    return this.pullRequestDetails[prNumber] ?? { body: '', labels: [] };
  }

  async getAuthoredBody(nodeId: string): Promise<AuthoredBody> {
    const seeded = this.authoredBodies[nodeId];
    if (seeded) {
      return seeded;
    }
    const comment = this.comments.find((c) => c.nodeId === nodeId);
    if (comment) {
      return { body: comment.body, author: comment.user, editor: comment.editors[0], editors: [...comment.editors] };
    }
    const prNumber = /^PR_(\d+)$/.exec(nodeId)?.[1];
    if (prNumber === undefined) {
      throw new Error(`No PR, issue or comment with node ID ${nodeId}`);
    }
    return { body: (await this.getPullRequest(Number(prNumber))).body, author: FAKE_BOT, editors: [] };
  }

  async createPullRequest(pr: NewPullRequest): Promise<PullRequestRef> {
    this.createdPullRequests.push(pr);
    const number = this.nextNumber++;
    return { number, url: `https://github.com/fake/fake/pull/${number}` };
  }

  async updatePullRequest(prNumber: number, changes: PullRequestChanges): Promise<void> {
    this.updatedPullRequests.push({ prNumber, changes });
  }

  async mergePullRequest(prNumber: number, method: MergeMethod, sha?: string): Promise<void> {
    const head = this.pullRequestDetails[prNumber]?.headSha;
    if (sha && head && sha !== head) {
      // GitHub's response when the PR's head isn't `sha`.
      throw Object.assign(new Error('Head branch was modified. Review and try the merge again.'), { status: 409 });
    }
    this.mergedPullRequests.push({ prNumber, method, sha });
  }

  async createIssue(issue: NewIssue): Promise<IssueRef> {
    this.createdIssues.push(issue);
    const number = this.nextNumber++;
    const url = `https://github.com/fake/fake/issues/${number}`;
    const labels = issue.labels ?? [];
    this.openIssues.push({ number, url, labels });
    this.issues[number] = {
      body: issue.body,
      title: issue.title,
      labels,
      isPullRequest: false,
      state: 'open',
      author: this.actor,
    };
    return { number, url };
  }

  async updateIssue(issueNumber: number, changes: IssueChanges): Promise<void> {
    this.updatedIssues.push({ issueNumber, changes });
    const existing = this.issues[issueNumber];
    if (existing) {
      if (changes.body !== undefined) {
        existing.body = changes.body;
      }
      if (changes.title !== undefined) {
        existing.title = changes.title;
      }
      if (changes.state !== undefined) {
        existing.state = changes.state;
      }
    }
    if (changes.state === 'closed') {
      this.openIssues = this.openIssues.filter((i) => i.number !== issueNumber);
    }
  }

  async listOpenIssuesByLabel(label: string): Promise<IssueRef[]> {
    // GitHub returns newest-first; the highest number approximates newest.
    return this.openIssues
      .filter((i) => i.labels.includes(label))
      .sort((a, b) => b.number - a.number)
      .map(({ number, url }) => ({ number, url }));
  }

  async findComment(prNumber: number, marker: string): Promise<FakeComment | null> {
    const matches = this.comments.filter(
      (c) => c.body.startsWith(marker) && (c.prNumber === undefined || c.prNumber === prNumber),
    );
    // Mirrors GitHubForge.findComment.
    return matches.find((c) => isBotComment(c)) ?? matches[0] ?? null;
  }

  async createComment(prNumber: number, body: string): Promise<ForgeComment> {
    this.createdComments.push({ prNumber, body });
    const id = this.nextCommentId++;
    const comment = { id, nodeId: commentNodeId(id), body, prNumber, user: this.actor, editors: [] };
    this.comments.push(comment);
    return { id, nodeId: comment.nodeId, body, user: comment.user };
  }

  async updateComment(commentId: number, body: string): Promise<ForgeComment> {
    this.updatedComments.push({ commentId, body });
    const comment = this.comments.find((c) => c.id === commentId);
    if (comment) {
      comment.body = body;
      comment.editors = [this.actor, ...(comment.editors.length > 0 ? comment.editors : [comment.user])];
    }
    // An edit keeps the comment's original author.
    return { id: commentId, nodeId: commentNodeId(commentId), body, user: comment?.user };
  }

  async upsertMarkerComment(prNumber: number, marker: string, body: string): Promise<ForgeComment> {
    this.upsertedComments.push({ prNumber, marker, body });
    const existing = await this.findComment(prNumber, marker);
    return existing && isBotComment(existing)
      ? this.updateComment(existing.id, body)
      : this.createComment(prNumber, body);
  }

  async listLabelNames(): Promise<string[]> {
    return [...this.labelNames];
  }

  async createLabel(label: NewLabel): Promise<CreateLabelResult> {
    this.createdLabels.push(label);
    if (this.labelNames.includes(label.name)) {
      return 'exists';
    }
    this.labelNames.push(label.name);
    return 'created';
  }

  async setLabels(issueNumber: number, labels: string[]): Promise<void> {
    this.setLabelsCalls.push({ issueNumber, labels });
  }

  async listLabelEvents(issueNumber: number): Promise<LabelEvent[]> {
    const seeded = this.labelEvents[issueNumber];
    if (seeded) {
      return seeded;
    }
    const labels = this.standingPR?.number === issueNumber ? this.standingPR.labels : [];
    return labels.map((label) => ({ action: 'labeled', label, actor: FAKE_BOT }));
  }

  async setCommitStatus(status: CommitStatus): Promise<void> {
    this.commitStatuses.push(status);
  }

  async listReleases(): Promise<ReleaseSummary[]> {
    return this.releases;
  }

  async createRelease(release: NewRelease): Promise<ReleaseRef> {
    this.createdReleases.push(release);
    const id = this.nextReleaseId++;
    return { id, url: `https://github.com/fake/fake/releases/${id}`, tagName: release.tagName };
  }

  async updateRelease(releaseId: number, release: ReleaseChanges): Promise<ReleaseRef> {
    this.updatedReleases.push({ releaseId, release });
    return { id: releaseId, url: `https://github.com/fake/fake/releases/${releaseId}`, tagName: release.tagName };
  }

  async getReleaseByTag(tag: string): Promise<ReleaseRef | null> {
    return this.releasesByTag[tag] ?? null;
  }
}

export function createFakeForge(seed: FakeForgeSeed = {}): FakeForge {
  return new FakeForge(seed);
}
