import type {
  AssociatedPullRequest,
  CommentAuthor,
  CommitStatus,
  CreateLabelResult,
  Forge,
  IssueChanges,
  IssueDetails,
  IssueRef,
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

interface FakeComment {
  id: number;
  body: string;
  /** Left undefined, a seeded comment is visible from any PR's `findComment`. */
  prNumber?: number;
  /** Left undefined, a seeded comment reads as bot-authored. */
  user?: CommentAuthor;
}

export interface FakeForgeSeed {
  standingPR?: StandingPullRequest | null;
  recentlyClosedPRs?: AssociatedPullRequest[];
  openPullRequests?: OpenPullRequest[];
  pullRequestsForCommit?: Record<string, AssociatedPullRequest[]>;
  issues?: Record<number, IssueDetails>;
  openIssues?: Array<{ number: number; url: string; labels: string[] }>;
  pullRequests?: Record<number, PullRequestDetails>;
  comments?: FakeComment[];
  labelNames?: string[];
  releases?: ReleaseSummary[];
  releasesByTag?: Record<string, ReleaseRef>;
  actorPermissions?: Record<string, RepoPermission>;
  /** Keyed by `org/team-slug`. */
  teamMemberships?: Record<string, string[]>;
}

export class FakeForge implements Forge {
  standingPR: StandingPullRequest | null;
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

  // Recorded writes, for assertions.
  readonly createdComments: Array<{ prNumber: number; body: string }> = [];
  readonly updatedComments: Array<{ commentId: number; body: string }> = [];
  readonly upsertedComments: Array<{ prNumber: number; marker: string; body: string }> = [];
  readonly createdPullRequests: NewPullRequest[] = [];
  readonly updatedPullRequests: Array<{ prNumber: number; changes: PullRequestChanges }> = [];
  readonly mergedPullRequests: Array<{ prNumber: number; method: MergeMethod }> = [];
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
    this.issues = seed.issues ?? {};
    this.openIssues = [...(seed.openIssues ?? [])];
    // Issues seeded for getIssue are also discoverable by findOpenIssueByLabel, as on GitHub.
    for (const [num, details] of Object.entries(this.issues)) {
      const n = Number(num);
      if (!details.isPullRequest && !this.openIssues.some((i) => i.number === n)) {
        this.openIssues.push({ number: n, url: `https://github.com/fake/fake/issues/${n}`, labels: details.labels });
      }
    }
    this.pullRequestDetails = seed.pullRequests ?? {};
    this.comments = [...(seed.comments ?? [])];
    this.labelNames = [...(seed.labelNames ?? [])];
    this.releases = seed.releases ?? [];
    this.releasesByTag = seed.releasesByTag ?? {};
    this.actorPermissions = seed.actorPermissions ?? {};
    this.teamMemberships = seed.teamMemberships ?? {};
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
    return this.standingPR;
  }

  async listRecentlyClosedPullRequests(_branch: string, limit: number): Promise<AssociatedPullRequest[]> {
    return this.recentlyClosedPRs.slice(0, limit);
  }

  async listOpenPullRequests(): Promise<OpenPullRequest[]> {
    return [...this.openPullRequests];
  }

  async getIssue(issueNumber: number): Promise<IssueDetails> {
    return this.issues[issueNumber] ?? { body: '', title: '', labels: [], isPullRequest: true };
  }

  async getPullRequest(prNumber: number): Promise<PullRequestDetails> {
    return this.pullRequestDetails[prNumber] ?? { body: '', labels: [] };
  }

  async createPullRequest(pr: NewPullRequest): Promise<PullRequestRef> {
    this.createdPullRequests.push(pr);
    const number = this.nextNumber++;
    return { number, url: `https://github.com/fake/fake/pull/${number}` };
  }

  async updatePullRequest(prNumber: number, changes: PullRequestChanges): Promise<void> {
    this.updatedPullRequests.push({ prNumber, changes });
  }

  async mergePullRequest(prNumber: number, method: MergeMethod): Promise<void> {
    this.mergedPullRequests.push({ prNumber, method });
  }

  async createIssue(issue: NewIssue): Promise<IssueRef> {
    this.createdIssues.push(issue);
    const number = this.nextNumber++;
    const url = `https://github.com/fake/fake/issues/${number}`;
    const labels = issue.labels ?? [];
    this.openIssues.push({ number, url, labels });
    this.issues[number] = { body: issue.body, title: issue.title, labels, isPullRequest: false };
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
    }
    if (changes.state === 'closed') {
      this.openIssues = this.openIssues.filter((i) => i.number !== issueNumber);
    }
  }

  async findOpenIssueByLabel(label: string): Promise<IssueRef | null> {
    // GitHub returns newest-first; the highest number approximates newest.
    const matches = this.openIssues.filter((i) => i.labels.includes(label)).sort((a, b) => b.number - a.number);
    return matches[0] ? { number: matches[0].number, url: matches[0].url } : null;
  }

  async findComment(prNumber: number, marker: string): Promise<FakeComment | null> {
    const matches = this.comments.filter(
      (c) => c.body.startsWith(marker) && (c.prNumber === undefined || c.prNumber === prNumber),
    );
    // Mirrors GitHubForge.findComment.
    return matches.find((c) => isBotComment(c)) ?? matches[0] ?? null;
  }

  async createComment(prNumber: number, body: string): Promise<void> {
    this.createdComments.push({ prNumber, body });
    this.comments.push({ id: this.nextCommentId++, body, prNumber });
  }

  async updateComment(commentId: number, body: string): Promise<void> {
    this.updatedComments.push({ commentId, body });
    const comment = this.comments.find((c) => c.id === commentId);
    if (comment) {
      comment.body = body;
    }
  }

  async upsertMarkerComment(prNumber: number, marker: string, body: string): Promise<void> {
    this.upsertedComments.push({ prNumber, marker, body });
    const existing = await this.findComment(prNumber, marker);
    if (existing && isBotComment(existing)) {
      await this.updateComment(existing.id, body);
    } else {
      await this.createComment(prNumber, body);
    }
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
