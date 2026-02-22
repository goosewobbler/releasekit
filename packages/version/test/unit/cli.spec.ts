import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as configModule from '../../src/config.js';
import { VersionEngine } from '../../src/core/versionEngine.js';
import * as indexModule from '../../src/index.js';
import type { Config } from '../../src/types.js';

vi.mock('../../src/config.js');
vi.mock('../../src/core/versionEngine.js');
vi.mock('../../src/utils/logging.js');
vi.mock('commander', async () => {
  const actual = (await vi.importActual('commander')) as { Command: typeof Command };

  const commands = new Map<string, { handler: unknown; isDefault?: boolean }>();

  return {
    ...actual,
    Command: vi.fn().mockImplementation(function (this: unknown) {
      const originalCommand = new actual.Command();

      originalCommand.parse = vi.fn().mockReturnThis();

      const originalCommandMethod = originalCommand.command.bind(originalCommand);
      originalCommand.command = vi.fn((name: string, opts?: { isDefault?: boolean }) => {
        const cmd = originalCommandMethod(name, opts);
        const originalAction = cmd.action.bind(cmd);
        cmd.action = vi.fn((handler: unknown) => {
          commands.set(name, { handler, isDefault: opts?.isDefault });
          return originalAction(handler);
        });
        return cmd;
      });

      const extendedCommand = originalCommand as typeof originalCommand & {
        getCommandHandler: (name: string) => unknown;
        getCommands: () => Array<[string, { handler: unknown; isDefault?: boolean }]>;
        getDefaultCommand: () => string | null;
      };

      extendedCommand.getCommandHandler = (name: string) => commands.get(name)?.handler;
      extendedCommand.getCommands = () => Array.from(commands.entries());
      extendedCommand.getDefaultCommand = () => {
        for (const [name, { isDefault }] of commands.entries()) {
          if (isDefault) return name;
        }
        return null;
      };

      return extendedCommand;
    }),
  };
});

interface VersionCommandOptions {
  dryRun?: boolean;
  target?: string;
  json?: boolean;
  projectDir?: string;
}

