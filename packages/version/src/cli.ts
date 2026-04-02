#!/usr/bin/env node
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readPackageVersion } from '@releasekit/core';
import { Command } from 'commander';
import { createVersionCommand } from './command.js';

export { createVersionCommand };

// Standalone entry point (only when run directly, not when imported by dispatcher)
const isMain = (() => {
  try {
    return process.argv[1] ? fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url) : false;
  } catch {
    return false;
  }
})();

export function createVersionProgram(): Command {
  return new Command()
    .name('releasekit-version')
    .description('Version a package or packages based on conventional commits')
    .version(readPackageVersion(import.meta.url))
    .addCommand(createVersionCommand(), { isDefault: true });
}

if (isMain) {
  createVersionProgram().parse();
}
