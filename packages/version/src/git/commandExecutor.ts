import type { ExecFileOptions } from 'node:child_process';
import { execFile, execFileSync } from 'node:child_process';

/**
 * Execute a command asynchronously with Promise wrapper
 * @param file Binary to execute
 * @param args Arguments to pass (not shell-interpolated)
 * @param options Optional execution options
 * @returns Promise with stdout and stderr
 */
export const execAsync = (
  file: string,
  args: string[],
  options?: ExecFileOptions,
): Promise<{ stdout: string; stderr: string }> => {
  const defaultOptions = { maxBuffer: 1024 * 1024 * 10, ...options };

  return new Promise((resolve, reject) => {
    execFile(file, args, defaultOptions, (error, stdout, stderr) => {
      if (error) {
        reject(error);
      } else {
        resolve({ stdout: stdout.toString(), stderr: stderr.toString() });
      }
    });
  });
};

/**
 * Execute a command synchronously with default options
 * @param file Binary to execute
 * @param args Arguments to pass (not shell-interpolated)
 * @param options Additional options
 * @returns Buffer with command output
 */
export const execSync = (file: string, args: string[], options?: Record<string, unknown>): Buffer =>
  execFileSync(file, args, { maxBuffer: 1024 * 1024 * 10, ...options }) as Buffer;
