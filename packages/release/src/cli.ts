#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readPackageVersion } from '@releasekit/core';
import { Command } from 'commander';
import { createGateCommand } from './gate-command.js';
import { createPreviewCommand } from './preview-command.js';
import { createReleaseCommand } from './release-command.js';

export function createReleaseProgram(): Command {
  return new Command()
    .name('releasekit-release')
    .description('Unified release pipeline: version, changelog, and publish')
    .version(readPackageVersion(import.meta.url))
    .addCommand(createPreviewCommand(), { isDefault: true })
    .addCommand(createReleaseCommand())
    .addCommand(createGateCommand());
}

const isMain = (() => {
  try {
    return process.argv[1] ? realpathSync(process.argv[1]) === fileURLToPath(import.meta.url) : false;
  } catch {
    return false;
  }
})();

if (isMain) {
  createReleaseProgram().parse();
}
