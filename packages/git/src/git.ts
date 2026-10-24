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
  GitLsFilesOptions,
  GitPushOptions,
  GitStatusOptions,
  GitTagOptions,
} from './types.js';

const DEFAULT_PUSH_TIMEOUT_MS = 120_000;

/** Git can emit a lot on a big `log`. */
const MAX_BUFFER = 1024 * 1024 * 10;

interface RunResult {
  stdout: string;
  stderr: string;
}

interface RunOptions {
  cwd: string;
  ignoreOutput?: boolean;
  /** In milliseconds. */
  timeout?: number;
}

/** Resolves stdout/stderr or rejects with the spawn/exit error. */
export type GitRunner = (args: string[], options: RunOptions) => Promise<RunResult>;

const execFileAsync = promisify(execFile);

const COMMIT_SHA = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;

/** A full SHA-1 or SHA-256 commit hash, as git prints it. */
export function isCommitSha(value: string): boolean {
  return COMMIT_SHA.test(value);
}

/**
 * No shell is involved, but git still parses a leading-`-` positional as a flag, so a remote of `--upload-pack=evil`
 * is argument injection (RCE). No legitimate ref/remote/branch/tag starts with `-`; refusing it before it reaches the
 * argv also clears CodeQL's second-order alert.
 */
function assertNotOption(value: string, kind: string): void {
  if (value.startsWith('-')) {
    throw new GitError(
      `Refusing to run git: ${kind} '${value}' looks like an option (starts with '-')`,
      [],
      undefined,
      '',
    );
  }
}

/** Ignores `ignoreOutput`: the promisified `execFile` always buffers stdio, bounded by `maxBuffer`. */
const defaultRunner: GitRunner = async (args, options) => {
  const { stdout, stderr } = await execFileAsync('git', args, {
    cwd: options.cwd,
    maxBuffer: MAX_BUFFER,
    timeout: options.timeout,
  });
  return { stdout: stdout.toString(), stderr: stderr.toString() };
};

/** Every git argument is a literal argv slot, never spliced into a shell command, so it can't reach a shell. */
export class GitCli implements Git {
  constructor(private readonly run: GitRunner = defaultRunner) {}

  private cwd(cwd?: string): string {
    return cwd ?? process.cwd();
  }

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

