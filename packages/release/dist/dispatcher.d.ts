#!/usr/bin/env node
import { Command } from 'commander';

declare function createDispatcherProgram(): Command;

export { createDispatcherProgram };
