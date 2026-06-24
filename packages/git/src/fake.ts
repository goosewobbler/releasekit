import type {
  Git,
  GitCheckoutOptions,
  GitCommitOptions,
  GitCountCommitsOptions,
  GitFetchOptions,
  GitForEachRefOptions,
  GitListTagsOptions,
  GitLogOptions,
  GitPushOptions,
  GitStatusOptions,
  GitTagOptions,
} from './types.js';

/** A recorded commit. */
export interface FakeCommitRecord {
  message: string;
  paths?: string[];
  skipHooks?: boolean;
}

/** A recorded tag. */
export interface FakeTagRecord {
  name: string;
  message?: string;
}

/** A recorded push. */
export interface FakePushRecord {
  remote: string;
  ref?: string;
  force?: boolean;
  forceWithLease?: boolean;
  tags?: boolean;
}

/** A seeded `git log` response, matched against the requested range (or `'*'` as a catch-all). */
export type FakeLog = Record<string, string>;

/**
 * Seed state for a {@link FakeGit}. Everything is optional; unseeded reads return empty/false/null so
 * a consumer can be driven end-to-end without spawning git.
 */
export interface FakeGitSeed {
  /** Whether the directory is a git repo (`isRepository`). Defaults to true. */
  isRepo?: boolean;
  /** Tag names returned by `listTags` (in seeded order). */
  tags?: string[];
  /** The "nearest reachable tag" returned by `describeTags`. `null` (or omitted) → no tag. */
  nearestTag?: string | null;
  /** The SHA returned by `headSha`. */
  headSha?: string;
  /** The branch returned by `currentBranch`. */
  currentBranch?: string;
  /** Remote URLs by remote name (`remoteUrl`). Unseeded remotes resolve to null. */
  remoteUrls?: Record<string, string>;
  /** Refs that `refExists` reports present. */
  existingRefs?: string[];
  /**
   * Ancestry for `isAncestor`. A record maps a `ref` to the list of refs it has as ancestors, OR a
   * predicate `(ancestor, ref) => boolean` for finer control. Unseeded → false.
   */
  ancestors?: Record<string, string[]> | ((ancestor: string, ref: string) => boolean);
  /** Branches present on each remote (`remoteBranchExists`), keyed by remote name. */
  remoteBranches?: Record<string, string[]>;
  /** `git log` responses keyed by range; `'*'` is a catch-all when no range matches. */
  commits?: FakeLog;
  /** Changed paths per commit SHA (`diffTreeNames`). Unseeded SHAs return empty. */
  diffNames?: Record<string, string[]>;
  /** Lines returned by `forEachRef` (the seam is format-agnostic, so callers seed final lines). */
  refLines?: string[];
  /** Commit counts per range (`countCommits`). Unseeded ranges return 0. */
  commitCounts?: Record<string, number>;
  /** Working-tree status text returned by `status`. Defaults to empty (clean). */
  status?: string;
}

function ancestryHas(ancestors: FakeGitSeed['ancestors'], ancestor: string, ref: string): boolean {
  if (!ancestors) return false;
  if (typeof ancestors === 'function') return ancestors(ancestor, ref);
  return (ancestors[ref] ?? []).includes(ancestor);
}

/**
 * In-memory {@link Git} for tests — the second adapter that justifies the seam. Queries return seeded
 * data; mutations record their calls on public readonly arrays for assertions (and keep the in-memory
 * view consistent enough to re-query, e.g. a tagged name shows up in `listTags`).
 */
export class FakeGit implements Git {
  private readonly isRepo: boolean;
  private readonly tagsList: string[];
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

  // Recorded mutations, for assertions.
  readonly added: string[][] = [];
  readonly committed: FakeCommitRecord[] = [];
  readonly tagged: FakeTagRecord[] = [];
  readonly fetched: string[] = [];
  readonly checkedOut: string[] = [];
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
  }

  // — Queries —

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

  async forEachRef(_opts: GitForEachRefOptions): Promise<string[]> {
    return [...this.refLines];
  }

  async remoteBranchExists(remote: string, branch: string, _cwd?: string): Promise<boolean> {
    return (this.remoteBranches[remote] ?? []).includes(branch);
  }

  // — Mutations —

  async add(paths: string[], _cwd?: string): Promise<void> {
    this.added.push([...paths]);
  }

  async commit(message: string, opts: GitCommitOptions = {}): Promise<void> {
    this.committed.push({ message, paths: opts.paths, skipHooks: opts.skipHooks });
  }

  async tag(name: string, opts: GitTagOptions = {}): Promise<void> {
    this.tagged.push({ name, message: opts.message });
    if (!this.tagsList.includes(name)) this.tagsList.push(name);
  }

  async fetch(remote: string, _opts: GitFetchOptions = {}): Promise<void> {
    this.fetched.push(remote);
  }

  async checkout(ref: string, _opts: GitCheckoutOptions = {}): Promise<void> {
    this.checkedOut.push(ref);
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

/** Convenience factory mirroring {@link createGitCli}. */
export function createFakeGit(seed: FakeGitSeed = {}): FakeGit {
  return new FakeGit(seed);
}