  /** A missing `git` binary still throws: that's a configuration failure, not a "no". */
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
    assertNotOption(remote, 'remote');
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
      return null;
    }
  }

  async listTags(opts: GitListTagsOptions = {}): Promise<string[]> {
    const args = ['tag'];
    if (opts.sort) {
      args.push(`--sort=${opts.sort}`);
    }
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
      return null;
    }
  }

  async refExists(ref: string, cwd?: string): Promise<boolean> {
    assertNotOption(ref, 'ref');
    return this.execSoft(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], {
      cwd: this.cwd(cwd),
      ignoreOutput: true,
    });
  }

  async isAncestor(ancestor: string, ref: string, cwd?: string): Promise<boolean> {
    assertNotOption(ancestor, 'ancestor');
    assertNotOption(ref, 'ref');
    return this.execSoft(['merge-base', '--is-ancestor', ancestor, ref], { cwd: this.cwd(cwd), ignoreOutput: true });
  }

  async mergeBase(a: string, b: string, cwd?: string): Promise<string | null> {
    assertNotOption(a, 'ref');
    assertNotOption(b, 'ref');
    try {
      const { stdout } = await this.run(['merge-base', a, b], { cwd: this.cwd(cwd) });
      return stdout.trim() || null;
    } catch (error) {
      if (isCommandNotFound(error)) {
        throw new GitError('git binary not found (running: git merge-base)', ['merge-base', a, b], undefined, '');
      }
      return null;
    }
  }

  async countCommits(range: string, opts: GitCountCommitsOptions = {}): Promise<number> {
    assertNotOption(range, 'range');
    const args = ['rev-list', '--count', range];
    if (opts.path) {
      args.push('--', opts.path);
    }
    const { stdout } = await this.exec(args, { cwd: this.cwd(opts.cwd) });
    return Number.parseInt(stdout.trim(), 10) || 0;
  }

  async log(opts: GitLogOptions): Promise<string> {
    if (opts.range !== undefined) {
      assertNotOption(opts.range, 'range');
    }
    const args = ['log'];
    if (opts.format !== undefined) {
      args.push(`--format=${opts.format}`);
    }
    if (opts.extraArgs) {
      args.push(...opts.extraArgs);
    }
    if (opts.range !== undefined) {
      args.push(opts.range);
    }
    if (opts.paths && opts.paths.length > 0) {
      args.push('--', ...opts.paths);
    }
    const { stdout } = await this.exec(args, { cwd: this.cwd(opts.cwd) });
    return stdout;
  }

  async diffTreeNames(commitSha: string, cwd?: string): Promise<string[]> {
    assertNotOption(commitSha, 'commit');
    const { stdout } = await this.exec(['diff-tree', '--no-commit-id', '--name-only', '-r', commitSha], {
      cwd: this.cwd(cwd),
    });
    return splitLines(stdout);
  }

  async lsFiles(opts: GitLsFilesOptions = {}): Promise<string[]> {
    const args = ['ls-files', '-z'];
    if (opts.paths && opts.paths.length > 0) {
      args.push('--', ...opts.paths);
    }
    const { stdout } = await this.exec(args, { cwd: this.cwd(opts.cwd) });
    return stdout.split('\0').filter((file) => file.length > 0);
  }

  async isIgnored(file: string, cwd?: string): Promise<boolean> {
    return this.execSoft(['check-ignore', '-q', '--', file], { cwd: this.cwd(cwd), ignoreOutput: true });
  }

  async forEachRef(opts: GitForEachRefOptions): Promise<string[]> {
    // `format`/`sort` are flag values, so only the positional `pattern` needs the guard.
    if (opts.pattern !== undefined) {
      assertNotOption(opts.pattern, 'pattern');
    }
    const args = ['for-each-ref', `--format=${opts.format}`];
    if (opts.sort) {
      args.push(`--sort=${opts.sort}`);
    }
    if (opts.pattern) {
      args.push(opts.pattern);
    }
    const { stdout } = await this.exec(args, { cwd: this.cwd(opts.cwd) });
    return splitLines(stdout);
  }

  async remoteBranchExists(remote: string, branch: string, cwd?: string): Promise<boolean> {
    assertNotOption(remote, 'remote');
    assertNotOption(branch, 'branch');
    // `--end-of-options` is belt-and-suspenders with assertNotOption.
    return this.execSoft(['ls-remote', '--exit-code', '--heads', '--end-of-options', remote, branch], {
      cwd: this.cwd(cwd),
      ignoreOutput: true,
    });
  }

  async hasStagedChanges(cwd?: string): Promise<boolean> {
    try {
      await this.exec(['diff', '--cached', '--quiet'], { cwd: this.cwd(cwd), ignoreOutput: true });
      return false;
    } catch (error) {
      if (error instanceof GitError && error.exitCode === 1) {
        return true;
      }
      throw error;
    }
  }

  async addAll(cwd?: string): Promise<void> {
    await this.exec(['add', '-A'], { cwd: this.cwd(cwd) });
  }

  async add(paths: string[], cwd?: string): Promise<void> {
    await this.exec(['add', '--', ...paths], { cwd: this.cwd(cwd) });
  }

  async commit(message: string, opts: GitCommitOptions = {}): Promise<void> {
    const args = ['commit', '-m', message];
    if (opts.skipHooks) {
      args.push('--no-verify');
    }
    if (opts.paths && opts.paths.length > 0) {
      args.push('--', ...opts.paths);
    }
    await this.exec(args, { cwd: this.cwd(opts.cwd) });
  }

  async tag(name: string, opts: GitTagOptions = {}): Promise<void> {
    assertNotOption(name, 'tag name');
    const args = opts.message !== undefined ? ['tag', '-a', name, '-m', opts.message] : ['tag', name];
    await this.exec(args, { cwd: this.cwd(opts.cwd) });
  }

  async fetch(remote: string, opts: GitFetchOptions = {}): Promise<void> {
    assertNotOption(remote, 'remote');
    await this.exec(['fetch', '--end-of-options', remote], { cwd: this.cwd(opts.cwd) });
  }

  async checkout(ref: string, opts: GitCheckoutOptions = {}): Promise<void> {
    assertNotOption(ref, 'ref');
    const args = opts.create ? ['checkout', '-B', ref] : ['checkout', ref];
    await this.exec(args, { cwd: this.cwd(opts.cwd) });
  }

  async resetHard(ref: string, cwd?: string): Promise<void> {
    assertNotOption(ref, 'ref');
    await this.exec(['reset', '--hard', ref], { cwd: this.cwd(cwd) });
  }

  async status(opts: GitStatusOptions = {}): Promise<string> {
    const args = ['status'];
    if (opts.porcelain) {
      args.push('--porcelain');
    }
    if (opts.paths && opts.paths.length > 0) {
      args.push('--', ...opts.paths);
    }
    const { stdout } = await this.exec(args, { cwd: this.cwd(opts.cwd) });
    return stdout;
  }

  async push(opts: GitPushOptions): Promise<void> {
    assertNotOption(opts.remote, 'remote');
    if (opts.ref !== undefined) {
      assertNotOption(opts.ref, 'ref');
    }
    const args = ['push'];
    if (opts.forceWithLease && typeof opts.forceWithLease === 'object') {
      const { ref, expect } = opts.forceWithLease;
      assertNotOption(ref, 'lease ref');
      // An empty or symbolic `expect` changes what git checks (an empty one means "only if absent").
      if (!isCommitSha(expect)) {
        throw new GitError(`Refusing to run git: lease expect '${expect}' is not a commit SHA`, [], undefined, '');
      }
      args.push(`--force-with-lease=${ref}:${expect}`);
    } else if (opts.forceWithLease) {
      args.push('--force-with-lease');
    } else if (opts.force) {
      args.push('--force');
    }
    if (opts.tags) {
      args.push('--tags');
    }
    args.push('--end-of-options', opts.remote);
    if (opts.ref !== undefined) {
      args.push(opts.ref);
    }
    await this.exec(args, { cwd: this.cwd(opts.cwd), timeout: opts.timeoutMs ?? DEFAULT_PUSH_TIMEOUT_MS });
  }
}

function splitLines(output: string): string[] {
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export function createGitCli(run?: GitRunner): Git {
  return new GitCli(run);
}
