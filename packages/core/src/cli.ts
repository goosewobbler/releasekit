import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { type Envelope, errorEnvelope, toEnvelopeError } from './envelope.js';
import { log } from './logger.js';

export function writeEnvelope(envelope: Envelope, opts: { json?: boolean; output?: string }): void {
  if (!opts.json && !opts.output) {
    return;
  }
  const text = JSON.stringify(envelope, null, 2);
  if (!opts.output) {
    // biome-ignore lint/suspicious/noConsole: prints the --json result
    console.log(text);
    return;
  }
  try {
    fs.writeFileSync(opts.output, text);
  } catch (err) {
    if (envelope.status !== 'error') {
      throw err;
    }
    log(
      `Could not write the error envelope to ${opts.output}: ${err instanceof Error ? err.message : String(err)}`,
      'error',
    );
  }
}

export function writeErrorEnvelope(error: unknown, opts: { json?: boolean; output?: string }): void {
  writeEnvelope(errorEnvelope([toEnvelopeError(error)]), opts);
}

/** Pass the CLI entry's `import.meta.url` so this reads that package's version, not core's. */
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
