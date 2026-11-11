import * as path from 'node:path';
import type { Command } from 'commander';
import { failInput } from './emitResult.js';

/**
 * A `preAction` hook that runs the command from `--project-dir`. `--config` and `--output` stay relative to where the
 * command was run.
 */
export function enterProjectDir(_hooked: Command, actionCommand: Command): void {
  const opts = actionCommand.opts();
  for (const key of ['config', 'output']) {
    if (typeof opts[key] === 'string') {
      actionCommand.setOptionValue(key, path.resolve(opts[key]));
    }
  }
  const projectDir = path.resolve(opts.projectDir);
  try {
    process.chdir(projectDir);
  } catch (error) {
    const { code } = error as NodeJS.ErrnoException;
    const reason = code === 'ENOENT' || code === 'ENOTDIR' ? 'is not a directory' : `can't be entered (${code})`;
    failInput(`--project-dir ${projectDir} ${reason}`, actionCommand.opts());
  }
  actionCommand.setOptionValue('projectDir', process.cwd());
}
