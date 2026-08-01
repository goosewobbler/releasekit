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

  // The manifest's versionOutput.updates is populated on every publish run, so it can't distinguish a
  // real publish from an idempotent re-run — `changed` has to come from the publish effects.
  describe('publish changed reporting', () => {
    const manifestVersionOutput = {
      dryRun: false,
      updates: [{ packageName: '@acme/widget', currentVersion: '1.4.2', newVersion: '2.0.0', bumpType: 'major' }],
      changelogs: [],
      tags: ['v2.0.0'],
    };
    const npmResult = { packageName: '@acme/widget', version: '2.0.0', registry: 'npm', success: true };

    async function publishEnvelope(publishOutput: unknown) {
      const { runStandingPRPublish } = await import('../../src/standing-pr/standing-pr.js');
      vi.mocked(runStandingPRPublish).mockResolvedValueOnce({
        versionOutput: manifestVersionOutput,
        notesGenerated: false,
        publishOutput,
      } as never);
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      try {
        await parseCommand(['publish', '--project-dir', '/test', '--json', '--pr', '189']);
        return JSON.parse(logSpy.mock.calls[0]?.[0] as string);
      } finally {
        logSpy.mockRestore();
      }
    }

    it('should report changed:true when a package actually published', async () => {
      const envelope = await publishEnvelope({
        dryRun: false,
        git: { committed: false, tags: ['v2.0.0'], pushed: true },
        npm: [{ ...npmResult, skipped: false }],
        cargo: [],
        pub: [],
        verification: [],
        githubReleases: [],
        publishSucceeded: true,
      });
      expect(envelope.status).toBe('success');
      expect(envelope.changed).toBe(true);
    });

    it('should report changed:false when every version was already published', async () => {
      const envelope = await publishEnvelope({
        dryRun: false,
        // Tags pushed and the GitHub release "succeeded" (it already existed) — neither is a change.
        git: { committed: false, tags: ['v2.0.0'], pushed: true },
        npm: [{ ...npmResult, skipped: true, alreadyPublished: true }],
        cargo: [],
        pub: [],
        verification: [],
        githubReleases: [{ tag: 'v2.0.0', draft: false, prerelease: false, success: true }],
        publishSucceeded: true,
      });
      expect(envelope.status).toBe('success');
      expect(envelope.changed).toBe(false);
      // The manifest payload still rides along untouched — the envelope wraps, never replaces.
      expect(envelope.data.versionOutput.updates).toHaveLength(1);
    });
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
