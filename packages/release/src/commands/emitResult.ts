import {
  type EnvelopeWarning,
  EXIT_CODES,
  InputError,
  successEnvelope,
  writeEnvelope,
  writeErrorEnvelope,
} from '@releasekit/core';
import { PipelineError, pipelineErrorEnvelope } from '@releasekit/publish';

/** `data` goes into the envelope verbatim: the envelope wraps, never replaces. */
export function emitResult(
  data: unknown,
  opts: { json?: boolean; output?: string; changed?: boolean; warnings?: EnvelopeWarning[] },
): void {
  writeEnvelope(successEnvelope(data ?? null, { changed: opts.changed, warnings: opts.warnings }), opts);
}

export function emitError(error: unknown, opts: { json?: boolean; output?: string }): void {
  if (error instanceof PipelineError) {
    writeEnvelope(pipelineErrorEnvelope(error), opts);
    return;
  }
  writeErrorEnvelope(error, opts);
}

export function failInput(message: string, opts: { json?: boolean; output?: string }): never {
  emitError(new InputError(message), opts);
  console.error(message);
  process.exit(EXIT_CODES.INPUT_ERROR);
}
