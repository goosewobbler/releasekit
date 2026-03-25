#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readPackageVersion } from '@releasekit/core';
import { createNotesCommand } from '@releasekit/notes/cli';
import { createPublishCommand } from '@releasekit/publish/cli';
import { createVersionCommand } from '@releasekit/version/cli';
import { Command } from 'commander';
import { createReleaseCommand } from './release-command.js';

export function createDispatcherProgram(): Command {
  const program = new Command()
    .name('releasekit')
    .description('Unified release pipeline: version, changelog, and publish')
    .version(readPackageVersion(import.meta.url));
  program.addCommand(createReleaseCommand(), { isDefault: true });
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
