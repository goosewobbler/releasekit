import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@releasekit/core');
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
    noVerify: false,
    tag: 'latest',
    copyFiles: [],
  },
  cargo: { enabled: false, noVerify: false, publishOrder: [] },
  git: { push: true, pushMethod: 'auto', commitMessage: 'chore(release): {version}', tagMessage: '{version}' },
  github: { enabled: false },
  verification: { enabled: false },
};

const mockInput = { dryRun: false, updates: [], changelogs: [], tags: [] };

const mockOutput: PublishOutput = {
  dryRun: false,
  git: { committed: false, tags: [], pushed: false },
  npm: [],
  cargo: [],
  verification: [],
  githubReleases: [],
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
    it('should print output as JSON when --json is passed and pipeline succeeds', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

      await createPublishCommand().parseAsync(['node', 'test', '--json']);

      expect(consoleSpy).toHaveBeenCalledWith(JSON.stringify(mockOutput, null, 2));
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
    it('should print PipelineError as JSON and exit with PUBLISH_ERROR when --json is passed', async () => {
      const partialOutput: PublishOutput = { ...mockOutput };
      const pipelineError = new PipelineError('stage failed', 'npm', partialOutput);
      vi.mocked(runPipeline).mockRejectedValue(pipelineError);

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

      await createPublishCommand().parseAsync(['node', 'test', '--json']);

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('"failedStage": "npm"'));
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
