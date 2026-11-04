export interface GitLogOptions {
  range?: string;
  format?: string;
  paths?: string[];
  /** Raw arguments inserted before the range. */
  extraArgs?: string[];
  cwd?: string;
}

export interface GitPushOptions {
  remote: string;
  /** A ref or refspec, e.g. `HEAD:release/next`. */
  ref?: string;
  force?: boolean;
  /** With a lease, the push only succeeds while the remote `ref` is still at `expect`. */
  forceWithLease?: boolean | GitPushLease;
  tags?: boolean;
  cwd?: string;
  timeoutMs?: number;
}

export interface GitPushLease {
  ref: string;
  expect: string;
}

export interface GitCommitOptions {
  cwd?: string;
  paths?: string[];
  skipHooks?: boolean;
}

export interface GitTagOptions {
  /** Makes the tag annotated; omitted, the tag is lightweight. */
  message?: string;
  cwd?: string;
}

export interface GitFetchOptions {
  cwd?: string;
}

export interface GitCheckoutOptions {
  /** `-B`: creates or resets the branch. */
  create?: boolean;
  cwd?: string;
}

export interface GitListTagsOptions {
  sort?: string;
  cwd?: string;
}

export interface GitCountCommitsOptions {
  path?: string;
  cwd?: string;
}

export interface GitForEachRefOptions {
  format: string;
  sort?: string;
  pattern?: string;
  cwd?: string;
}

export interface GitLsFilesOptions {
  /** Pathspec magic such as `:(top,glob)` is allowed. */
  paths?: string[];
  cwd?: string;
}

export interface GitStatusOptions {
  porcelain?: boolean;
  paths?: string[];
  cwd?: string;
}

/**
 * Methods take/return plain data, never `child_process` types, so the seam stays swappable.
 *
 * "Soft" lookups (`isRepository`, `remoteUrl`, `describeTags`, `refExists`, `isAncestor`, `remoteBranchExists`) treat a
 * non-zero git exit as the answer (false/null), not an error; they only throw a {@link GitError} when git itself is
 * missing or fails unexpectedly. Everything else throws a {@link GitError} on failure.
 */
export interface Git {
  isRepository(cwd?: string): Promise<boolean>;
  currentBranch(cwd?: string): Promise<string>;
  headSha(cwd?: string): Promise<string>;
  remoteUrl(remote: string, cwd?: string): Promise<string | null>;
  listTags(opts?: GitListTagsOptions): Promise<string[]>;
  /** The most recent reachable tag (`describe --tags --abbrev=0`). */
  describeTags(cwd?: string): Promise<string | null>;
  /** Whether `ref` resolves to a commit. */
  refExists(ref: string, cwd?: string): Promise<boolean>;
  isAncestor(ancestor: string, ref: string, cwd?: string): Promise<boolean>;
  countCommits(range: string, opts?: GitCountCommitsOptions): Promise<number>;
  log(opts: GitLogOptions): Promise<string>;
  /** File paths changed by `commitSha`. */
  diffTreeNames(commitSha: string, cwd?: string): Promise<string[]>;
  /** Relative to `cwd`, as git prints them. */
  lsFiles(opts?: GitLsFilesOptions): Promise<string[]>;
  /** False for a tracked file, and on failure (e.g. outside a repository). */
  isIgnored(file: string, cwd?: string): Promise<boolean>;
  forEachRef(opts: GitForEachRefOptions): Promise<string[]>;
  remoteBranchExists(remote: string, branch: string, cwd?: string): Promise<boolean>;
  hasStagedChanges(cwd?: string): Promise<boolean>;

  /** To stage everything, use {@link Git.addAll}. */
  add(paths: string[], cwd?: string): Promise<void>;
  addAll(cwd?: string): Promise<void>;
  commit(message: string, opts?: GitCommitOptions): Promise<void>;
  tag(name: string, opts?: GitTagOptions): Promise<void>;
  fetch(remote: string, opts?: GitFetchOptions): Promise<void>;
  checkout(ref: string, opts?: GitCheckoutOptions): Promise<void>;
  resetHard(ref: string, cwd?: string): Promise<void>;
  status(opts?: GitStatusOptions): Promise<string>;
  push(opts: GitPushOptions): Promise<void>;
}
