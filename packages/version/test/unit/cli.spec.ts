import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createVersionCommand, createVersionProgram } from '../../src/cli.js';
import * as configModule from '../../src/config.js';
import { VersionEngine } from '../../src/core/versionEngine.js';
import type { Config, VersionRunOptions } from '../../src/types.js';
import * as jsonOutputModule from '../../src/utils/jsonOutput.js';

vi.mock('../../src/config.js');
vi.mock('../../src/core/versionEngine.js');
vi.mock('../../src/utils/logging.js');
vi.mock('../../src/utils/jsonOutput.js');

const mockConfig: Partial<Config> = {
  sync: false,
  packages: ['package-a'],
  dryRun: false,
  tagTemplate: 'v{version}',
  preset: 'conventional',
  updateInternalDependencies: 'minor',
};

const TWO_PACKAGES = {
  packages: [
    { packageJson: { name: '@scope/package-a' }, dir: '/test/packages/package-a' },
    { packageJson: { name: '@scope/package-b' }, dir: '/test/packages/package-b' },
  ],
  root: '/test',
};

const ONE_PACKAGE = {
  packages: [{ packageJson: { name: '@scope/package-a' }, dir: '/test/packages/package-a' }],
  root: '/test',
};

describe('createVersionCommand', () => {
  const mockGetWorkspacePackages = vi.fn();
  const mockRun = vi.fn();
  const mockSetStrategy = vi.fn();
  let mockExit: ReturnType<typeof vi.spyOn>;

  function mockEngineCapturingConfig(out: { config?: Config; runOptions?: VersionRunOptions }): void {
    vi.mocked(VersionEngine, { partial: true }).mockImplementation(function (
      this: unknown,
      config: Config,
      runOptions?: VersionRunOptions,
    ) {
      out.config = config;
      out.runOptions = runOptions;
      return {
        getWorkspacePackages: mockGetWorkspacePackages,
        run: mockRun,
        setStrategy: mockSetStrategy,
      } as unknown as VersionEngine;
    });
  }

  beforeEach(() => {
    vi.mocked(configModule.loadConfig, { partial: true }).mockReturnValue({ ...mockConfig } as Config);
    mockGetWorkspacePackages.mockResolvedValue(TWO_PACKAGES);
    mockRun.mockResolvedValue(undefined);
    mockSetStrategy.mockReturnValue(undefined);

    vi.mocked(VersionEngine.prototype.getWorkspacePackages, { partial: true }).mockImplementation(
      mockGetWorkspacePackages,
    );
    vi.mocked(VersionEngine.prototype.run, { partial: true }).mockImplementation(mockRun);
    vi.mocked(VersionEngine.prototype.setStrategy, { partial: true }).mockImplementation(mockSetStrategy);

    mockExit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
  });

  afterEach(() => {
    vi.clearAllMocks();
    mockExit.mockRestore();
  });

  it('should return a command named version', () => {
    const cmd = createVersionCommand();
    expect(cmd.name()).toBe('version');
  });

  it('should have version as the default subcommand in the standalone program', () => {
    const program = createVersionProgram();
    expect((program as unknown as { _defaultCommandName: string })._defaultCommandName).toBe('version');
  });

  it('should run the version action when parsed', async () => {
    const cmd = createVersionCommand();
    await cmd.parseAsync(['node', 'test']);

    expect(configModule.loadConfig).toHaveBeenCalled();
    expect(mockRun).toHaveBeenCalled();
  });

  describe('option → runOptions', () => {
    it('should pass dryRun to engine when --dry-run is passed', async () => {
      const captured: { config?: Config; runOptions?: VersionRunOptions } = {};
      mockEngineCapturingConfig(captured);

      await createVersionCommand().parseAsync(['node', 'test', '--dry-run']);

      expect(captured.runOptions?.dryRun).toBe(true);
    });

    it('should pass sync to engine when --sync is passed', async () => {
      const captured: { config?: Config; runOptions?: VersionRunOptions } = {};
      mockEngineCapturingConfig(captured);

      await createVersionCommand().parseAsync(['node', 'test', '--sync']);

      expect(captured.runOptions?.sync).toBe(true);
      expect(mockSetStrategy).toHaveBeenCalledWith('sync');
    });

    it('should pass bump to engine when --bump is passed', async () => {
      const captured: { config?: Config; runOptions?: VersionRunOptions } = {};
      mockEngineCapturingConfig(captured);

      await createVersionCommand().parseAsync(['node', 'test', '--bump', 'major']);

      expect(captured.runOptions?.bump).toBe('major');
    });

    it('should pass prerelease string to engine when --prerelease <id> is passed', async () => {
      const captured: { config?: Config; runOptions?: VersionRunOptions } = {};
      mockEngineCapturingConfig(captured);

      await createVersionCommand().parseAsync(['node', 'test', '--prerelease', 'beta']);

      expect(captured.runOptions?.prerelease).toBe('beta');
    });

    it('should pass prerelease: true to engine when --prerelease is passed without a value', async () => {
      const captured: { config?: Config; runOptions?: VersionRunOptions } = {};
      mockEngineCapturingConfig(captured);

      await createVersionCommand().parseAsync(['node', 'test', '--prerelease']);

      expect(captured.runOptions?.prerelease).toBe(true);
    });
  });

  describe('--json flag', () => {
    it('should call enableJsonOutput(false) when --json is passed without --dry-run', async () => {
      await createVersionCommand().parseAsync(['node', 'test', '--json']);

      expect(jsonOutputModule.enableJsonOutput).toHaveBeenCalledWith(false);
    });

    it('should call enableJsonOutput(true) when both --json and --dry-run are passed', async () => {
      await createVersionCommand().parseAsync(['node', 'test', '--json', '--dry-run']);

      expect(jsonOutputModule.enableJsonOutput).toHaveBeenCalledWith(true);
    });

    it('should not call enableJsonOutput when --json is not passed', async () => {
      await createVersionCommand().parseAsync(['node', 'test']);

      expect(jsonOutputModule.enableJsonOutput).not.toHaveBeenCalled();
    });
  });

  describe('versioning strategy selection', () => {
    it('should use async strategy for multiple packages', async () => {
      await createVersionCommand().parseAsync(['node', 'test']);

      expect(mockSetStrategy).toHaveBeenCalledWith('async');
    });

    it('should use single strategy for one package', async () => {
      mockGetWorkspacePackages.mockResolvedValue(ONE_PACKAGE);

      await createVersionCommand().parseAsync(['node', 'test']);

      expect(mockSetStrategy).toHaveBeenCalledWith('single');
    });

    it('should use sync strategy when --sync flag overrides package count', async () => {
      await createVersionCommand().parseAsync(['node', 'test', '--sync']);

      expect(mockSetStrategy).toHaveBeenCalledWith('sync');
      expect(mockSetStrategy).not.toHaveBeenCalledWith('async');
    });

    it('should exit with code 1 when no packages are found', async () => {
      mockGetWorkspacePackages.mockResolvedValue({ packages: [], root: '/test' });

      await createVersionCommand().parseAsync(['node', 'test']);

      expect(mockExit).toHaveBeenCalledWith(1);
    });
  });

  describe('target flag handling', () => {
    it('should pass targets to engine when --target is used', async () => {
      const captured: { config?: Config; runOptions?: VersionRunOptions } = {};
      mockEngineCapturingConfig(captured);

      await createVersionCommand().parseAsync(['node', 'test', '--target', '@scope/package-a']);

      expect(captured.runOptions?.targets).toEqual(['@scope/package-a']);
      // Config should not be mutated
      expect(captured.config?.packages).toEqual(mockConfig.packages);
    });

    it('should parse multiple targets from comma-separated string', async () => {
      const captured: { config?: Config; runOptions?: VersionRunOptions } = {};
      mockEngineCapturingConfig(captured);

      await createVersionCommand().parseAsync(['node', 'test', '--target', '@scope/package-a,@scope/package-b']);

      expect(captured.runOptions?.targets).toEqual(['@scope/package-a', '@scope/package-b']);
    });

    it('should not pass targets when no --target flag is provided', async () => {
      const captured: { config?: Config; runOptions?: VersionRunOptions } = {};
      mockEngineCapturingConfig(captured);

      await createVersionCommand().parseAsync(['node', 'test']);

      expect(captured.runOptions?.targets).toBeUndefined();
      expect(captured.config?.packages).toEqual(mockConfig.packages);
    });

    it('should not pass targets when --target is an empty string', async () => {
      const captured: { config?: Config; runOptions?: VersionRunOptions } = {};
      mockEngineCapturingConfig(captured);

      await createVersionCommand().parseAsync(['node', 'test', '--target', '']);

      expect(captured.runOptions?.targets).toBeUndefined();
      expect(captured.config?.packages).toEqual(mockConfig.packages);
    });
  });
});
