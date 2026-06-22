import type {
  AssociatedPullRequest,
  CommitStatus,
  CreateLabelResult,
  Forge,
  IssueDetails,
  MergeMethod,
  NewLabel,
  NewPullRequest,
  NewRelease,
  PullRequestChanges,
  PullRequestDetails,
  PullRequestRef,
  ReleaseChanges,
  ReleaseRef,
  ReleaseSummary,
  StandingPullRequest,
} from './types.js';

interface FakeComment {
  id: number;
  body: string;
  /**
   * The PR the comment lives on. `createComment` tags it; a seeded comment may set it to scope the
   * comment to one PR. Left undefined, a seeded comment is "ambient" — visible from any PR's
   * `findComment` (a convenience for the common single-PR test).
   */
  prNumber?: number;
}

/** Seed state for a {@link FakeForge}. Everything is optional; unseeded reads return empty/null. */
export interface FakeForgeSeed {
  standingPR?: StandingPullRequest | null;
  recentlyClosedPRs?: AssociatedPullRequest[];
  pullRequestsForCommit?: Record<string, AssociatedPullRequest[]>;
  issues?: Record<number, IssueDetails>;
  pullRequests?: Record<number, PullRequestDetails>;
  comments?: FakeComment[];
  labelNames?: string[];
  releases?: ReleaseSummary[];
  releasesByTag?: Record<string, ReleaseRef>;
}

/**
 * In-memory {@link Forge} for tests — the second adapter that justifies the seam. Reads return seeded
 * data; writes mutate in-memory state and are recorded on public arrays for assertions. Comment and
 * label operations behave realistically (marker upsert finds/updates a seeded comment; createLabel is
 * idempotent) so callers can be exercised end-to-end without an Octokit mock.
 */
export class FakeForge implements Forge {
  standingPR: StandingPullRequest | null;
  private readonly recentlyClosedPRs: AssociatedPullRequest[];
  private readonly pullRequestsForCommit: Record<string, AssociatedPullRequest[]>;
  private readonly issues: Record<number, IssueDetails>;
  private readonly pullRequestDetails: Record<number, PullRequestDetails>;
  comments: FakeComment[];
  labelNames: string[];
  private readonly releases: ReleaseSummary[];
  private readonly releasesByTag: Record<string, ReleaseRef>;

  // Recorded writes, for assertions.
  readonly createdComments: Array<{ prNumber: number; body: string }> = [];
  readonly updatedComments: Array<{ commentId: number; body: string }> = [];
  readonly upsertedComments: Array<{ prNumber: number; marker: string; body: string }> = [];
  readonly createdPullRequests: NewPullRequest[] = [];
  readonly updatedPullRequests: Array<{ prNumber: number; changes: PullRequestChanges }> = [];
  readonly mergedPullRequests: Array<{ prNumber: number; method: MergeMethod }> = [];
  readonly createdLabels: NewLabel[] = [];
  readonly setLabelsCalls: Array<{ issueNumber: number; labels: string[] }> = [];
  readonly commitStatuses: CommitStatus[] = [];
  readonly createdReleases: NewRelease[] = [];
  readonly updatedReleases: Array<{ releaseId: number; release: ReleaseChanges }> = [];

  private nextCommentId: number;
  private nextPrNumber = 42;
  private nextReleaseId = 1;

  constructor(seed: FakeForgeSeed = {}) {
    this.standingPR = seed.standingPR ?? null;
    this.recentlyClosedPRs = seed.recentlyClosedPRs ?? [];
    this.pullRequestsForCommit = seed.pullRequestsForCommit ?? {};
    this.issues = seed.issues ?? {};
    this.pullRequestDetails = seed.pullRequests ?? {};
    this.comments = [...(seed.comments ?? [])];
    this.labelNames = [...(seed.labelNames ?? [])];
    this.releases = seed.releases ?? [];
    this.releasesByTag = seed.releasesByTag ?? {};
    this.nextCommentId = Math.max(0, ...this.comments.map((c) => c.id)) + 1;
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

  async getIssue(issueNumber: number): Promise<IssueDetails> {
    return this.issues[issueNumber] ?? { body: '', title: '', labels: [], isPullRequest: true };
  }

  async getPullRequest(prNumber: number): Promise<PullRequestDetails> {
    return this.pullRequestDetails[prNumber] ?? { body: '', labels: [] };
  }

  async createPullRequest(pr: NewPullRequest): Promise<PullRequestRef> {
    this.createdPullRequests.push(pr);
    const number = this.nextPrNumber++;
    return { number, url: `https://github.com/fake/fake/pull/${number}` };
  }

  async updatePullRequest(prNumber: number, changes: PullRequestChanges): Promise<void> {
    this.updatedPullRequests.push({ prNumber, changes });
  }

  async mergePullRequest(prNumber: number, method: MergeMethod): Promise<void> {
    this.mergedPullRequests.push({ prNumber, method });
  }

  async findComment(prNumber: number, marker: string): Promise<FakeComment | null> {
    return (
      this.comments.find((c) => c.body.startsWith(marker) && (c.prNumber === undefined || c.prNumber === prNumber)) ??
      null
    );
  }

  async createComment(prNumber: number, body: string): Promise<void> {
    this.createdComments.push({ prNumber, body });
    this.comments.push({ id: this.nextCommentId++, body, prNumber });
  }

  async updateComment(commentId: number, body: string): Promise<void> {
    this.updatedComments.push({ commentId, body });
    const comment = this.comments.find((c) => c.id === commentId);
    if (comment) comment.body = body;
  }

  async upsertMarkerComment(prNumber: number, marker: string, body: string): Promise<void> {
    this.upsertedComments.push({ prNumber, marker, body });
    const existing = await this.findComment(prNumber, marker);
    if (existing) {
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
    if (this.labelNames.includes(label.name)) return 'exists';
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

/** Convenience factory mirroring {@link createGitHubForge}. */
export function createFakeForge(seed: FakeForgeSeed = {}): FakeForge {
  return new FakeForge(seed);
}
