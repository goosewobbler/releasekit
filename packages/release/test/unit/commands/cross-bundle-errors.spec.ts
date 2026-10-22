import { EXIT_CODES, ReleaseKitError } from '@releasekit/core';
import { LLMError } from '@releasekit/notes';
import { BasePublishError, PublishErrorCode } from '@releasekit/publish';
import { BaseVersionError } from '@releasekit/version';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/release.js');

import { createReleaseCommand } from '../../../src/commands/release-command.js';
import { runRelease } from '../../../src/release.js';

describe('release --json when a stage fails', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    {
      stage: 'version',
      error: new BaseVersionError('git tag failed', 'GIT_ERROR'),
      code: 'GIT_ERROR',
      retryable: false,
      exit: EXIT_CODES.GIT_ERROR,
    },
    {
      stage: 'notes',
      error: new LLMError('provider timed out', { retryable: true }),
      code: 'LLM_ERROR',
      retryable: true,
      exit: EXIT_CODES.LLM_ERROR,
    },
    {
      stage: 'publish',
      error: new BasePublishError('npm auth is not configured', PublishErrorCode.CONFIG_ERROR),
      code: 'CONFIG_ERROR',
      retryable: false,
      exit: EXIT_CODES.CONFIG_ERROR,
    },
  ])('should report $code from the $stage stage and exit $exit', async ({ stage, error, code, retryable, exit }) => {
    expect(
      error,
      `the ${stage} build shares release's ReleaseKitError, so this case no longer tests a separate copy of core`,
    ).not.toBeInstanceOf(ReleaseKitError);
    vi.mocked(runRelease).mockRejectedValue(error);

    await createReleaseCommand().parseAsync(['node', 'release', '--json']);

    const envelope = JSON.parse(logSpy.mock.calls[0]?.[0] as string);
    expect(envelope.errors).toMatchObject([{ code, retryable, message: error.message }]);
    expect(exitSpy).toHaveBeenCalledWith(exit);
  });
});
