#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createNotesCommand } from '@releasekit/notes/cli';
import { createPublishCommand } from '@releasekit/publish/cli';
import { createVersionCommand } from '@releasekit/version/cli';
import { Command } from 'commander';
import { createReleaseCommand } from './release-command.js';

export function createDispatcherProgram(): Command {
  const program = new Command()
    .name('releasekit')
  const program = new Command()
    .name('releasekit')
    .description('Unified release pipeline: version, changelog, and publish')
    .version(getPackageVersion());
  program.addCommand(createReleaseCommand(), { isDefault: true });
  program.addCommand(createVersionCommand());
  program.addCommand(createNotesCommand());
  program.addCommand(createPublishCommand());

  return program;
}

// Standalone entry point
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  createDispatcherProgram().parse();
}
