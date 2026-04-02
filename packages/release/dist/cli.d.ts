#!/usr/bin/env node
import { Command } from 'commander';

declare function createReleaseProgram(): Command;

export { createReleaseProgram };
