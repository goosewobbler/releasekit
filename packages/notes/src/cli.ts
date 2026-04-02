#!/usr/bin/env node
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readPackageVersion } from '@releasekit/core';
import { createNotesCommand } from './command.js';

export { createNotesCommand } from './command.js';

const isMain = (() => {
  try {
    return process.argv[1] ? fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url) : false;
  } catch {
    return false;
  }
})();

if (isMain) {
  createNotesCommand()
    .name('releasekit-notes')
    .version(readPackageVersion(import.meta.url))
    .parse();
}
