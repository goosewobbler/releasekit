/**
 * Raised when a `git` invocation fails unexpectedly. Carries the full argv that was run, the exit
 * code, and stderr, so a caller (or a failure report) can show exactly what was attempted without the
 * adapter having to log. The argv is the array passed to `execFile` — never a shell string — so there
 * is nothing to un-escape and no shell interpolation to reconstruct.
 */
export class GitError extends Error {
  /** The argv that failed, e.g. `['tag', '-a', 'v1.0.0', '-m', 'release']`. */
  readonly args: string[];
  /** The process exit code, or undefined when git could not be spawned at all. */
  readonly exitCode: number | undefined;
  /** Captured stderr, trimmed; empty when none. */
  readonly stderr: string;

  constructor(message: string, args: string[], exitCode: number | undefined, stderr: string) {
    super(message);
    this.name = 'GitError';
    this.args = args;
    this.exitCode = exitCode;
    this.stderr = stderr;
  }
}

/**
 * The exit code carried by a Node `child_process` exec error, if any. `execFile`'s error sets `code`
 * to the process exit status (a number) for a non-zero exit, or to a string (e.g. `'ENOENT'`) when
 * the binary is missing — only the numeric form is a real exit code.
 */
export function gitExitCode(error: unknown): number | undefined {
  if (error && typeof error === 'object' && 'code' in error) {
    const { code } = error as { code?: unknown };
    if (typeof code === 'number') return code;
  }
  return undefined;
}

/**
 * Whether `error` means the `git` binary itself could not be found/spawned (ENOENT), as opposed to
 * git running and exiting non-zero. A missing binary must always surface — even from a "soft" lookup
 * that otherwise swallows a non-zero exit — because it is a configuration failure, not a "no" answer.
 */
export function isCommandNotFound(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const { code } = error as { code?: unknown };
  return code === 'ENOENT';
}

/**
 * Whether `error` is a timeout kill from `execFile`'s `timeout` option. Node kills the child with
 * `killed === true` and surfaces the signal that did it, so the push wrapper can distinguish a hung
 * push from an ordinary non-zero exit and report it as a timeout.
 */
export function isExecTimeout(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  return (error as { killed?: unknown }).killed === true;
}
