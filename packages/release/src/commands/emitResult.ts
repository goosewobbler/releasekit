import { writeFileSync } from 'node:fs';
import { type Envelope, type EnvelopeWarning, errorEnvelope, successEnvelope, toEnvelopeError } from '@releasekit/core';

/**
 * Write an envelope to the JSON channel. When `--output` is given, write to that file — the reliable
 * channel the GitHub Action reads, since stdout can be polluted by subprocess or log noise and a
 * single stray byte breaks JSON parsing. Otherwise, when `--json` is set, print to stdout. Only the
 * envelope goes to stdout; all diagnostics go to stderr via the logger (stream discipline).
 */
function writeEnvelope(envelope: Envelope, opts: { json?: boolean; output?: string }): void {
  const text = JSON.stringify(envelope, null, 2);
  if (opts.output) {
    writeFileSync(opts.output, text);
  } else if (opts.json) {
    console.log(text);
  }
}

/**
 * Emit a command's successful result inside the uniform CLI envelope. `data` becomes the envelope's
 * `data` payload verbatim (VersionOutput etc. are preserved — the envelope wraps, never replaces).
 */
export function emitResult(
  data: unknown,
  opts: { json?: boolean; output?: string; changed?: boolean; warnings?: EnvelopeWarning[] },
): void {
  if (!opts.json && !opts.output) return;
  writeEnvelope(successEnvelope(data ?? null, { changed: opts.changed, warnings: opts.warnings }), opts);
}

/** Emit a structured error envelope for a thrown value on the JSON channel. */
export function emitError(error: unknown, opts: { json?: boolean; output?: string }): void {
  if (!opts.json && !opts.output) return;
  writeEnvelope(errorEnvelope([toEnvelopeError(error)]), opts);
}
