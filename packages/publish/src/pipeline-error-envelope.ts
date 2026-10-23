import { type Envelope, errorEnvelope, toEnvelopeError } from '@releasekit/core';
import type { PipelineError } from './errors/index.js';
import { publishDidChange } from './output.js';

/** Same envelope `publish --json` prints when a stage fails after partial progress. */
export function pipelineErrorEnvelope(err: PipelineError): Envelope {
  const error = toEnvelopeError(err);
  return errorEnvelope([{ ...error, message: `publish failed in the ${err.failedStage} stage: ${error.message}` }], {
    data: err.partialOutput,
    changed: publishDidChange(err.partialOutput),
  });
}
