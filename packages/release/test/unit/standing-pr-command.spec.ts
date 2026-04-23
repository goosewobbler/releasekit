import { describe, expect, it, vi } from 'vitest';
import { createStandingPRCommand } from '../../src/standing-pr-command.js';

vi.mock('../../src/standing-pr.js', () => ({
  runStandingPRUpdate: vi.fn().mockResolvedValue({ action: 'noop' }),
  runStandingPRPublish: vi.fn().mockResolvedValue(null),
}));

async function parseCommand(argv: string[]) {
  const program = createStandingPRCommand();
  // Prevent commander from calling process.exit
  program.exitOverride();
  // Use { from: 'user' } with argv-only (no node/script prefix)
  await program.parseAsync(argv, { from: 'user' });
  return program;
}

describe('createStandingPRCommand', () => {
  it('should create a command named standing-pr', () => {
    const cmd = createStandingPRCommand();
    expect(cmd.name()).toBe('standing-pr');
  });

  it('should have update and publish subcommands', () => {
    const cmd = createStandingPRCommand();
    const names = cmd.commands.map((c) => c.name());
    expect(names).toContain('update');
    expect(names).toContain('publish');
  });

  it('should call runStandingPRUpdate for update subcommand', async () => {
    const { runStandingPRUpdate } = await import('../../src/standing-pr.js');
    await parseCommand(['update', '--project-dir', '/test']);
    expect(runStandingPRUpdate).toHaveBeenCalledWith(expect.objectContaining({ projectDir: '/test' }));
  });

  it('should call runStandingPRPublish for publish subcommand', async () => {
    const { runStandingPRPublish } = await import('../../src/standing-pr.js');
    await parseCommand(['publish', '--project-dir', '/test']);
    expect(runStandingPRPublish).toHaveBeenCalledWith(expect.objectContaining({ projectDir: '/test' }));
  });

  it('should pass --verbose, --quiet, --json flags through', async () => {
    const { runStandingPRUpdate } = await import('../../src/standing-pr.js');
    await parseCommand(['update', '--verbose', '--quiet', '--json']);
    expect(runStandingPRUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ verbose: true, quiet: true, json: true }),
    );
  });

  it('should pass --npm-auth through', async () => {
    const { runStandingPRUpdate } = await import('../../src/standing-pr.js');
    await parseCommand(['update', '--npm-auth', 'oidc']);
    expect(runStandingPRUpdate).toHaveBeenCalledWith(expect.objectContaining({ npmAuth: 'oidc' }));
  });

  it('should pass --config through', async () => {
    const { runStandingPRUpdate } = await import('../../src/standing-pr.js');
    await parseCommand(['update', '--config', '/path/to/config.json']);
    expect(runStandingPRUpdate).toHaveBeenCalledWith(expect.objectContaining({ config: '/path/to/config.json' }));
  });
});