describe('CLI Interface', () => {
  let mockProcess: Partial<NodeJS.Process>;
  const originalProcess: NodeJS.Process = process;
  const mockConfig: Partial<Config> = {
    sync: false,
    packages: ['package-a'],
    dryRun: false,
    tagTemplate: 'v{version}',
    preset: 'conventional',
    updateInternalDependencies: 'minor',
  };

  const mockGetWorkspacePackages = vi.fn();
  const mockRun = vi.fn();
  const mockSetStrategy = vi.fn();

  beforeEach(() => {
    mockProcess = {
      argv: ['node', 'index.js'],
      exit: vi.fn() as unknown as (code?: number | undefined) => never,
      cwd: vi.fn().mockReturnValue('/test/workspace'),
    };

    global.process = mockProcess as NodeJS.Process;

    vi.mocked(configModule.loadConfig, { partial: true }).mockReturnValue(mockConfig as Config);
    mockGetWorkspacePackages.mockResolvedValue({
      packages: [
        { packageJson: { name: '@scope/package-a' }, dir: '/test/packages/package-a' },
        { packageJson: { name: '@scope/package-b' }, dir: '/test/packages/package-b' },
      ],
      root: '/test',
    });
    mockRun.mockResolvedValue(undefined);
    mockSetStrategy.mockReturnValue(undefined);

    vi.mocked(VersionEngine.prototype.getWorkspacePackages, { partial: true }).mockImplementation(
      mockGetWorkspacePackages,
    );
    vi.mocked(VersionEngine.prototype.run, { partial: true }).mockImplementation(mockRun);
    vi.mocked(VersionEngine.prototype.setStrategy, { partial: true }).mockImplementation(mockSetStrategy);
  });

  afterEach(() => {
    global.process = originalProcess;
    vi.clearAllMocks();
    mockGetWorkspacePackages.mockClear();
    mockRun.mockClear();
    mockSetStrategy.mockClear();
  });

  it('should define a default command', async () => {
    await indexModule.run();

    const commanderInstance = vi.mocked(Command, { partial: true }).mock.results[0].value;

    const defaultCommand = commanderInstance.getDefaultCommand();
    expect(defaultCommand).toBe('version');
  });

  it('should execute the version command when no command is specified', async () => {
    mockProcess.argv = ['node', 'index.js', '--dry-run'];

    await indexModule.run();

    const commanderInstance = vi.mocked(Command, { partial: true }).mock.results[0].value;

    expect(commanderInstance.parse).toHaveBeenCalled();

    expect(commanderInstance.getCommands()).toContainEqual(['version', expect.objectContaining({ isDefault: true })]);
  });

  describe('CLI Target Handling', () => {
    it('should override config.packages when -t flag is used', async () => {
      let capturedConfigFromEngine: Config | undefined;

      vi.mocked(VersionEngine, { partial: true }).mockImplementation(function (this: unknown, config: Config) {
        capturedConfigFromEngine = config;
        return {
          getWorkspacePackages: mockGetWorkspacePackages,
          run: mockRun,
          setStrategy: mockSetStrategy,
        } as unknown as VersionEngine;
      });

      const mockOptions = {
        dryRun: true,
        target: '@scope/package-a',
        json: false,
        projectDir: process.cwd(),
      };

      await indexModule.run();
      const commanderInstance = vi.mocked(Command, { partial: true }).mock.results[0].value;
      const versionHandler = commanderInstance.getCommandHandler('version');

      await (versionHandler as (options: VersionCommandOptions) => Promise<void>)(mockOptions);

      expect(capturedConfigFromEngine).toBeDefined();
      expect(capturedConfigFromEngine?.packages).toEqual(['@scope/package-a']);
    });

    it('should parse multiple targets from comma-separated string', async () => {
      let capturedConfigFromEngine: Config | undefined;

      vi.mocked(VersionEngine, { partial: true }).mockImplementation(function (this: unknown, config: Config) {
        capturedConfigFromEngine = config;
        return {
          getWorkspacePackages: mockGetWorkspacePackages,
          run: mockRun,
          setStrategy: mockSetStrategy,
        } as unknown as VersionEngine;
      });

      const mockOptions = {
        dryRun: true,
        target: '@scope/package-a,@scope/package-b',
        json: false,
        projectDir: process.cwd(),
      };

      await indexModule.run();
      const commanderInstance = vi.mocked(Command, { partial: true }).mock.results[0].value;
      const versionHandler = commanderInstance.getCommandHandler('version');

      await (versionHandler as (options: VersionCommandOptions) => Promise<void>)(mockOptions);

      expect(capturedConfigFromEngine).toBeDefined();
      expect(capturedConfigFromEngine?.packages).toEqual(['@scope/package-a', '@scope/package-b']);
    });

    it('should not override config.packages when no -t flag is provided', async () => {
      let capturedConfigFromEngine: Config | undefined;

      vi.mocked(VersionEngine, { partial: true }).mockImplementation(function (this: unknown, config: Config) {
        capturedConfigFromEngine = config;
        return {
          getWorkspacePackages: mockGetWorkspacePackages,
          run: mockRun,
          setStrategy: mockSetStrategy,
        } as unknown as VersionEngine;
      });

      const mockOptions = {
        dryRun: true,
        json: false,
        projectDir: process.cwd(),
      };

      await indexModule.run();
      const commanderInstance = vi.mocked(Command, { partial: true }).mock.results[0].value;
      const versionHandler = commanderInstance.getCommandHandler('version');

      await (versionHandler as (options: VersionCommandOptions) => Promise<void>)(mockOptions);

      expect(capturedConfigFromEngine).toBeDefined();
      expect(capturedConfigFromEngine?.packages).toEqual(mockConfig.packages);
    });

    it('should handle empty target string gracefully', async () => {
      let capturedConfigFromEngine: Config | undefined;

      vi.mocked(VersionEngine, { partial: true }).mockImplementation(function (this: unknown, config: Config) {
        capturedConfigFromEngine = config;
        return {
          getWorkspacePackages: mockGetWorkspacePackages,
          run: mockRun,
          setStrategy: mockSetStrategy,
        } as unknown as VersionEngine;
      });

      const mockOptions = {
        dryRun: true,
        target: '',
        json: false,
        projectDir: process.cwd(),
      };

      await indexModule.run();
      const commanderInstance = vi.mocked(Command, { partial: true }).mock.results[0].value;
      const versionHandler = commanderInstance.getCommandHandler('version');

      await (versionHandler as (options: VersionCommandOptions) => Promise<void>)(mockOptions);

      expect(capturedConfigFromEngine).toBeDefined();
      expect(capturedConfigFromEngine?.packages).toEqual(mockConfig.packages);
    });
  });
});
