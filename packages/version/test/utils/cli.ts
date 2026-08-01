import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { type Envelope, isEnvelope, type VersionOutput } from '@releasekit/core';

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

/**
 * Parse a `--json` run's stdout and return the `VersionOutput` it carries, asserting the envelope on
 * the way through. Exercises the boundary the pipe actually crosses — a process wrote this text and
 * `notes`/`publish` read it back — which a unit test on the emitter can't cover.
 */
export function parseCliEnvelope(stdout: string): { envelope: Envelope; data: VersionOutput } {
  const envelope = JSON.parse(stdout) as Envelope;
  if (!isEnvelope(envelope)) {
    throw new Error(`Expected an envelope on stdout, got: ${stdout.slice(0, 200)}`);
  }
  return { envelope, data: envelope.data as VersionOutput };
}
