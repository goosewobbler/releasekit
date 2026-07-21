import { describe, expect, it, vi } from 'vitest';
import { createStandingPRCommand } from '../../src/commands/standing-pr-command.js';

vi.mock('../../src/standing-pr/standing-pr.js', () => ({
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
    const { runStandingPRUpdate } = await import('../../src/standing-pr/standing-pr.js');
    await parseCommand(['update', '--project-dir', '/test']);
    expect(runStandingPRUpdate).toHaveBeenCalledWith(expect.objectContaining({ projectDir: '/test' }));
  });

  it('should call runStandingPRPublish for publish subcommand', async () => {
    const { runStandingPRPublish } = await import('../../src/standing-pr/standing-pr.js');
    await parseCommand(['publish', '--project-dir', '/test']);
    expect(runStandingPRPublish).toHaveBeenCalledWith(expect.objectContaining({ projectDir: '/test' }), undefined);
  });

  it('should pass --pr through to runStandingPRPublish as a number', async () => {
    const { runStandingPRPublish } = await import('../../src/standing-pr/standing-pr.js');
    await parseCommand(['publish', '--project-dir', '/test', '--pr', '189']);
    expect(runStandingPRPublish).toHaveBeenCalledWith(expect.objectContaining({ projectDir: '/test' }), 189);
  });

  it('should reject --pr values with trailing non-digit characters', async () => {
    const { runStandingPRPublish } = await import('../../src/standing-pr/standing-pr.js');
    vi.mocked(runStandingPRPublish).mockClear();
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code})`);
    }) as never);
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      // Exits with INPUT_ERROR (3), not the general error code.
      await expect(parseCommand(['publish', '--project-dir', '/test', '--pr', '123abc'])).rejects.toThrow(
        /process\.exit\(3\)/,
      );
      expect(runStandingPRPublish).not.toHaveBeenCalled();
      expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('positive integer'));
    } finally {
      exitSpy.mockRestore();
      errSpy.mockRestore();
    }
  });

  it('should emit an INPUT_ERROR envelope for an invalid --pr in json mode', async () => {
    const { runStandingPRPublish } = await import('../../src/standing-pr/standing-pr.js');
    vi.mocked(runStandingPRPublish).mockClear();
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code})`);
    }) as never);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await expect(parseCommand(['publish', '--project-dir', '/test', '--json', '--pr', 'abc'])).rejects.toThrow(
        /process\.exit\(3\)/,
      );
      const envelope = JSON.parse(logSpy.mock.calls[0]?.[0] as string);
      expect(envelope.status).toBe('error');
      expect(envelope.errors[0]).toMatchObject({ code: 'INPUT_ERROR', category: 'input', retryable: false });
    } finally {
      exitSpy.mockRestore();
      logSpy.mockRestore();
      errSpy.mockRestore();
    }
  });

  it('should pass --verbose, --quiet, --json flags through', async () => {
    const { runStandingPRUpdate } = await import('../../src/standing-pr/standing-pr.js');
    await parseCommand(['update', '--verbose', '--quiet', '--json']);
    expect(runStandingPRUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ verbose: true, quiet: true, json: true }),
    );
  });

  it('should pass --npm-auth through', async () => {
    const { runStandingPRUpdate } = await import('../../src/standing-pr/standing-pr.js');
    await parseCommand(['update', '--npm-auth', 'oidc']);
    expect(runStandingPRUpdate).toHaveBeenCalledWith(expect.objectContaining({ npmAuth: 'oidc' }));
  });

  it('should pass --config through', async () => {
    const { runStandingPRUpdate } = await import('../../src/standing-pr/standing-pr.js');
    await parseCommand(['update', '--config', '/path/to/config.json']);
    expect(runStandingPRUpdate).toHaveBeenCalledWith(expect.objectContaining({ config: '/path/to/config.json' }));
  });

  it('should pass --reconcile through as reconcile: true', async () => {
    const { runStandingPRUpdate } = await import('../../src/standing-pr/standing-pr.js');
    await parseCommand(['update', '--reconcile']);
    expect(runStandingPRUpdate).toHaveBeenCalledWith(expect.objectContaining({ reconcile: true }));
  });

  it('should default reconcile to false when --reconcile is omitted', async () => {
    const { runStandingPRUpdate } = await import('../../src/standing-pr/standing-pr.js');
    await parseCommand(['update']);
    expect(runStandingPRUpdate).toHaveBeenCalledWith(expect.objectContaining({ reconcile: false }));
  });
});
