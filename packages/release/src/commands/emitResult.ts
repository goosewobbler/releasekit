import { writeFileSync } from 'node:fs';

/**
 * Emit a command's JSON result. When `--output` is given, write it to that file — the reliable
 * channel the GitHub Action reads, since stdout can be polluted by subprocess or log noise and a
 * single stray byte breaks JSON parsing. Otherwise, when `--json` is set, print to stdout as before.
 */
export function emitResult(result: unknown, opts: { json?: boolean; output?: string }): void {
  if (result === undefined || result === null) return;
  const text = JSON.stringify(result, null, 2);
  if (opts.output) {
    writeFileSync(opts.output, text);
  } else if (opts.json) {
    console.log(text);
  }
}
