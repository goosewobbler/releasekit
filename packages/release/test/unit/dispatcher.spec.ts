import { describe, expect, it, vi } from 'vitest';

vi.mock('@releasekit/notes/cli');
vi.mock('@releasekit/publish/cli');
vi.mock('@releasekit/version/cli');
vi.mock('../../src/preview-command.js');

import { createNotesCommand } from '@releasekit/notes/cli';
import { createPublishCommand } from '@releasekit/publish/cli';
import { createVersionCommand } from '@releasekit/version/cli';
import { Command } from 'commander';
import { createDispatcherProgram } from '../../src/dispatcher.js';
import { createPreviewCommand } from '../../src/preview-command.js';

vi.mocked(createNotesCommand).mockReturnValue(new Command('notes').description('notes'));
vi.mocked(createPublishCommand).mockReturnValue(new Command('publish').description('publish'));
vi.mocked(createVersionCommand).mockReturnValue(new Command('version').description('version'));
vi.mocked(createPreviewCommand).mockReturnValue(new Command('preview').description('preview'));

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

  it('should have preview as the default command', () => {
    const program = createDispatcherProgram();
    expect((program as unknown as { _defaultCommandName: string })._defaultCommandName).toBe('preview');
  });
});
