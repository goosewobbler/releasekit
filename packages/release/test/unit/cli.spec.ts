import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/release-command.js');

import { Command } from 'commander';
import { createReleaseProgram } from '../../src/cli.js';
import { createReleaseCommand } from '../../src/release-command.js';

vi.mocked(createReleaseCommand).mockReturnValue(new Command('release').description('release'));

describe('createReleaseProgram', () => {
  it('should be named releasekit-release', () => {
    expect(createReleaseProgram().name()).toBe('releasekit-release');
  });

  it('should have release as the default subcommand', () => {
    const program = createReleaseProgram();
    expect((program as unknown as { _defaultCommandName: string })._defaultCommandName).toBe('release');
  });
});
