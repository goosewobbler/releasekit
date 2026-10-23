import { type Envelope, errorEnvelope, toEnvelopeError } from '@releasekit/core';
import type { PipelineError } from './errors/index.js';
import { publishDidChange } from './output.js';

/** The envelope has no stage field, so the message names the failed stage; `data` keeps what landed. */
export function pipelineErrorEnvelope(err: PipelineError): Envelope {
  const error = toEnvelopeError(err);
  return errorEnvelope([{ ...error, message: `publish failed in the ${err.failedStage} stage: ${error.message}` }], {
    data: err.partialOutput,
    changed: publishDidChange(err.partialOutput),
  });
}
