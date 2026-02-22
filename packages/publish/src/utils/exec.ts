import { execFile } from 'node:child_process';
import { debug, info } from '@releasekit/core';

export interface ExecOptions {
  cwd?: string;
  env?: Record<string, string | undefined>;
  dryRun?: boolean;
  label?: string;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export async function execCommand(file: string, args: string[], options: ExecOptions = {}): Promise<ExecResult> {
  const displayCommand = options.label ?? [file, ...args].join(' ');

  if (options.dryRun) {
    info(`[DRY RUN] Would execute: ${displayCommand}`);
    return { stdout: '', stderr: '', exitCode: 0 };
  }

  debug(`Executing: ${displayCommand}`);

  return new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      {
        maxBuffer: 1024 * 1024 * 10,
        cwd: options.cwd,
        env: options.env ? { ...process.env, ...options.env } : undefined,
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(
            Object.assign(new Error(error.message), {
              stdout: stdout.toString(),
              stderr: stderr.toString(),
              exitCode: error.code ?? 1,
            }),
          );
        } else {
          resolve({
            stdout: stdout.toString(),
            stderr: stderr.toString(),
            exitCode: 0,
          });
        }
      },
    );
  });
}

/**
 * Execute a command and return the result without throwing on non-zero exit.
 * Useful for commands where non-zero exit is an expected outcome (e.g., npm view for unpublished packages).
 */
export async function execCommandSafe(file: string, args: string[], options: ExecOptions = {}): Promise<ExecResult> {
  try {
    return await execCommand(file, args, options);
  } catch (error: unknown) {
    if (error && typeof error === 'object' && 'stdout' in error) {
      const execError = error as ExecResult & Error;
      return {
        stdout: execError.stdout ?? '',
        stderr: execError.stderr ?? '',
        exitCode: execError.exitCode ?? 1,
      };
    }
    return { stdout: '', stderr: error instanceof Error ? error.message : String(error), exitCode: 1 };
  }
}
