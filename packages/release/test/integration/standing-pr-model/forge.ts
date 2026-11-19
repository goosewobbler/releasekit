import {
  type AssociatedPullRequest,
  FakeForge,
  type MergeMethod,
  type NewPullRequest,
  type OpenPullRequest,
  type PullRequestChanges,
  type PullRequestDetails,
  type PullRequestRef,
  type RepoPermission,
  type StandingPullRequest,
} from '@releasekit/forge';
import { MANIFEST_MARKER } from '../../../src/standing-pr/standing-pr.js';

export interface Actor {
  login: string;
  type: 'User' | 'Bot';
}

export const BOT: Actor = { login: 'github-actions[bot]', type: 'Bot' };
export const MAINTAINER: Actor = { login: 'maintainer', type: 'User' };
export const WRITER: Actor = { login: 'writer', type: 'User' };

const PERMISSIONS: Record<string, RepoPermission> = { maintainer: 'maintain', writer: 'write' };

export interface PullRequest {
  number: number;
  title: string;
  body: string;
  head: string;
  base: string;
  labels: string[];
  state: 'open' | 'closed';
  merged: boolean;
  mergedAt?: string;
  mergedBy?: Actor;
  mergeCommitSha?: string;
  /** The head once the PR closes; an open PR's head is read live from the remote. */
  closedHeadSha?: string;
  updatedAt: number;
}

/** What GitHub does on the far side of the forge: squash-merges and branch heads come from real git. */
export interface Remote {
  branchSha(branch: string): string | null;
  squashMerge(head: string, base: string, subject: string): string;
}

/**
 * A fake GitHub whose writes apply: a merge makes a real commit, a push moves an open PR's head, and label and body
 * edits change what the next run reads.
 */
export class StatefulForge extends FakeForge {
  readonly prs = new Map<number, PullRequest>();
  readonly manifestWrites: Array<{ prNumber: number; body: string }> = [];
  /** One-shot fault injection. */
  beforeManifestUpsert?: (prNumber: number) => Promise<void>;
  private nextPrNumber = 100;
  private clock = 0;

  constructor(private readonly remote: Remote) {
    super({ actorPermissions: PERMISSIONS });
  }

  private pr(prNumber: number): PullRequest {
    const pr = this.prs.get(prNumber);
    if (!pr) {
      throw Object.assign(new Error(`Not Found: PR #${prNumber}`), { status: 404 });
    }
    return pr;
  }

  headSha(pr: PullRequest): string | undefined {
    return pr.state === 'open' ? (this.remote.branchSha(pr.head) ?? undefined) : pr.closedHeadSha;
  }

  openStandingPr(branch: string): PullRequest | undefined {
    return [...this.prs.values()].find((pr) => pr.state === 'open' && pr.head === branch);
  }

  override async findStandingPR(branch: string): Promise<StandingPullRequest | null> {
    const pr = this.openStandingPr(branch);
    return pr
      ? { number: pr.number, url: `https://github.com/owner/repo/pull/${pr.number}`, labels: [...pr.labels] }
      : null;
  }

