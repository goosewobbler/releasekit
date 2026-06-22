import { Octokit } from '@octokit/rest';
import type {
  AssociatedPullRequest,
  CommitStatus,
  CreateLabelResult,
  Forge,
  ForgeComment,
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

/** Releases are listed at most this many pages deep (100/page) — bounds the examples fetch. */
const MAX_RELEASE_PAGES = 3;

type LabelLike = string | { name?: string | null };

function labelNames(labels: LabelLike[] | undefined): string[] {
  return (labels ?? []).map((label) => (typeof label === 'string' ? label : (label.name ?? '')));
}

/** Whether a createLabel error is GitHub's idempotent "label already exists" 422. */
function isAlreadyExistsError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  if ((error as { status?: number }).status !== 422) return false;
  // A 422 for "already exists" carries an errors[].code === 'already_exists'. Other 422s (name too
  // long, disallowed characters, …) are real validation failures and must surface to the caller.
  const errors = (error as { response?: { data?: { errors?: Array<{ code?: string }> } } }).response?.data?.errors;
  return Array.isArray(errors) && errors.some((e) => e?.code === 'already_exists');
}

/**
 * Octokit-backed {@link Forge}. `owner`/`repo` are bound at construction so callers speak only in
 * domain terms. Methods map Octokit responses to the plain types in `./types.ts` and otherwise let
 * Octokit errors propagate — callers keep whatever status-specific handling they already had.
 */
export class GitHubForge implements Forge {
  constructor(
    private readonly octokit: Octokit,
    private readonly owner: string,
    private readonly repo: string,
  ) {}

  private get base() {
    return { owner: this.owner, repo: this.repo };
  }

  async listPullRequestsForCommit(commitSha: string): Promise<AssociatedPullRequest[]> {
    const { data } = await this.octokit.rest.repos.listPullRequestsAssociatedWithCommit({
      ...this.base,
      commit_sha: commitSha,
    });
    return data.map((pr) => ({ number: pr.number, mergedAt: pr.merged_at }));
  }

  async findStandingPR(branch: string): Promise<StandingPullRequest | null> {
    const { data } = await this.octokit.rest.pulls.list({
      ...this.base,
      head: `${this.owner}:${branch}`,
      state: 'open',
      per_page: 1,
    });
    const pr = data[0];
    return pr ? { number: pr.number, url: pr.html_url, labels: labelNames(pr.labels).filter(Boolean) } : null;
  }

  async listRecentlyClosedPullRequests(branch: string, limit: number): Promise<AssociatedPullRequest[]> {
    const { data } = await this.octokit.rest.pulls.list({
      ...this.base,
      head: `${this.owner}:${branch}`,
      state: 'closed',
      sort: 'updated',
      direction: 'desc',
      per_page: limit,
    });
    return data.map((pr) => ({ number: pr.number, mergedAt: pr.merged_at }));
  }

  async getIssue(issueNumber: number): Promise<IssueDetails> {
    const { data } = await this.octokit.rest.issues.get({ ...this.base, issue_number: issueNumber });
    return {
      body: data.body ?? '',
      title: data.title,
      labels: labelNames(data.labels),
      isPullRequest: Boolean(data.pull_request),
    };
  }

  async getPullRequest(prNumber: number): Promise<PullRequestDetails> {
    const { data } = await this.octokit.rest.pulls.get({ ...this.base, pull_number: prNumber });
    return { body: data.body ?? '', labels: labelNames(data.labels) };
  }

  async createPullRequest(pr: NewPullRequest): Promise<PullRequestRef> {
    const { data } = await this.octokit.rest.pulls.create({ ...this.base, ...pr });
    return { number: data.number, url: data.html_url };
  }

  async updatePullRequest(prNumber: number, changes: PullRequestChanges): Promise<void> {
    await this.octokit.rest.pulls.update({ ...this.base, pull_number: prNumber, ...changes });
  }

  async mergePullRequest(prNumber: number, method: MergeMethod): Promise<void> {
    await this.octokit.rest.pulls.merge({ ...this.base, pull_number: prNumber, merge_method: method });
  }

