import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Partial mock: the envelope builders and writer must stay real, since these tests assert on the
// envelope the command actually emits. Only the logging setters are stubbed, to assert they're wired.
vi.mock('@releasekit/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@releasekit/core')>()),
  setJsonMode: vi.fn(),
  setLogLevel: vi.fn(),
}));
vi.mock('../../src/config.js');
vi.mock('../../src/pipeline/index.js');
vi.mock('../../src/stages/input.js');

import { EXIT_CODES, setJsonMode, setLogLevel } from '@releasekit/core';
import { createPublishCommand } from '../../src/cli.js';
import { loadConfig } from '../../src/config.js';
import { BasePublishError, PipelineError } from '../../src/errors/index.js';
import { runPipeline } from '../../src/pipeline/index.js';
import { parseInput } from '../../src/stages/input.js';
import type { PublishConfig, PublishOutput } from '../../src/types.js';

const mockConfig: PublishConfig = {
  npm: {
    enabled: true,
    auth: 'auto',
    access: 'public',
    provenance: false,
    registry: 'https://registry.npmjs.org',
    copyFiles: [],
    tag: 'latest',
  },
  cargo: { enabled: false, noVerify: false, publishOrder: [], clean: false },
  git: { push: true, pushMethod: 'auto', remote: 'origin', branch: undefined },
  githubRelease: {
    enabled: false,
    draft: true,
    perPackage: true,
    prerelease: 'auto',
    releaseNotes: 'auto',
    skipPackages: [],
  },
  verify: {
    npm: { enabled: false, maxAttempts: 5, initialDelay: 15000, backoffMultiplier: 2 },
    cargo: { enabled: false, maxAttempts: 5, initialDelay: 15000, backoffMultiplier: 2 },
  },
};

const mockInput = { dryRun: false, updates: [], changelogs: [], tags: [] };

const mockOutput: PublishOutput = {
  dryRun: false,
  git: { committed: false, tags: [], pushed: false },
  npm: [],
  cargo: [],
  pub: [],
  verification: [],
  githubReleases: [],
  publishSucceeded: true,
};

describe('createPublishCommand', () => {
  let mockExit: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.mocked(loadConfig).mockImplementation(() => ({ ...mockConfig, npm: { ...mockConfig.npm } }));
    vi.mocked(parseInput).mockResolvedValue(mockInput);
    vi.mocked(runPipeline).mockResolvedValue(mockOutput);
    mockExit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
  });

  afterEach(() => {
    vi.clearAllMocks();
    mockExit.mockRestore();
  });

  it('should return a command named publish', () => {
    expect(createPublishCommand().name()).toBe('publish');
  });

  it('should call runPipeline when parsed', async () => {
    await createPublishCommand().parseAsync(['node', 'test']);
    expect(runPipeline).toHaveBeenCalled();
  });

  describe('logging flags', () => {
    it('should set log level to debug when --verbose is passed', async () => {
      await createPublishCommand().parseAsync(['node', 'test', '--verbose']);
      expect(setLogLevel).toHaveBeenCalledWith('debug');
    });

    it('should not set log level when --verbose is not passed', async () => {
      await createPublishCommand().parseAsync(['node', 'test']);
      expect(setLogLevel).not.toHaveBeenCalled();
    });

    it('should enable json mode when --json is passed', async () => {
      await createPublishCommand().parseAsync(['node', 'test', '--json']);
      expect(setJsonMode).toHaveBeenCalledWith(true);
    });
  });

  describe('npm auth', () => {
    it('should override config.npm.auth when --npm-auth is not auto', async () => {
      await createPublishCommand().parseAsync(['node', 'test', '--npm-auth', 'oidc']);
      const [, configArg] = vi.mocked(runPipeline).mock.calls[0];
      expect((configArg as PublishConfig).npm.auth).toBe('oidc');
    });

    it('should not override config.npm.auth when --npm-auth is auto (default)', async () => {
      await createPublishCommand().parseAsync(['node', 'test']);
      const [, configArg] = vi.mocked(runPipeline).mock.calls[0];
      expect((configArg as PublishConfig).npm.auth).toBe('auto');
    });
  });

  describe('JSON output', () => {
    it('should print a success envelope wrapping the output when --json is passed', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

      await createPublishCommand().parseAsync(['node', 'test', '--json']);

      const envelope = JSON.parse(consoleSpy.mock.calls[0]?.[0] as string);
      expect(envelope.status).toBe('success');
      // The payload rides in `data` verbatim, so the pipe's contract is unchanged.
      expect(envelope.data).toEqual(mockOutput);
      consoleSpy.mockRestore();
    });

    it('should not print JSON output when --json is not passed', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

      await createPublishCommand().parseAsync(['node', 'test']);

      expect(consoleSpy).not.toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe('error handling', () => {
    it('should print a PipelineError envelope carrying the partial output and exit with PUBLISH_ERROR', async () => {
      const partialOutput: PublishOutput = {
        ...mockOutput,
        npm: [{ packageName: '@acme/a', version: '1.0.0', registry: 'npm', success: true, skipped: false }],
      };
      vi.mocked(runPipeline).mockRejectedValue(new PipelineError('registry rejected', 'npm', partialOutput));

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

      await createPublishCommand().parseAsync(['node', 'test', '--json']);

      const envelope = JSON.parse(consoleSpy.mock.calls[0]?.[0] as string);
      expect(envelope.status).toBe('error');
      // What landed before the failure survives — the retry needs it — and the stage that failed is
      // named in the message, since the envelope has no field for it.
      expect(envelope.data).toEqual(partialOutput);
      expect(envelope.changed).toBe(true);
      expect(envelope.errors[0].message).toContain('npm');
      expect(envelope.errors[0].message).toContain('registry rejected');
      expect(mockExit).toHaveBeenCalledWith(EXIT_CODES.PUBLISH_ERROR);
      consoleSpy.mockRestore();
    });

    it('should call logError and exit with PUBLISH_ERROR for BasePublishError', async () => {
      const publishError = new BasePublishError('publish failed', 'PUBLISH_FAILED');
      const logErrorSpy = vi.spyOn(publishError, 'logError').mockImplementation(() => undefined);
      vi.mocked(runPipeline).mockRejectedValue(publishError);

      await createPublishCommand().parseAsync(['node', 'test']);

      expect(logErrorSpy).toHaveBeenCalled();
      expect(mockExit).toHaveBeenCalledWith(EXIT_CODES.PUBLISH_ERROR);
    });

    it('should log and exit with GENERAL_ERROR for unknown errors', async () => {
      vi.mocked(runPipeline).mockRejectedValue(new Error('unexpected'));
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

      await createPublishCommand().parseAsync(['node', 'test']);

      expect(consoleSpy).toHaveBeenCalledWith('unexpected');
      expect(mockExit).toHaveBeenCalledWith(EXIT_CODES.GENERAL_ERROR);
      consoleSpy.mockRestore();
    });
  });
});
