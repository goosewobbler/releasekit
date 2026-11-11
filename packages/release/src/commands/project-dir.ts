import { enterProjectDir as enter, InputError } from '@releasekit/core';
import type { Command } from 'commander';
import { failInput } from './emitResult.js';

/** A `preAction` hook that applies `--project-dir` before the command runs. */
export function enterProjectDir(_hooked: Command, actionCommand: Command): void {
  try {
    const resolved = enter(actionCommand.opts());
    for (const key of ['config', 'output', 'projectDir'] as const) {
      if (resolved[key] !== undefined) {
        actionCommand.setOptionValue(key, resolved[key]);
      }
    }
  } catch (error) {
    if (!(error instanceof InputError)) {
      throw error;
    }
    failInput(error.message, actionCommand.opts());
  }
}
