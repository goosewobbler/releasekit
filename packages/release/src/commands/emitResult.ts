import {
  type EnvelopeWarning,
  EXIT_CODES,
  errorEnvelope,
  InputError,
  successEnvelope,
  toEnvelopeError,
  writeEnvelope,
} from '@releasekit/core';

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

/**
 * Report a CLI input-validation failure through the uniform contract: emit a structured INPUT_ERROR
 * envelope on the JSON channel, log the message to stderr, and exit with the input-error code. Used
 * for pre-flight arg checks so they honour the same envelope guarantee as runtime errors.
 */
export function failInput(message: string, opts: { json?: boolean; output?: string }): never {
  emitError(new InputError(message), opts);
  console.error(message);
  process.exit(EXIT_CODES.INPUT_ERROR);
}
