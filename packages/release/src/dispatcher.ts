#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readPackageVersion } from '@releasekit/core';
import { createNotesCommand } from '@releasekit/notes';
import { createPublishCommand } from '@releasekit/publish';
import { createVersionCommand } from '@releasekit/version';
import { Command } from 'commander';
import { createInitCommand } from './commands/init-command.js';
import { createPreviewCommand } from './commands/preview-command.js';
import { createReleaseCommand } from './commands/release-command.js';
import { createStandingPRCommand } from './commands/standing-pr-command.js';

export function createDispatcherProgram(): Command {
  const program = new Command()
    .name('releasekit')
    .description('Unified release pipeline: version, changelog, and publish')
    .version(readPackageVersion(import.meta.url));
  program.addCommand(createPreviewCommand(), { isDefault: true });
  program.addCommand(createReleaseCommand());
  program.addCommand(createStandingPRCommand());
  program.addCommand(createInitCommand());
  program.addCommand(createVersionCommand());
  program.addCommand(createNotesCommand());
  program.addCommand(createPublishCommand());

  return program;
}

// Standalone entry point
const isMain = (() => {
  try {
    return process.argv[1] ? realpathSync(process.argv[1]) === fileURLToPath(import.meta.url) : false;
  } catch {
    return false;
  }
})();

if (isMain) {
  createDispatcherProgram().parse();
}
