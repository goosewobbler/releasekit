#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { createNotesCommand } from '@releasekit/notes/cli';
import { createPublishCommand } from '@releasekit/publish/cli';
import { createVersionCommand } from '@releasekit/version/cli';
import { Command } from 'commander';
import { createReleaseCommand } from './release-command.js';

export function createDispatcherProgram(): Command {
  const program = new Command()
    .name('releasekit')
    .description('Unified release pipeline: version, changelog, and publish')
    .version('0.1.0');

  program.addCommand(createReleaseCommand(), { isDefault: true });
  program.addCommand(createVersionCommand());
  program.addCommand(createNotesCommand());
  program.addCommand(createPublishCommand());

  return program;
}

// Standalone entry point
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  createDispatcherProgram().parse();
}
