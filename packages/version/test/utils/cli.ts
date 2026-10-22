import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { unwrapEnvelope, type VersionOutput } from '@releasekit/core';

/**
 * Execute the CLI command in the given working directory (tempDir)
 * @param command The CLI command string (e.g. 'version --bump minor')
 * @param cwd The working directory
 * @param dryRun Whether to add --dry-run (default: true)
 */
export function executeCliCommand(command: string, cwd: string, dryRun = true) {
  const cliPath = join(process.cwd(), 'dist/cli.js');
  const args = command.split(' ');
  if (dryRun) args.push('--dry-run');
  return spawnSync('node', [cliPath, ...args], { cwd, encoding: 'utf-8' });
}

/** Read a `--json` run's stdout the way `notes` and `publish` do: unwrapped to its `VersionOutput`. */
export function readVersionOutput(stdout: string): VersionOutput {
  return unwrapEnvelope(JSON.parse(stdout)) as VersionOutput;
}
