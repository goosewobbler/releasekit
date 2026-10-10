import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Envelope } from './envelope.js';

/**
 * Write an envelope to the JSON channel: `--output` when given, otherwise stdout under `--json`, and
 * nothing at all when neither is set. `--output` is the reliable channel — stdout can be polluted by
 * subprocess or log noise, and a single stray byte breaks JSON parsing.
 */
export function writeEnvelope(envelope: Envelope, opts: { json?: boolean; output?: string }): void {
  if (!opts.json && !opts.output) return;
  const text = JSON.stringify(envelope, null, 2);
  if (!opts.output) {
    console.log(text);
    return;
  }
  try {
    fs.writeFileSync(opts.output, text);
  } catch (err) {
    // An unwritable --output fails the command: throw for a result write so the caller's error path runs,
    // naming what was lost — the command's work is done, only its result never reached the file. That
    // path writes its error envelope to the same file and fails again — note it on stderr instead of
    // throwing out of the error handler, which would crash with a stack and bury the original failure.
    const reason = err instanceof Error ? err.message : String(err);
    if (envelope.status !== 'error') throw new Error(`Could not write the result to ${opts.output}: ${reason}`);
    console.error(`Could not write the error envelope to ${opts.output}: ${reason}`);
  }
}

/**
 * Reads the version from the package.json nearest to the given module URL.
 * Pass `import.meta.url` from the CLI entry file so the path resolves to
 * that package's own package.json, not core's.
 */
export function readPackageVersion(importMetaUrl: string): string {
  try {
    const dir = path.dirname(fileURLToPath(importMetaUrl));
    const packageJsonPath = path.resolve(dir, '../package.json');
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8')) as {
      version?: string;
    };
    return packageJson.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}
