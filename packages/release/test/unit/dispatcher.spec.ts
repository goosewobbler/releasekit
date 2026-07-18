import { describe, expect, it, vi } from 'vitest';

vi.mock('@releasekit/notes/cli');
vi.mock('@releasekit/publish/cli');
vi.mock('@releasekit/version/cli');
vi.mock('../../src/commands/preview-command.js');
vi.mock('../../src/commands/refresh-after-release-command.js');

import { createNotesCommand } from '@releasekit/notes/cli';
import { createPublishCommand } from '@releasekit/publish/cli';
import { createVersionCommand } from '@releasekit/version/cli';
import { Command } from 'commander';
import { createReleaseProgram } from '../../src/cli.js';
import { createPreviewCommand } from '../../src/commands/preview-command.js';
import { createRefreshAfterReleaseCommand } from '../../src/commands/refresh-after-release-command.js';
import { createDispatcherProgram } from '../../src/dispatcher.js';

vi.mocked(createNotesCommand).mockReturnValue(new Command('notes').description('notes'));
vi.mocked(createPublishCommand).mockReturnValue(new Command('publish').description('publish'));
vi.mocked(createVersionCommand).mockReturnValue(new Command('version').description('version'));
// exitOverride so an accidental route to preview (the default command) throws a catchable error
// instead of process.exit()-ing the test worker — see the routing smoke test below.
vi.mocked(createPreviewCommand).mockReturnValue(new Command('preview').description('preview').exitOverride());
// No-op action so routing to it in the smoke test doesn't run the real post-release reconcile.
vi.mocked(createRefreshAfterReleaseCommand).mockReturnValue(
  new Command('refresh-after-release').description('refresh-after-release').action(() => {}),
);

describe('createDispatcherProgram', () => {
  it('should be named releasekit', () => {
    const program = createDispatcherProgram();
    expect(program.name()).toBe('releasekit');
  });

  it('should register the release command', () => {
    const program = createDispatcherProgram();
    const cmd = program.commands.find((c) => c.name() === 'release');
    expect(cmd).toBeDefined();
  });

  it('should register the version command', () => {
    const program = createDispatcherProgram();
    const cmd = program.commands.find((c) => c.name() === 'version');
    expect(cmd).toBeDefined();
  });

  it('should register the notes command', () => {
    const program = createDispatcherProgram();
    const cmd = program.commands.find((c) => c.name() === 'notes');
    expect(cmd).toBeDefined();
  });

  it('should register the publish command', () => {
    const program = createDispatcherProgram();
    const cmd = program.commands.find((c) => c.name() === 'publish');
    expect(cmd).toBeDefined();
  });

  it('should register the preview command', () => {
    const program = createDispatcherProgram();
    const cmd = program.commands.find((c) => c.name() === 'preview');
    expect(cmd).toBeDefined();
  });

  it('should register the labels command', () => {
    const program = createDispatcherProgram();
    const cmd = program.commands.find((c) => c.name() === 'labels');
    expect(cmd).toBeDefined();
  });

  it('should register the init command', () => {
    const program = createDispatcherProgram();
    const cmd = program.commands.find((c) => c.name() === 'init');
    expect(cmd).toBeDefined();
  });

  it('should register the gate command', () => {
    const program = createDispatcherProgram();
    const cmd = program.commands.find((c) => c.name() === 'gate');
    expect(cmd).toBeDefined();
  });

  it('should register the refresh-after-release command', () => {
    const program = createDispatcherProgram();
    const cmd = program.commands.find((c) => c.name() === 'refresh-after-release');
    expect(cmd).toBeDefined();
  });

  it('should register the backfill command', () => {
    const program = createDispatcherProgram();
    const cmd = program.commands.find((c) => c.name() === 'backfill');
    expect(cmd).toBeDefined();
  });

  it('should have preview as the default command', () => {
    const program = createDispatcherProgram();
    expect((program as unknown as { _defaultCommandName: string })._defaultCommandName).toBe('preview');
  });

  // Durable drift guard: the public `releasekit` bin (dispatcher) must expose every release-domain
  // command the `releasekit-release` bin does, or `releasekit <cmd>` silently routes to the default
  // `preview` command (#519). Registering a new command in cli.ts without the dispatcher trips this.
  it('should expose every release-domain command the release CLI does', () => {
    const dispatcher = new Set(createDispatcherProgram().commands.map((c) => c.name()));
    const releaseCli = createReleaseProgram().commands.map((c) => c.name());
    // No command is intentionally CLI-only today; add a name here (with a reason) only if that changes.
    const INTENTIONALLY_CLI_ONLY = new Set<string>([]);
    const missing = releaseCli.filter((n) => !dispatcher.has(n) && !INTENTIONALLY_CLI_ONLY.has(n));
    expect(missing).toEqual([]);
  });

  it('should route `refresh-after-release` to its own command, not the default preview', () => {
    // The reported symptom (#519): an unregistered command falls through to the default `preview`, which
    // rejects the stray positional. preview is mocked with exitOverride and refresh with a no-op action
    // (both above), so a misroute throws instead of exiting — a clean parse proves correct routing.
    const program = createDispatcherProgram().exitOverride();
    expect(() => program.parse(['refresh-after-release'], { from: 'user' })).not.toThrow();
  });
});
