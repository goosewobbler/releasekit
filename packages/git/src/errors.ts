export function redactUrlCredentials(text: string): string {
  // Anchors on `://` rather than a scheme prefix like `[a-z]+://`, which would make the regex polynomial (ReDoS).
  return text.replace(/:\/\/[^/@\s]+@/g, '://***@');
}

/**
 * An authenticated remote URL can ride the argv, and git echoes it in stderr on failure, so `message`, `args` and
 * `stderr` are redacted here - every construction site is covered without each caller having to remember.
 */
export class GitError extends Error {
  readonly args: string[];
  readonly exitCode: number | undefined;
  readonly stderr: string;

  constructor(message: string, args: string[], exitCode: number | undefined, stderr: string) {
    super(redactUrlCredentials(message));
    this.name = 'GitError';
    this.args = args.map(redactUrlCredentials);
    this.exitCode = exitCode;
    this.stderr = redactUrlCredentials(stderr);
  }
}

/** `execFile` sets `code` to a string (e.g. `'ENOENT'`) when the binary is missing; only a number is an exit status. */
export function gitExitCode(error: unknown): number | undefined {
  if (error && typeof error === 'object' && 'code' in error) {
    const { code } = error as { code?: unknown };
    if (typeof code === 'number') {
      return code;
    }
  }
  return undefined;
}

export function isCommandNotFound(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const { code } = error as { code?: unknown };
  return code === 'ENOENT';
}

/** Node sets `killed` when `execFile`'s `timeout` option kills the child. */
export function isExecTimeout(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }
  return (error as { killed?: unknown }).killed === true;
}