  override async listRecentlyClosedPullRequests(branch: string, limit: number): Promise<AssociatedPullRequest[]> {
    return [...this.prs.values()]
      .filter((pr) => pr.state === 'closed' && pr.head === branch)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, limit)
      .map((pr) => ({ number: pr.number, mergedAt: pr.mergedAt ?? null }));
  }

  override async listOpenPullRequests(base: string, limit: number): Promise<OpenPullRequest[]> {
    return [...this.prs.values()]
      .filter((pr) => pr.state === 'open' && pr.base === base)
      .slice(0, limit)
      .map((pr) => ({ number: pr.number, headRef: pr.head, baseRef: pr.base }));
  }

  override async listPullRequestsForCommit(commitSha: string): Promise<AssociatedPullRequest[]> {
    return [...this.prs.values()]
      .filter((pr) => pr.mergeCommitSha === commitSha)
      .map((pr) => ({ number: pr.number, mergedAt: pr.mergedAt ?? null }));
  }

  override async getPullRequest(prNumber: number): Promise<PullRequestDetails> {
    const pr = this.pr(prNumber);
    return {
      body: pr.body,
      labels: [...pr.labels],
      headSha: this.headSha(pr),
      headRef: pr.head,
      baseRef: pr.base,
      mergeCommitSha: pr.mergeCommitSha,
      mergedBy: pr.mergedBy ? { ...pr.mergedBy } : undefined,
    };
  }

  override async createPullRequest(request: NewPullRequest): Promise<PullRequestRef> {
    this.createdPullRequests.push(request);
    const number = this.nextPrNumber++;
    this.prs.set(number, {
      number,
      title: request.title,
      body: request.body,
      head: request.head,
      base: request.base,
      labels: [],
      state: 'open',
      merged: false,
      updatedAt: this.clock++,
    });
    return { number, url: `https://github.com/owner/repo/pull/${number}` };
  }

  override async updatePullRequest(prNumber: number, changes: PullRequestChanges): Promise<void> {
    this.updatedPullRequests.push({ prNumber, changes });
    const pr = this.pr(prNumber);
    if (changes.title !== undefined) {
      pr.title = changes.title;
    }
    if (changes.body !== undefined) {
      pr.body = changes.body;
    }
    if (changes.state === 'closed' && pr.state === 'open') {
      pr.closedHeadSha = this.headSha(pr);
      pr.state = 'closed';
    }
    pr.updatedAt = this.clock++;
  }

  override async setLabels(issueNumber: number, labels: string[]): Promise<void> {
    this.setLabelsCalls.push({ issueNumber, labels });
    this.pr(issueNumber).labels = [...labels];
  }

  override async mergePullRequest(prNumber: number, method: MergeMethod, sha?: string): Promise<void> {
    this.mergeAs(prNumber, BOT, sha, method);
  }

  /** A merge by `actor`, through the API or the UI. Returns the merge commit. */
  mergeAs(prNumber: number, actor: Actor, sha?: string, method: MergeMethod = 'squash'): string {
    const pr = this.pr(prNumber);
    if (pr.state !== 'open') {
      throw Object.assign(new Error('Pull Request is not mergeable'), { status: 405 });
    }
    const head = this.headSha(pr);
    if (sha && head && sha !== head) {
      throw Object.assign(new Error('Head branch was modified. Review and try the merge again.'), { status: 409 });
    }
    if (method !== 'squash') {
      throw new Error(`The model only squash-merges, not '${method}'`);
    }
    const mergeCommitSha = this.remote.squashMerge(pr.head, pr.base, `${pr.title} (#${pr.number})`);
    this.mergedPullRequests.push({ prNumber, method, sha });
    Object.assign(pr, {
      state: 'closed',
      merged: true,
      mergedAt: new Date(Date.now() + this.clock).toISOString(),
      mergedBy: actor,
      mergeCommitSha,
      closedHeadSha: head,
      updatedAt: this.clock++,
    });
    return mergeCommitSha;
  }

  recordMergedFeeder(title: string, labels: string[], mergeCommitSha: string): PullRequest {
    const number = this.nextPrNumber++;
    const pr: PullRequest = {
      number,
      title,
      body: '',
      head: `feature/${number}`,
      base: 'main',
      labels,
      state: 'closed',
      merged: true,
      mergedAt: new Date().toISOString(),
      mergedBy: MAINTAINER,
      mergeCommitSha,
      closedHeadSha: mergeCommitSha,
      updatedAt: this.clock++,
    };
    this.prs.set(number, pr);
    return pr;
  }

  override async createComment(prNumber: number, body: string): Promise<void> {
    this.recordManifest(prNumber, body);
    await super.createComment(prNumber, body);
  }

  override async updateComment(commentId: number, body: string): Promise<void> {
    const comment = this.comments.find((c) => c.id === commentId);
    if (comment?.prNumber !== undefined) {
      this.recordManifest(comment.prNumber, body);
    }
    await super.updateComment(commentId, body);
  }

  override async upsertMarkerComment(prNumber: number, marker: string, body: string): Promise<void> {
    const hook = this.beforeManifestUpsert;
    if (marker === MANIFEST_MARKER && hook) {
      this.beforeManifestUpsert = undefined;
      await hook(prNumber);
    }
    await super.upsertMarkerComment(prNumber, marker, body);
  }

  private recordManifest(prNumber: number, body: string): void {
    if (body.startsWith(MANIFEST_MARKER)) {
      this.manifestWrites.push({ prNumber, body });
    }
  }
}
