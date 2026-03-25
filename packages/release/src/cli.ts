#!/usr/bin/env node
import { readPackageVersion } from '@releasekit/core';
import { Command } from 'commander';
import { createReleaseCommand } from './release-command.js';

const program = new Command()
  .name('releasekit-release')
  .description('Unified release pipeline: version, changelog, and publish')
  .version(readPackageVersion(import.meta.url))
  .addCommand(createReleaseCommand(), { isDefault: true });

program.parse();
