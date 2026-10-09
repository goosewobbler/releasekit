import { EXIT_CODES, exitCodeForError, ReleaseKitError, toEnvelopeError } from '@releasekit/core';
import { BasePublishError, PipelineError, PublishErrorCode } from '@releasekit/publish';
import { describe, expect, it } from 'vitest';

// @releasekit/publish's build inlines its own copy of core, so its errors extend a different
// ReleaseKitError class than the one this package's error handling imports — the situation the
// release bundle is in for every version/notes/publish error it reports.
describe('errors raised through another copy of core', () => {
  it('should come from a distinct ReleaseKitError class (the premise of these tests)', () => {
    expect(new PipelineError('boom', 'npm', undefined as never) instanceof ReleaseKitError).toBe(false);
  });

  it('should still be recognised as releasekit errors', () => {
    expect(ReleaseKitError.isReleaseKitError(new PipelineError('boom', 'npm', undefined as never))).toBe(true);
  });

  it('should keep their specific code in the envelope instead of degrading to GENERAL_ERROR', () => {
    const error = toEnvelopeError(new PipelineError('registry rejected', 'npm', undefined as never));
    expect(error.code).toBe(PublishErrorCode.PIPELINE_STAGE_ERROR);
    expect(error.message).toBe('registry rejected');
  });

  it("should exit with their code's family instead of the generic exit code", () => {
    expect(exitCodeForError(new BasePublishError('bad config', PublishErrorCode.CONFIG_ERROR))).toBe(
      EXIT_CODES.CONFIG_ERROR,
    );
  });
});
