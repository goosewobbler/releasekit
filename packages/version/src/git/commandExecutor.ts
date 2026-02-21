import type { ExecException, ExecOptions } from 'node:child_process';
import { exec, execSync as nativeExecSync } from 'node:child_process';

/**
 * Execute a command asynchronously with Promise wrapper
 * @param command Command to execute
 * @param options Optional execution options
 * @returns Promise with stdout and stderr
 */
export const execAsync = (command: string, options?: ExecOptions): Promise<{ stdout: string; stderr: string }> => {
  const defaultOptions: ExecOptions = { maxBuffer: 1024 * 1024 * 10, ...options };

  return new Promise((resolve, reject) => {
    exec(command, defaultOptions, (error: ExecException | null, stdout: string | Buffer, stderr: string | Buffer) => {
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
 * @param command Command to execute
 * @param args Additional options
 * @returns Buffer with command output
 */
export const execSync = (command: string, args?: Record<string, unknown>) =>
  nativeExecSync(command, { maxBuffer: 1024 * 1024 * 10, ...args });
