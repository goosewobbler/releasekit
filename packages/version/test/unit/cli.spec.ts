import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as configModule from '../../src/config.js';
import { VersionEngine } from '../../src/core/versionEngine.js';
import * as indexModule from '../../src/index.js';
import type { Config } from '../../src/types.js';

// Mock dependencies
vi.mock('../../src/config.js');
vi.mock('../../src/core/versionEngine.js');
vi.mock('../../src/utils/logging.js');
vi.mock('commander', async () => {
  const actual = (await vi.importActual('commander')) as { Command: typeof Command };

  // Store commands at module level to persist across instances
  const commands = new Map<string, { handler: unknown; isDefault?: boolean }>();

  return {
    ...actual,
    Command: vi.fn().mockImplementation(function (this: unknown) {
      // Use function constructor instead of arrow function
      const originalCommand = new actual.Command();

      // Add spies to track method calls
      originalCommand.parse = vi.fn().mockReturnThis();

      // Override command method to track commands
      const originalCommandMethod = originalCommand.command.bind(originalCommand);
      originalCommand.command = vi.fn((name: string, opts?: { isDefault?: boolean }) => {
        const cmd = originalCommandMethod(name, opts);
        const originalAction = cmd.action.bind(cmd);
        cmd.action = vi.fn((handler: unknown) => {
          // Store the command and handler
          commands.set(name, { handler, isDefault: opts?.isDefault });
          return originalAction(handler);
        });
        return cmd;
      });

      // Add our custom methods via type assertion
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
  };

  // Mock VersionEngine methods for target testing
  const mockGetWorkspacePackages = vi.fn();
  const mockRun = vi.fn();
  const mockSetStrategy = vi.fn();

  beforeEach(() => {
    // Create a mock process object
    mockProcess = {
      argv: ['node', 'index.js'],
      // Fix Mock type error with appropriate type cast
      exit: vi.fn() as unknown as (code?: number | undefined) => never,
      cwd: vi.fn().mockReturnValue('/test/workspace'),
    };

    // Replace global process
    global.process = mockProcess as NodeJS.Process;

    // Setup mocks
    vi.mocked(configModule.loadConfig, { partial: true }).mockResolvedValue(mockConfig as Config);
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
    // Restore original process
    global.process = originalProcess;

    // Clear mocks
    vi.clearAllMocks();
    mockGetWorkspacePackages.mockClear();
    mockRun.mockClear();
    mockSetStrategy.mockClear();
  });

  it('should define a default command', async () => {
    // Call the run function, which sets up the CLI
    await indexModule.run();

    // Get the commander instance
    const commanderInstance = vi.mocked(Command, { partial: true }).mock.results[0].value;

    // Check if there's a default command defined
    const defaultCommand = commanderInstance.getDefaultCommand();
    expect(defaultCommand).toBe('version');
  });

  it('should execute the version command when no command is specified', async () => {
    // Set argv to simulate CLI without a specific command
    mockProcess.argv = ['node', 'index.js', '--dry-run'];

    // Call the run function
    await indexModule.run();

    // Get the commander instance
    const commanderInstance = vi.mocked(Command, { partial: true }).mock.results[0].value;

    // Check if parse was called
    expect(commanderInstance.parse).toHaveBeenCalled();

    // Verify the command structure
    expect(commanderInstance.getCommands()).toContainEqual(['version', expect.objectContaining({ isDefault: true })]);
  });

  it('should execute the changelog command when explicitly specified', async () => {
    // Set argv to simulate CLI with changelog command
    mockProcess.argv = ['node', 'index.js', 'changelog', '--dry-run'];

    // Call the run function
    await indexModule.run();

    // Get the commander instance
    const commanderInstance = vi.mocked(Command, { partial: true }).mock.results[0].value;

    // Check if parse was called
    expect(commanderInstance.parse).toHaveBeenCalled();

    // Check that changelog command exists
    const commands = commanderInstance.getCommands();
    expect(commands.map(([cmdName]: [string, unknown]) => cmdName)).toContain('changelog');
  });

  describe('CLI Target Handling', () => {
    it('should override config.packages when -t flag is used', async () => {
      // Create a spy to capture the config passed to VersionEngine
      let capturedConfigFromEngine: Config | undefined;

      // Set up the mock BEFORE calling run
      vi.mocked(VersionEngine, { partial: true }).mockImplementation(function (this: unknown, config: Config) {
        capturedConfigFromEngine = config;
        return {
          getWorkspacePackages: mockGetWorkspacePackages,
          run: mockRun,
          setStrategy: mockSetStrategy,
        } as unknown as VersionEngine;
      });

      // Mock the version command handler to capture config changes
      const originalLoadConfig = vi.mocked(configModule.loadConfig, { partial: true });

      originalLoadConfig.mockImplementation(async (_path) => {
        const config = { ...mockConfig } as Config;
        // Simulate the CLI target override logic
        return config;
      });

      // Simulate CLI with target flag
      mockProcess.argv = ['node', 'index.js', '--dry-run', '-t', '@scope/package-a'];

      // Call the run function
      await indexModule.run();

      // Get the commander instance
      const commanderInstance = vi.mocked(Command, { partial: true }).mock.results[0].value;
      const versionHandler = commanderInstance.getCommandHandler('version');

      // Simulate calling the version command handler with target options
      const mockOptions = {
        dryRun: true,
        target: '@scope/package-a',
        json: false,
        projectDir: process.cwd(),
      };

      // Execute the version handler directly with mock options
      await (versionHandler as (options: VersionCommandOptions) => Promise<void>)(mockOptions);

      // Verify that config.packages was overridden with CLI targets
      expect(capturedConfigFromEngine).toBeDefined();
      expect(capturedConfigFromEngine?.packages).toEqual(['@scope/package-a']);
    });

    it('should parse multiple targets from comma-separated string', async () => {
      let capturedConfigFromEngine: Config | undefined;

      // Set up the mock BEFORE calling run
      vi.mocked(VersionEngine, { partial: true }).mockImplementation(function (this: unknown, config: Config) {
        capturedConfigFromEngine = config;
        return {
          getWorkspacePackages: mockGetWorkspacePackages,
          run: mockRun,
          setStrategy: mockSetStrategy,
        } as unknown as VersionEngine;
      });

      // Simulate CLI with multiple targets
      const mockOptions = {
        dryRun: true,
        target: '@scope/package-a,@scope/package-b',
        json: false,
        projectDir: process.cwd(),
      };

      // Get the version command handler
      await indexModule.run();
      const commanderInstance = vi.mocked(Command, { partial: true }).mock.results[0].value;
      const versionHandler = commanderInstance.getCommandHandler('version');

      // Execute the handler
      await (versionHandler as (options: VersionCommandOptions) => Promise<void>)(mockOptions);

      // Verify multiple targets were parsed correctly
      expect(capturedConfigFromEngine).toBeDefined();
      expect(capturedConfigFromEngine?.packages).toEqual(['@scope/package-a', '@scope/package-b']);
    });

    it('should not override config.packages when no -t flag is provided', async () => {
      let capturedConfigFromEngine: Config | undefined;

      // Set up the mock BEFORE calling run
      vi.mocked(VersionEngine, { partial: true }).mockImplementation(function (this: unknown, config: Config) {
        capturedConfigFromEngine = config;
        return {
          getWorkspacePackages: mockGetWorkspacePackages,
          run: mockRun,
          setStrategy: mockSetStrategy,
        } as unknown as VersionEngine;
      });

      // Simulate CLI without target flag
      const mockOptions = {
        dryRun: true,
        json: false,
        projectDir: process.cwd(),
      };

      // Get the version command handler
      await indexModule.run();
      const commanderInstance = vi.mocked(Command, { partial: true }).mock.results[0].value;
      const versionHandler = commanderInstance.getCommandHandler('version');

      // Execute the handler
      await (versionHandler as (options: VersionCommandOptions) => Promise<void>)(mockOptions);

      // Verify original config.packages is preserved
      expect(capturedConfigFromEngine).toBeDefined();
      expect(capturedConfigFromEngine?.packages).toEqual(mockConfig.packages);
    });

    it('should handle empty target string gracefully', async () => {
      let capturedConfigFromEngine: Config | undefined;

      // Set up the mock BEFORE calling run
      vi.mocked(VersionEngine, { partial: true }).mockImplementation(function (this: unknown, config: Config) {
        capturedConfigFromEngine = config;
        return {
          getWorkspacePackages: mockGetWorkspacePackages,
          run: mockRun,
          setStrategy: mockSetStrategy,
        } as unknown as VersionEngine;
      });

      // Simulate CLI with empty target
      const mockOptions = {
        dryRun: true,
        target: '',
        json: false,
        projectDir: process.cwd(),
      };

      // Get the version command handler
      await indexModule.run();
      const commanderInstance = vi.mocked(Command, { partial: true }).mock.results[0].value;
      const versionHandler = commanderInstance.getCommandHandler('version');

      // Execute the handler
      await (versionHandler as (options: VersionCommandOptions) => Promise<void>)(mockOptions);

      // Verify original config.packages is preserved (empty string = no targets)
      expect(capturedConfigFromEngine).toBeDefined();
      expect(capturedConfigFromEngine?.packages).toEqual(mockConfig.packages);
    });
  });
});
