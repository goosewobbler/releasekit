import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { info } from '@releasekit/core';
import { ConfigError } from './errors.js';

const execFileAsync = promisify(execFile);

/** Splits on whitespace; single or double quotes keep spaces in one argument. No escapes or other shell syntax. */
export function parseCommand(command: string): string[] {
  const args: string[] = [];
  let current = '';
  let inArg = false;
  let quote: string | undefined;
  for (const char of command) {
    if (quote) {
      if (char === quote) {
        quote = undefined;
      } else {
        current += char;
      }
    } else if (char === '"' || char === "'") {
      quote = char;
      inArg = true;
    } else if (/\s/.test(char)) {
      if (inArg) {
        args.push(current);
        current = '';
        inArg = false;
      }
    } else {
      current += char;
      inArg = true;
    }
  }
  if (inArg) {
    args.push(current);
  }
  if (quote || args.length === 0) {
    throw new ConfigError(`git.formatCommand \`${command}\` is not a valid command`, [
      'Set git.formatCommand to a command such as "npx biome format --write", closing any quotes',
    ]);
  }
  return args;
}

export async function runFormatCommand(command: string, files: string[], cwd: string): Promise<void> {
  if (files.length === 0) {
    return;
  }
  const [file, ...args] = parseCommand(command);
  info(`Formatting ${files.length} file(s) with \`${command}\``);
  try {
    await execFileAsync(file, [...args, ...files], { cwd, maxBuffer: 1024 * 1024 * 10 });
  } catch (error) {
    const { code, stderr, stdout } = error as { code?: unknown; stderr?: string; stdout?: string };
    const output = stderr?.trim() || stdout?.trim();
    const detail =
      typeof code === 'number'
        ? `exited with code ${code}${output ? `:\n${output}` : ''}`
        : `could not run: ${error instanceof Error ? error.message : String(error)}`;
    throw new ConfigError(`git.formatCommand \`${command}\` ${detail}`, [
      `Check that \`${file}\` is installed in the release job and that the command succeeds locally`,
    ]);
  }
}
