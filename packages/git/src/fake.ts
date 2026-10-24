import type {
  Git,
  GitCheckoutOptions,
  GitCommitOptions,
  GitCountCommitsOptions,
  GitFetchOptions,
  GitForEachRefOptions,
  GitListTagsOptions,
  GitLogOptions,
  GitLsFilesOptions,
  GitPushOptions,
  GitStatusOptions,
  GitTagOptions,
} from './types.js';

export interface FakeCommitRecord {
  message: string;
  paths?: string[];
  skipHooks?: boolean;
}

export interface FakeTagRecord {
  name: string;
  message?: string;
}

export interface FakePushRecord {
  remote: string;
  ref?: string;
  force?: boolean;
  forceWithLease?: GitPushOptions['forceWithLease'];
  tags?: boolean;
}

export type FakeLog = Record<string, string>;

export interface FakeGitSeed {
  isRepo?: boolean;
  /** Returned by `listTags` in seeded order. */
  tags?: string[];
  nearestTag?: string | null;
  headSha?: string;
  currentBranch?: string;
  remoteUrls?: Record<string, string>;
  existingRefs?: string[];
  /** A record maps a `ref` to its ancestors. */
  ancestors?: Record<string, string[]> | ((ancestor: string, ref: string) => boolean);
  remoteBranches?: Record<string, string[]>;
  /** `git log` responses keyed by range; `'*'` is a catch-all when no range matches. */
  commits?: FakeLog;
  diffNames?: Record<string, string[]>;
  /** Returned by `forEachRef` as-is; `format` is ignored, so seed final lines. */
  refLines?: string[];
  commitCounts?: Record<string, number>;
  status?: string;
  /** Defaults to true. */
  stagedChanges?: boolean;
}

function ancestryHas(ancestors: FakeGitSeed['ancestors'], ancestor: string, ref: string): boolean {
  if (!ancestors) {
    return false;
  }
  if (typeof ancestors === 'function') {
    return ancestors(ancestor, ref);
  }
  return (ancestors[ref] ?? []).includes(ancestor);
}

export class FakeGit implements Git {
  private readonly isRepo: boolean;
  private tagsList: string[];
  private readonly nearestTag: string | null;
  private readonly head: string;
  private readonly branch: string;
  private readonly remoteUrls: Record<string, string>;
  private readonly existingRefs: Set<string>;
  private readonly ancestors: FakeGitSeed['ancestors'];
  private readonly remoteBranches: Record<string, string[]>;
  private readonly commits: FakeLog;
  private readonly diffNames: Record<string, string[]>;
  private readonly refLines: string[];
  private readonly commitCounts: Record<string, number>;
  private statusText: string;
  private readonly stagedChanges: boolean;

  // Recorded mutations, for assertions.
  readonly added: string[][] = [];
  addedAll = 0;
  readonly committed: FakeCommitRecord[] = [];
  readonly tagged: FakeTagRecord[] = [];
  readonly fetched: string[] = [];
  readonly checkedOut: Array<{ ref: string; create: boolean }> = [];
  readonly resetTo: string[] = [];
  readonly pushed: FakePushRecord[] = [];

  constructor(seed: FakeGitSeed = {}) {
    this.isRepo = seed.isRepo ?? true;
    this.tagsList = [...(seed.tags ?? [])];
    this.nearestTag = seed.nearestTag ?? null;
    this.head = seed.headSha ?? '0000000000000000000000000000000000000000';
    this.branch = seed.currentBranch ?? 'main';
    this.remoteUrls = seed.remoteUrls ?? {};
    this.existingRefs = new Set(seed.existingRefs ?? []);
    this.ancestors = seed.ancestors;
    this.remoteBranches = seed.remoteBranches ?? {};
    this.commits = seed.commits ?? {};
    this.diffNames = seed.diffNames ?? {};
    this.refLines = [...(seed.refLines ?? [])];
    this.commitCounts = seed.commitCounts ?? {};
    this.statusText = seed.status ?? '';
    this.stagedChanges = seed.stagedChanges ?? true;
  }

  async isRepository(_cwd?: string): Promise<boolean> {
    return this.isRepo;
  }

  async currentBranch(_cwd?: string): Promise<string> {
    return this.branch;
  }

  async headSha(_cwd?: string): Promise<string> {
    return this.head;
  }

  async remoteUrl(remote: string, _cwd?: string): Promise<string | null> {
    return this.remoteUrls[remote] ?? null;
  }

  async listTags(_opts: GitListTagsOptions = {}): Promise<string[]> {
    return [...this.tagsList];
  }

  /**
   * Unlike `listTags`, doesn't see tags created via `tag()`: the nearest reachable tag is a reachability fact the fake
   * can't derive, so seed `nearestTag` explicitly.
   */
  async describeTags(_cwd?: string): Promise<string | null> {
    return this.nearestTag;
  }

  async refExists(ref: string, _cwd?: string): Promise<boolean> {
    return this.existingRefs.has(ref);
  }

  async isAncestor(ancestor: string, ref: string, _cwd?: string): Promise<boolean> {
    return ancestryHas(this.ancestors, ancestor, ref);
  }

  async countCommits(range: string, _opts: GitCountCommitsOptions = {}): Promise<number> {
    return this.commitCounts[range] ?? 0;
  }

  async log(opts: GitLogOptions): Promise<string> {
    const key = opts.range ?? '*';
    return this.commits[key] ?? this.commits['*'] ?? '';
  }

  async diffTreeNames(commitSha: string, _cwd?: string): Promise<string[]> {
    return [...(this.diffNames[commitSha] ?? [])];
  }

  async lsFiles(_opts: GitLsFilesOptions = {}): Promise<string[]> {
    return [];
  }

  async isIgnored(_file: string, _cwd?: string): Promise<boolean> {
    return false;
  }

  async forEachRef(_opts: GitForEachRefOptions): Promise<string[]> {
    return [...this.refLines];
  }

  async remoteBranchExists(remote: string, branch: string, _cwd?: string): Promise<boolean> {
    return (this.remoteBranches[remote] ?? []).includes(branch);
  }

  async hasStagedChanges(_cwd?: string): Promise<boolean> {
    return this.stagedChanges;
  }

  async addAll(_cwd?: string): Promise<void> {
    this.addedAll += 1;
  }

  async add(paths: string[], _cwd?: string): Promise<void> {
    this.added.push([...paths]);
  }

  async commit(message: string, opts: GitCommitOptions = {}): Promise<void> {
    this.committed.push({ message, paths: opts.paths, skipHooks: opts.skipHooks });
  }

  async tag(name: string, opts: GitTagOptions = {}): Promise<void> {
    this.tagged.push({ name, message: opts.message });
    if (!this.tagsList.includes(name)) {
      this.tagsList.push(name);
    }
  }

  async fetch(remote: string, _opts: GitFetchOptions = {}): Promise<void> {
    this.fetched.push(remote);
  }

  async checkout(ref: string, opts: GitCheckoutOptions = {}): Promise<void> {
    this.checkedOut.push({ ref, create: opts.create ?? false });
  }

  async resetHard(ref: string, _cwd?: string): Promise<void> {
    this.resetTo.push(ref);
  }

  async status(_opts: GitStatusOptions = {}): Promise<string> {
    return this.statusText;
  }

  async push(opts: GitPushOptions): Promise<void> {
    this.pushed.push({
      remote: opts.remote,
      ref: opts.ref,
      force: opts.force,
      forceWithLease: opts.forceWithLease,
      tags: opts.tags,
    });
  }
}

export function createFakeGit(seed: FakeGitSeed = {}): FakeGit {
  return new FakeGit(seed);
}
