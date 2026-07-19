/**
 * Mask the `user:password@` userinfo of any URL embedded in a string, e.g.
 * `https://x-access-token:<token>@github.com/o/r` → `https://***@github.com/o/r`. A push/fetch remote
 * can be an authenticated HTTPS URL, and git also echoes that URL in its own stderr on an auth/ref
 * failure — so the token would otherwise ride the failed argv and stderr into logs and the
 * failure-report PR comment. Anchors on the literal `://` and matches the userinfo with a negated
 * class terminated by the excluded `@`, so there is no ambiguous prefix to backtrack on (linear —
 * avoids the polynomial-regex ReDoS a `scheme` prefix like `[a-z]+://` would introduce).
 */
export function redactUrlCredentials(text: string): string {
  return text.replace(/:\/\/[^/@\s]+@/g, '://***@');
}

/**
 * Raised when a `git` invocation fails unexpectedly. Carries the full argv that was run, the exit
 * code, and stderr, so a caller (or a failure report) can show exactly what was attempted without the
 * adapter having to log. The argv is the array passed to `execFile` — never a shell string — so there
 * is nothing to un-escape and no shell interpolation to reconstruct. Credentials are the one thing an
 * argv *can* carry (an authenticated remote URL), so `message`, `args`, and `stderr` are run through
 * {@link redactUrlCredentials} here — every construction site is covered without each caller having to
 * remember. The array handed to the runner is untouched (this stores a redacted copy), so the real
 * push still uses the real URL.
 */
export class GitError extends Error {
  /** The argv that failed, e.g. `['tag', '-a', 'v1.0.0', '-m', 'release']`; URL userinfo redacted. */
  readonly args: string[];
  /** The process exit code, or undefined when git could not be spawned at all. */
  readonly exitCode: number | undefined;
  /** Captured stderr, trimmed; empty when none; URL userinfo redacted. */
  readonly stderr: string;

  constructor(message: string, args: string[], exitCode: number | undefined, stderr: string) {
    super(redactUrlCredentials(message));
    this.name = 'GitError';
    this.args = args.map(redactUrlCredentials);
    this.exitCode = exitCode;
    this.stderr = redactUrlCredentials(stderr);
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
