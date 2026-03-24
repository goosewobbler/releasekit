#!/usr/bin/env node
import { Command } from 'commander';
import { createReleaseCommand } from './release-command.js';

const program = new Command()
  .name('releasekit-release')
  .description('Unified release pipeline: version, changelog, and publish')
  .version('0.1.0')
  .addCommand(createReleaseCommand(), { isDefault: true });

program.parse();
