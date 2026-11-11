import { statSync } from 'node:fs';
import * as path from 'node:path';
import type { Command } from 'commander';
import { failInput } from './emitResult.js';

/**
 * A `preAction` hook that runs the command from `--project-dir`, so package discovery and git work there too, not only
 * config loading. `--config` and `--output` stay relative to where the command was run.
 */
export function enterProjectDir(_hooked: Command, actionCommand: Command): void {
  const opts = actionCommand.opts();
  for (const key of ['config', 'output']) {
    if (typeof opts[key] === 'string') {
      actionCommand.setOptionValue(key, path.resolve(opts[key]));
    }
  }
  const projectDir = path.resolve(opts.projectDir);
  if (!statSync(projectDir, { throwIfNoEntry: false })?.isDirectory()) {
    failInput(`--project-dir ${projectDir} is not a directory`, actionCommand.opts());
  }
  actionCommand.setOptionValue('projectDir', projectDir);
  process.chdir(projectDir);
}
