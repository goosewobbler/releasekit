import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { GitError, gitExitCode, isCommandNotFound, isExecTimeout } from './errors.js';
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

/** Default ceiling for a push, mirroring the safety the publish package's exec wrapper provided. */
const DEFAULT_PUSH_TIMEOUT_MS = 120_000;

/** Git can emit a lot on a big `log`; match the publish exec wrapper's generous buffer. */
const MAX_BUFFER = 1024 * 1024 * 10;

/** Result of a single git invocation. */
interface RunResult {
  stdout: string;
  stderr: string;
}

/** Per-invocation options threaded to the underlying runner. */
interface RunOptions {
  cwd: string;
  /** Discard stdio when the output is irrelevant (the "soft" exit-code lookups). */
  ignoreOutput?: boolean;
  /** Hard timeout in milliseconds; on expiry the child is killed and the run rejects. */
  timeout?: number;
}

/**
 * The subprocess primitive the adapter depends on: run `git` with an **argument array** and resolve
 * its stdout/stderr, or reject with the spawn/exit error. Injectable so tests can supply a stand-in
 * without spawning a real process; the default is `execFile` bound to the `git` binary.
 */
export type GitRunner = (args: string[], options: RunOptions) => Promise<RunResult>;

const execFileAsync = promisify(execFile);

/**
 * The default {@link GitRunner}: `execFile('git', args)` — an argv array, so no shell, no
 * interpolation. `ignoreOutput` is part of the runner contract (it lets a custom runner discard
 * stdio for the soft exit-code lookups), but the promisified `execFile` always buffers stdout/stderr
 * — bounded by `maxBuffer` — so here we simply ignore the captured output by not reading it.
 */
const defaultRunner: GitRunner = async (args, options) => {
  const { stdout, stderr } = await execFileAsync('git', args, {
    cwd: options.cwd,
    maxBuffer: MAX_BUFFER,
    timeout: options.timeout,
  });
  return { stdout: stdout.toString(), stderr: stderr.toString() };
};

/**
 * Subprocess-backed {@link Git}. Every method builds an argv array and hands it to the runner — a git
 * argument is therefore a literal argv slot, never text spliced into a shell command, so a malicious
 * tag/branch/message can't break out into shell execution (the security smell this seam removes).
 *
 * The runner is injected (default: `execFile('git', …)`), so tests assert on the exact argv without
 * spawning git.
 */
export class GitCli implements Git {
  constructor(private readonly run: GitRunner = defaultRunner) {}

  private cwd(cwd?: string): string {
    return cwd ?? process.cwd();
  }

  /** Run git, wrapping any failure in a {@link GitError} that carries the argv, exit code, and stderr. */
  private async exec(args: string[], options: RunOptions): Promise<RunResult> {
    try {
      return await this.run(args, options);
    } catch (error) {
      if (isExecTimeout(error)) {
        throw new GitError(`git ${args.join(' ')} timed out after ${options.timeout}ms`, args, undefined, '');
      }
      const stderr = (error as { stderr?: unknown }).stderr;
      const stderrText = typeof stderr === 'string' ? stderr.trim() : (stderr?.toString().trim() ?? '');
      const detail = stderrText || (error instanceof Error ? error.message : String(error));
      throw new GitError(`git ${args.join(' ')} failed: ${detail}`, args, gitExitCode(error), stderrText);
    }
  }

  /**
   * Run a "soft" lookup whose non-zero exit is an expected answer (false/absent), not an error.
   * Returns true on a clean exit, false on a non-zero exit — but a missing `git` binary (ENOENT)
   * still throws, because that's a configuration failure, not a "no".
   */
  private async execSoft(args: string[], options: RunOptions): Promise<boolean> {
    try {
      await this.run(args, options);
      return true;
    } catch (error) {
      if (isCommandNotFound(error)) {
        throw new GitError(`git binary not found (running: git ${args.join(' ')})`, args, undefined, '');
      }
      return false;
    }
  }

  // — Queries —

  async isRepository(cwd?: string): Promise<boolean> {
    return this.execSoft(['rev-parse', '--is-inside-work-tree'], { cwd: this.cwd(cwd), ignoreOutput: true });
  }

