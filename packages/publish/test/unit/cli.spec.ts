import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Keep the real envelope helpers, since the tests assert on what's emitted; stub only the logging setters.
vi.mock('@releasekit/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@releasekit/core')>()),
  setJsonMode: vi.fn(),
  setLogLevel: vi.fn(),
}));
vi.mock('../../src/config.js');
vi.mock('../../src/pipeline/index.js');
vi.mock('../../src/stages/input.js');

import { EXIT_CODES, errorEnvelope, setJsonMode, setLogLevel } from '@releasekit/core';
import { createPublishCommand } from '../../src/cli.js';
import { loadConfig } from '../../src/config.js';
import { BasePublishError, PipelineError, PublishErrorCode } from '../../src/errors/index.js';
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
  const tmpDirs: string[] = [];

  function createTmpDir(): string {
    const dir = mkdtempSync(join(tmpdir(), 'publish-cli-'));
    tmpDirs.push(dir);
    return dir;
  }

  beforeEach(() => {
    vi.mocked(loadConfig).mockImplementation(() => ({ ...mockConfig, npm: { ...mockConfig.npm } }));
    vi.mocked(parseInput).mockResolvedValue(mockInput);
    vi.mocked(runPipeline).mockResolvedValue(mockOutput);
    mockExit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
  });

  afterEach(() => {
    vi.clearAllMocks();
    mockExit.mockRestore();
    for (const dir of tmpDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
    tmpDirs.length = 0;
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
      expect(envelope.data).toEqual(mockOutput);
      consoleSpy.mockRestore();
    });

    it('should report changed when the release commit was created with no registry publish', async () => {
      vi.mocked(runPipeline).mockResolvedValue({
        ...mockOutput,
        git: { committed: true, tags: ['v1.1.0'], pushed: false },
      });
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

      await createPublishCommand().parseAsync(['node', 'test', '--json']);

      expect(JSON.parse(consoleSpy.mock.calls[0]?.[0] as string).changed).toBe(true);
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
      expect(envelope.data).toEqual(partialOutput);
      expect(envelope.changed).toBe(true);
      expect(envelope.errors[0].message).toContain('npm');
      expect(envelope.errors[0].message).toContain('registry rejected');
      expect(mockExit).toHaveBeenCalledWith(EXIT_CODES.PUBLISH_ERROR);
      consoleSpy.mockRestore();
    });

    it('should write the PipelineError envelope with its partial output to --output', async () => {
      const partialOutput: PublishOutput = {
        ...mockOutput,
        npm: [{ packageName: '@acme/a', version: '1.0.0', registry: 'npm', success: true, skipped: false }],
      };
      vi.mocked(runPipeline).mockRejectedValue(new PipelineError('registry rejected', 'npm', partialOutput));
      const stderrSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
      const outputFile = join(createTmpDir(), 'publish.json');

      await createPublishCommand().parseAsync(['node', 'test', '--output', outputFile]);

      const envelope = JSON.parse(readFileSync(outputFile, 'utf-8'));
      expect(envelope.status).toBe('error');
      expect(envelope.data).toEqual(partialOutput);
      expect(envelope.changed).toBe(true);
      expect(consoleSpy).not.toHaveBeenCalled();
      expect(mockExit).toHaveBeenCalledWith(EXIT_CODES.PUBLISH_ERROR);
      stderrSpy.mockRestore();
      consoleSpy.mockRestore();
    });

    it('should exit with INPUT_ERROR when --input holds a failed upstream envelope', async () => {
      const actualInput =
        await vi.importActual<typeof import('../../src/stages/input.js')>('../../src/stages/input.js');
      vi.mocked(parseInput).mockImplementation(actualInput.parseInput);
      const inputFile = join(createTmpDir(), 'version.json');
      writeFileSync(
        inputFile,
        JSON.stringify(
          errorEnvelope([{ code: 'GIT_ERROR', category: 'git', retryable: false, message: 'no such ref' }]),
        ),
      );
      const stderrSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

      await createPublishCommand().parseAsync(['node', 'test', '--json', '--input', inputFile]);

      const envelope = JSON.parse(consoleSpy.mock.calls[0]?.[0] as string);
      expect(envelope.errors).toMatchObject([
        { code: 'INPUT_PARSE_ERROR', message: expect.stringContaining('GIT_ERROR') },
      ]);
      expect(mockExit).toHaveBeenCalledWith(EXIT_CODES.INPUT_ERROR);
      expect(runPipeline).not.toHaveBeenCalled();
      stderrSpy.mockRestore();
      consoleSpy.mockRestore();
    });

    it('should exit with CONFIG_ERROR for a configuration failure', async () => {
      const configError = new BasePublishError('bad npm.auth', PublishErrorCode.CONFIG_ERROR);
      vi.spyOn(configError, 'logError').mockImplementation(() => undefined);
      vi.mocked(loadConfig).mockImplementation(() => {
        throw configError;
      });

      await createPublishCommand().parseAsync(['node', 'test']);

      expect(mockExit).toHaveBeenCalledWith(EXIT_CODES.CONFIG_ERROR);
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
