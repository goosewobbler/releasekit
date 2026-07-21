import { Octokit } from '@octokit/rest';
import { forgeErrorStatus } from './errors.js';
import type {
  AssociatedPullRequest,
  CommitStatus,
  CreateLabelResult,
  Forge,
  ForgeComment,
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

const REPO_PERMISSIONS: readonly RepoPermission[] = ['admin', 'maintain', 'write', 'triage', 'read', 'none'];

/** Releases are listed at most this many pages deep (100/page) — bounds the examples fetch. */
const MAX_RELEASE_PAGES = 3;

/** Open PRs are listed at most this many pages deep (100/page) — bounds the post-release refresh. */
const MAX_OPEN_PR_PAGES = 5;

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

  async listOpenPullRequests(): Promise<OpenPullRequest[]> {
    const prs: OpenPullRequest[] = [];
    for (let page = 1; page <= MAX_OPEN_PR_PAGES; page++) {
      const { data } = await this.octokit.rest.pulls.list({
        ...this.base,
        state: 'open',
        sort: 'updated',
        direction: 'desc',
        per_page: 100,
        page,
      });
      for (const pr of data) {
        prs.push({ number: pr.number, headRef: pr.head.ref, draft: pr.draft ?? false, baseSha: pr.base.sha });
      }
      if (data.length < 100) break;
    }
    return prs;
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

  async createIssue(issue: NewIssue): Promise<IssueRef> {
    const { data } = await this.octokit.rest.issues.create({ ...this.base, ...issue });
    return { number: data.number, url: data.html_url };
  }

  async updateIssue(issueNumber: number, changes: IssueChanges): Promise<void> {
    await this.octokit.rest.issues.update({ ...this.base, issue_number: issueNumber, ...changes });
  }

  async findOpenIssueByLabel(label: string): Promise<IssueRef | null> {
    // listForRepo returns issues AND PRs; a PR carries a `pull_request` field, so skip those — we
    // only want a real issue. Paginate rather than read one page, so a page full of label-carrying
    // PRs (or an older reusable issue) can't hide the issue and leave the caller stacking a duplicate.
    // Default sort is newest-first, so the first real issue we reach is the most recent.
    const iterator = this.octokit.paginate.iterator(this.octokit.rest.issues.listForRepo, {
      ...this.base,
      state: 'open',
      labels: label,
      per_page: 100,
    });
    for await (const response of iterator) {
      for (const issue of response.data) {
        if (!issue.pull_request) return { number: issue.number, url: issue.html_url };
      }
    }
    return null;
  }

  async getActorPermission(username: string): Promise<RepoPermission> {
    try {
      const { data } = await this.octokit.rest.repos.getCollaboratorPermissionLevel({ ...this.base, username });
      // Prefer `role_name` — it distinguishes maintain/triage, which the coarse `permission`
      // ('admin'|'write'|'read'|'none') collapses. Fall back to `permission` for older API shapes.
      const role = data.role_name as RepoPermission | undefined;
      if (role && REPO_PERMISSIONS.includes(role)) return role;
      return (data.permission as RepoPermission) ?? 'none';
    } catch (error) {
      // 404 = not a collaborator / unknown user → genuinely no permission. Any other error (403 from a
      // mis-scoped token, 429 rate limit, 5xx, network) means we CAN'T determine permission — surface
      // it rather than silently reporting 'none', which would fail the gate closed for every real
      // actor (even admins) with no diagnostic.
      if (forgeErrorStatus(error) === 404) return 'none';
      throw error;
    }
  }

  async isTeamMember(org: string, teamSlug: string, username: string): Promise<boolean> {
    try {
      const { data } = await this.octokit.rest.teams.getMembershipForUserInOrg({ org, team_slug: teamSlug, username });
      // A pending invite is not yet a member; only 'active' membership authorizes.
      return data.state === 'active';
    } catch (error) {
      // 404 = not a member. Any other error (403 = the token lacks org-read scope, network, …) can't
      // be answered — surface it (the caller's gate wrapper warns and fails closed) rather than
      // silently reporting "not a member", which is indistinguishable from a real non-member.
      if (forgeErrorStatus(error) === 404) return false;
      throw error;
    }
  }

  async findComment(prNumber: number, marker: string): Promise<ForgeComment | null> {
    const iterator = this.octokit.paginate.iterator(this.octokit.rest.issues.listComments, {
      ...this.base,
      issue_number: prNumber,
      per_page: 100,
    });
    // Prefer a bot-authored match over a human-authored one carrying the same marker: a pre-seeded
    // marker comment (write access, or the upsert race) must never shadow the bot's real one.
    // A human-authored match is still returned when it's the only one, so the caller can reject it.
    let humanMatch: ForgeComment | null = null;
    for await (const response of iterator) {
      for (const comment of response.data) {
        if (!comment.body?.startsWith(marker)) continue;
        const found: ForgeComment = {
          id: comment.id,
          body: comment.body,
          user: comment.user ? { login: comment.user.login, type: comment.user.type } : undefined,
        };
        if (isBotComment(found)) return found;
        humanMatch ??= found;
      }
    }
    return humanMatch;
  }

  async createComment(prNumber: number, body: string): Promise<void> {
    await this.octokit.rest.issues.createComment({ ...this.base, issue_number: prNumber, body });
  }

  async updateComment(commentId: number, body: string): Promise<void> {
    await this.octokit.rest.issues.updateComment({ ...this.base, comment_id: commentId, body });
  }

  async upsertMarkerComment(prNumber: number, marker: string, body: string): Promise<void> {
    const existing = await this.findComment(prNumber, marker);
    // Only adopt (update in place) a comment the bot itself authored. A human-authored comment
    // carrying the marker — pre-seeded to win the adoption race — is left alone; the bot posts its
    // own so its content is authoritative and never laundered through an attacker-owned comment.
    if (existing && isBotComment(existing)) {
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
