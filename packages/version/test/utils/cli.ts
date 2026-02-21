import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

/**
 * Execute the CLI command in the given working directory (tempDir)
 * @param command The CLI command string (e.g. 'version --bump minor')
 * @param cwd The working directory
 * @param dryRun Whether to add --dry-run (default: true)
 */
export function executeCliCommand(command: string, cwd: string, dryRun = true) {
  const cliPath = join(process.cwd(), 'dist/index.js');
  const args = command.split(' ');
  if (dryRun) args.push('--dry-run');
  return spawnSync('node', [cliPath, ...args], { cwd, encoding: 'utf-8' });
}
