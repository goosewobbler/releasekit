/**
 * `Git` — the local repository's git operations (queries over history/refs, and mutations like
 * commit/tag/push), behind one execution seam.
 *
 * The single real adapter (`GitCli`) shells out to the `git` binary via `node:child_process`'s
 * `execFile` with an **argument array** — never a shell-interpolated string — so a tag name, branch,
 * or message containing shell metacharacters can never be re-interpreted by a shell. The in-memory
 * fake (`FakeGit`) stands in for the binary in tests so consumers can be exercised end-to-end without
 * spawning git. Methods take/return plain data — they never leak `child_process` types — so the seam
 * stays swappable.
 *
 * Conventions:
 * - Every method is async and takes an optional `cwd` (default `process.cwd()`).
 * - "Soft" lookups (`isRepository`, `remoteUrl`, `describeTags`, `refExists`, `isAncestor`,
 *   `remoteBranchExists`) treat a non-zero git exit as the answer (false/null), not an error; they
 *   only throw a {@link GitError} when git itself is missing or fails unexpectedly.
 * - Everything else throws a {@link GitError} on failure, carrying the failed argv, exit code, and
 *   stderr.
 */

/** Options for {@link Git.log}. */
export interface GitLogOptions {
  /** A commit range, e.g. `v1.0.0..HEAD`. Omit for the full history. */
  range?: string;
  /** A `--format=<format>` / `--pretty=format:` string. */
  format?: string;
  /** Restrict to commits touching these paths (passed after `--`). */
  paths?: string[];
  /** Extra raw arguments inserted before the range (e.g. `--no-merges`, `-n`, `20`). */
  extraArgs?: string[];
  cwd?: string;
}

/** Options for {@link Git.push}. */
export interface GitPushOptions {
  remote: string;
  /** The ref(spec) to push, e.g. `HEAD:release/next` or a tag name. */
  ref?: string;
  force?: boolean;
  forceWithLease?: boolean;
  /** Push tags (`--tags`). */
  tags?: boolean;
  cwd?: string;
  /** Hard ceiling for the push in milliseconds; a hung push is killed and surfaced as a timeout. */
  timeoutMs?: number;
}

/** Options for {@link Git.commit}. */
export interface GitCommitOptions {
  cwd?: string;
  /** Limit the commit to these pathspecs (passed after `--`). */
  paths?: string[];
  /** Pass `--no-verify` to skip pre-commit / commit-msg hooks. */
  skipHooks?: boolean;
}

/** Options for {@link Git.tag}. */
export interface GitTagOptions {
  /** When set, create an annotated tag (`-a -m <message>`); otherwise a lightweight tag. */
  message?: string;
  cwd?: string;
}

/** Options for {@link Git.fetch}. */
export interface GitFetchOptions {
  cwd?: string;
}

/** Options for {@link Git.checkout}. */
export interface GitCheckoutOptions {
  /** Create (or reset) the branch with `-B`. */
  create?: boolean;
  cwd?: string;
}

/** Options for {@link Git.listTags}. */
export interface GitListTagsOptions {
  /** A `--sort=<key>` value, e.g. `-creatordate` or `version:refname`. */
  sort?: string;
  cwd?: string;
}

/** Options for {@link Git.countCommits}. */
export interface GitCountCommitsOptions {
  /** Restrict the count to commits touching this path (passed after `--`). */
  path?: string;
  cwd?: string;
}

/** Options for {@link Git.forEachRef}. */
export interface GitForEachRefOptions {
  /** A `--format=<format>` string. */
  format: string;
  /** A `--sort=<key>` value. */
  sort?: string;
  /** A ref pattern to match, e.g. `refs/tags/v*`. */
  pattern?: string;
  cwd?: string;
}

/** Options for {@link Git.status}. */
export interface GitStatusOptions {
  /** Use `--porcelain` machine-readable output. */
  porcelain?: boolean;
  /** Restrict to these pathspecs (passed after `--`). */
  paths?: string[];
  cwd?: string;
}

export interface Git {
  // — Queries —
  /** Whether `cwd` is inside a git work tree (`rev-parse --is-inside-work-tree`); false on failure. */
  isRepository(cwd?: string): Promise<boolean>;
  /** The current branch name (`rev-parse --abbrev-ref HEAD`). */
  currentBranch(cwd?: string): Promise<string>;
  /** The full SHA of `HEAD` (`rev-parse HEAD`). */
  headSha(cwd?: string): Promise<string>;
  /** The configured URL of `remote` (`remote get-url`), or null when the remote is absent. */
  remoteUrl(remote: string, cwd?: string): Promise<string | null>;
  /** All tag names (`tag`), optionally sorted by `sort` (`--sort=<sort>`). */
  listTags(opts?: GitListTagsOptions): Promise<string[]>;
  /** The most recent reachable tag (`describe --tags --abbrev=0`), or null when there is none. */
  describeTags(cwd?: string): Promise<string | null>;
  /** Whether `ref` resolves to a commit (`rev-parse --verify --quiet <ref>^{commit}`). */
  refExists(ref: string, cwd?: string): Promise<boolean>;
  /** Whether `ancestor` is an ancestor of `ref` (`merge-base --is-ancestor`). */
  isAncestor(ancestor: string, ref: string, cwd?: string): Promise<boolean>;
  /** Number of commits in `range` (`rev-list --count`), optionally restricted to a path. */
  countCommits(range: string, opts?: GitCountCommitsOptions): Promise<number>;
  /** Raw `git log` output for the given range/format/paths. */
  log(opts: GitLogOptions): Promise<string>;
  /** File paths changed by `commitSha` (`diff-tree --no-commit-id --name-only -r`). */
  diffTreeNames(commitSha: string, cwd?: string): Promise<string[]>;
  /** One formatted line per matching ref (`for-each-ref`), empties dropped. */
  forEachRef(opts: GitForEachRefOptions): Promise<string[]>;
  /** Whether `branch` exists on `remote` (`ls-remote --exit-code --heads`). */
  remoteBranchExists(remote: string, branch: string, cwd?: string): Promise<boolean>;

  // — Mutations —
  /** Stage the given pathspecs (`add -- <paths>`). To stage everything, use {@link Git.addAll}. */
  add(paths: string[], cwd?: string): Promise<void>;
  /** Stage every change in the work tree (`add -A`). */
  addAll(cwd?: string): Promise<void>;
  /** Create a commit with `message` (`commit -m`), optionally scoped to paths / skipping hooks. */
  commit(message: string, opts?: GitCommitOptions): Promise<void>;
  /** Create a tag `name` — annotated when `message` is given (`tag -a -m`), else lightweight. */
  tag(name: string, opts?: GitTagOptions): Promise<void>;
  /** Fetch from `remote` (`fetch`). */
  fetch(remote: string, opts?: GitFetchOptions): Promise<void>;
  /** Check out `ref` (`checkout`); with `create`, create/reset the branch (`checkout -B`). */
  checkout(ref: string, opts?: GitCheckoutOptions): Promise<void>;
  /** Hard-reset the work tree to `ref` (`reset --hard`). */
  resetHard(ref: string, cwd?: string): Promise<void>;
  /** Working-tree status (`status`), optionally porcelain and/or scoped to paths. */
  status(opts?: GitStatusOptions): Promise<string>;
  /** Push to a remote (`push`); supports force / force-with-lease / tags and a hard timeout. */
  push(opts: GitPushOptions): Promise<void>;
}