  async findComment(prNumber: number, marker: string): Promise<ForgeComment | null> {
    const iterator = this.octokit.paginate.iterator(this.octokit.rest.issues.listComments, {
      ...this.base,
      issue_number: prNumber,
      per_page: 100,
    });
    for await (const response of iterator) {
      for (const comment of response.data) {
        if (comment.body?.startsWith(marker)) return { id: comment.id, body: comment.body };
      }
    }
    return null;
  }

  async createComment(prNumber: number, body: string): Promise<void> {
    await this.octokit.rest.issues.createComment({ ...this.base, issue_number: prNumber, body });
  }

  async updateComment(commentId: number, body: string): Promise<void> {
    await this.octokit.rest.issues.updateComment({ ...this.base, comment_id: commentId, body });
  }

  async upsertMarkerComment(prNumber: number, marker: string, body: string): Promise<void> {
    const existing = await this.findComment(prNumber, marker);
    if (existing) {
      await this.updateComment(existing.id, body);
    } else {
      await this.createComment(prNumber, body);
    }
  }

  async listLabelNames(): Promise<string[]> {
    const names: string[] = [];
    const iterator = this.octokit.paginate.iterator(this.octokit.rest.issues.listLabelsForRepo, {
      ...this.base,
      per_page: 100,
    });
    for await (const response of iterator) {
      for (const label of response.data) names.push(label.name);
    }
    return names;
  }

  async createLabel(label: NewLabel): Promise<CreateLabelResult> {
    try {
      await this.octokit.rest.issues.createLabel({ ...this.base, ...label });
      return 'created';
    } catch (error) {
      if (isAlreadyExistsError(error)) return 'exists';
      throw error;
    }
  }

  async setLabels(issueNumber: number, labels: string[]): Promise<void> {
    await this.octokit.rest.issues.setLabels({ ...this.base, issue_number: issueNumber, labels });
  }

  async setCommitStatus(status: CommitStatus): Promise<void> {
    await this.octokit.rest.repos.createCommitStatus({ ...this.base, ...status });
  }

  async listReleases(): Promise<ReleaseSummary[]> {
    const releases: ReleaseSummary[] = [];
    for (let page = 1; page <= MAX_RELEASE_PAGES; page++) {
      const { data } = await this.octokit.rest.repos.listReleases({ ...this.base, per_page: 100, page });
      for (const r of data) {
        releases.push({ tagName: r.tag_name, draft: r.draft, prerelease: r.prerelease, body: r.body ?? '' });
      }
      if (data.length < 100) break;
    }
    return releases;
  }

  async createRelease(release: NewRelease): Promise<ReleaseRef> {
    const { data } = await this.octokit.rest.repos.createRelease({
      ...this.base,
      tag_name: release.tagName,
      name: release.name,
      body: release.body,
      draft: release.draft,
      prerelease: release.prerelease,
      generate_release_notes: release.generateReleaseNotes ?? false,
    });
    return { id: data.id, url: data.html_url, tagName: data.tag_name };
  }

  async updateRelease(releaseId: number, release: ReleaseChanges): Promise<ReleaseRef> {
    const { data } = await this.octokit.rest.repos.updateRelease({
      ...this.base,
      release_id: releaseId,
      tag_name: release.tagName,
      name: release.name,
      body: release.body,
      draft: release.draft,
      prerelease: release.prerelease,
    });
    return { id: data.id, url: data.html_url, tagName: data.tag_name };
  }

  async getReleaseByTag(tag: string): Promise<ReleaseRef | null> {
    try {
      const { data } = await this.octokit.rest.repos.getReleaseByTag({ ...this.base, tag });
      return { id: data.id, url: data.html_url, tagName: data.tag_name };
    } catch {
      return null;
    }
  }
}

/** Construct a GitHub-backed {@link Forge} for `owner`/`repo`, authenticated with `token`. */
export function createGitHubForge({ token, owner, repo }: { token: string; owner: string; repo: string }): Forge {
  return new GitHubForge(new Octokit({ auth: token }), owner, repo);
}
