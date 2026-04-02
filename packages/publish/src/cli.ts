#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readPackageVersion } from '@releasekit/core';
import { createPublishCommand } from './command.js';

export { createPublishCommand } from './command.js';

const isMain = (() => {
  try {
    return process.argv[1] ? realpathSync(process.argv[1]) === fileURLToPath(import.meta.url) : false;
  } catch {
    return false;
  }
})();

if (isMain) {
  createPublishCommand()
    .name('releasekit-publish')
    .version(readPackageVersion(import.meta.url))
    .parse();
}
