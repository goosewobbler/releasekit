import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { unwrapEnvelope, type VersionOutput } from '@releasekit/core';

export function executeCliCommand(command: string, cwd: string, dryRun = true) {
  const cliPath = join(process.cwd(), 'dist/cli.js');
  const args = command.split(' ');
  if (dryRun) {
    args.push('--dry-run');
  }
  return spawnSync('node', [cliPath, ...args], { cwd, encoding: 'utf-8' });
}

/** Read a `--json` run's stdout the way `notes` and `publish` do: unwrapped to its `VersionOutput`. */
export function readVersionOutput(stdout: string): VersionOutput {
  return unwrapEnvelope(JSON.parse(stdout)) as VersionOutput;
}

/** Runs `--json` and reads its output. A failed run throws with the CLI's stderr. */
export function runVersionJson(cwd: string, args = '', dryRun = true): VersionOutput {
  const result = executeCliCommand(args ? `--json ${args}` : '--json', cwd, dryRun);
  if (result.status !== 0) {
    const cause = result.error?.message ?? (result.signal ? `killed by ${result.signal}` : `exit ${result.status}`);
    throw new Error(`version failed (${cause}):\n${result.stderr}`);
  }
  return readVersionOutput(result.stdout);
}

const ENGINE_SCRIPT = `
const [distIndex, runOptionsJson] = process.argv.slice(1);
const { loadConfig, VersionEngine, enableJsonOutput, getJsonData } = await import(distIndex);
enableJsonOutput(true);
const config = loadConfig({ cwd: process.cwd() });
const engine = new VersionEngine(config, { dryRun: true, ...JSON.parse(runOptionsJson) });
const packages = await engine.getWorkspacePackages();
const hasGroups = config.groups && Object.keys(config.groups).length > 0;
engine.setStrategy(config.sync ? 'sync' : hasGroups ? 'group' : packages.packages.length === 1 ? 'single' : 'async');
await engine.run(packages);
process.stdout.write('\\n__VERSION_OUTPUT__' + JSON.stringify(getJsonData()));
`;

/**
 * Runs the built package's `VersionEngine` with run options the CLI doesn't expose, choosing the strategy as the
 * release pipeline does.
 */
export function runVersionEngine(cwd: string, runOptions: Record<string, unknown>): VersionOutput {
  const distIndex = join(process.cwd(), 'dist/index.js');
  const result = spawnSync(
    'node',
    ['--input-type=module', '-e', ENGINE_SCRIPT, distIndex, JSON.stringify(runOptions)],
    { cwd, encoding: 'utf-8' },
  );
  const marker = result.stdout.lastIndexOf('__VERSION_OUTPUT__');
  if (result.status !== 0 || marker === -1) {
    throw new Error(`version engine failed (exit ${result.status}):\n${result.stderr}`);
  }
  return JSON.parse(result.stdout.slice(marker + '__VERSION_OUTPUT__'.length)) as VersionOutput;
}