  async currentBranch(cwd?: string): Promise<string> {
    const { stdout } = await this.exec(['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: this.cwd(cwd) });
    return stdout.trim();
  }

  async headSha(cwd?: string): Promise<string> {
    const { stdout } = await this.exec(['rev-parse', 'HEAD'], { cwd: this.cwd(cwd) });
    return stdout.trim();
  }

  async remoteUrl(remote: string, cwd?: string): Promise<string | null> {
    try {
      const { stdout } = await this.run(['remote', 'get-url', remote], { cwd: this.cwd(cwd) });
      return stdout.trim();
    } catch (error) {
      if (isCommandNotFound(error)) {
        throw new GitError(
          'git binary not found (running: git remote get-url)',
          ['remote', 'get-url', remote],
          undefined,
          '',
        );
      }
      // Non-zero exit (e.g. "No such remote") → the remote is simply absent.
      return null;
    }
  }

  async listTags(opts: GitListTagsOptions = {}): Promise<string[]> {
    const args = ['tag'];
    if (opts.sort) args.push(`--sort=${opts.sort}`);
    const { stdout } = await this.exec(args, { cwd: this.cwd(opts.cwd) });
    return splitLines(stdout);
  }

  async describeTags(cwd?: string): Promise<string | null> {
    try {
      const { stdout } = await this.run(['describe', '--tags', '--abbrev=0'], { cwd: this.cwd(cwd) });
      return stdout.trim();
    } catch (error) {
      if (isCommandNotFound(error)) {
        throw new GitError(
          'git binary not found (running: git describe)',
          ['describe', '--tags', '--abbrev=0'],
          undefined,
          '',
        );
      }
      // Non-zero exit means "no names found, cannot describe anything" → no reachable tag.
      return null;
    }
  }

  async refExists(ref: string, cwd?: string): Promise<boolean> {
    return this.execSoft(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], {
      cwd: this.cwd(cwd),
      ignoreOutput: true,
    });
  }

  async isAncestor(ancestor: string, ref: string, cwd?: string): Promise<boolean> {
    return this.execSoft(['merge-base', '--is-ancestor', ancestor, ref], { cwd: this.cwd(cwd), ignoreOutput: true });
  }

  async countCommits(range: string, opts: GitCountCommitsOptions = {}): Promise<number> {
    const args = ['rev-list', '--count', range];
    if (opts.path) args.push('--', opts.path);
    const { stdout } = await this.exec(args, { cwd: this.cwd(opts.cwd) });
    return Number.parseInt(stdout.trim(), 10) || 0;
  }

  async log(opts: GitLogOptions): Promise<string> {
    const args = ['log'];
    if (opts.format !== undefined) args.push(`--format=${opts.format}`);
    if (opts.extraArgs) args.push(...opts.extraArgs);
    if (opts.range !== undefined) args.push(opts.range);
    if (opts.paths && opts.paths.length > 0) args.push('--', ...opts.paths);
    const { stdout } = await this.exec(args, { cwd: this.cwd(opts.cwd) });
    return stdout;
  }

  async diffTreeNames(commitSha: string, cwd?: string): Promise<string[]> {
    const { stdout } = await this.exec(['diff-tree', '--no-commit-id', '--name-only', '-r', commitSha], {
      cwd: this.cwd(cwd),
    });
    return splitLines(stdout);
  }

  async forEachRef(opts: GitForEachRefOptions): Promise<string[]> {
    const args = ['for-each-ref', `--format=${opts.format}`];
    if (opts.sort) args.push(`--sort=${opts.sort}`);
    if (opts.pattern) args.push(opts.pattern);
    const { stdout } = await this.exec(args, { cwd: this.cwd(opts.cwd) });
    return splitLines(stdout);
  }

  async remoteBranchExists(remote: string, branch: string, cwd?: string): Promise<boolean> {
    return this.execSoft(['ls-remote', '--exit-code', '--heads', remote, branch], {
      cwd: this.cwd(cwd),
      ignoreOutput: true,
    });
  }

  // — Mutations —

  async add(paths: string[], cwd?: string): Promise<void> {
    // `add -A` is its own flag form; everything else is an explicit pathspec list after `--`.
    const args = paths.length === 1 && paths[0] === '-A' ? ['add', '-A'] : ['add', '--', ...paths];
    await this.exec(args, { cwd: this.cwd(cwd) });
  }

  async commit(message: string, opts: GitCommitOptions = {}): Promise<void> {
    const args = ['commit', '-m', message];
    if (opts.skipHooks) args.push('--no-verify');
    if (opts.paths && opts.paths.length > 0) args.push('--', ...opts.paths);
    await this.exec(args, { cwd: this.cwd(opts.cwd) });
  }

  async tag(name: string, opts: GitTagOptions = {}): Promise<void> {
    const args = opts.message !== undefined ? ['tag', '-a', name, '-m', opts.message] : ['tag', name];
    await this.exec(args, { cwd: this.cwd(opts.cwd) });
  }

  async fetch(remote: string, opts: GitFetchOptions = {}): Promise<void> {
    await this.exec(['fetch', remote], { cwd: this.cwd(opts.cwd) });
  }

  async checkout(ref: string, opts: GitCheckoutOptions = {}): Promise<void> {
    const args = opts.create ? ['checkout', '-B', ref] : ['checkout', ref];
    await this.exec(args, { cwd: this.cwd(opts.cwd) });
  }

  async resetHard(ref: string, cwd?: string): Promise<void> {
    await this.exec(['reset', '--hard', ref], { cwd: this.cwd(cwd) });
  }

  async status(opts: GitStatusOptions = {}): Promise<string> {
    const args = ['status'];
    if (opts.porcelain) args.push('--porcelain');
    if (opts.paths && opts.paths.length > 0) args.push('--', ...opts.paths);
    const { stdout } = await this.exec(args, { cwd: this.cwd(opts.cwd) });
    return stdout;
  }

  async push(opts: GitPushOptions): Promise<void> {
    const args = ['push'];
    if (opts.forceWithLease) args.push('--force-with-lease');
    else if (opts.force) args.push('--force');
    if (opts.tags) args.push('--tags');
    args.push(opts.remote);
    if (opts.ref !== undefined) args.push(opts.ref);
    // A push can hang on a stalled network forever; a hard timeout preserves the safety the publish
    // package previously got from its async exec wrapper. execFile kills the child on expiry.
    await this.exec(args, { cwd: this.cwd(opts.cwd), timeout: opts.timeoutMs ?? DEFAULT_PUSH_TIMEOUT_MS });
  }
}

/** Trim, split on newlines, and drop empties — the shape git's multi-line list outputs need. */
function splitLines(output: string): string[] {
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/** Construct a subprocess-backed {@link Git}. Pass a custom runner to redirect away from `execFile`. */
export function createGitCli(run?: GitRunner): Git {
  return new GitCli(run);
}
