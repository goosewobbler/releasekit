import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@releasekit/core');
vi.mock('../../src/release.js');

import { EXIT_CODES } from '@releasekit/core';
import { runRelease } from '../../src/release.js';
import { createReleaseCommand } from '../../src/release-command.js';
import type { ReleaseOptions, ReleaseOutput } from '../../src/types.js';

const mockOutput: ReleaseOutput = {
  versionOutput: { dryRun: false, updates: [], changelogs: [], tags: [] },
  notesGenerated: false,
};

describe('createReleaseCommand', () => {
  let mockExit: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.mocked(runRelease).mockResolvedValue(mockOutput);
    mockExit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
  });

  afterEach(() => {
    vi.clearAllMocks();
    mockExit.mockRestore();
  });

  it('should return a command named release', () => {
    expect(createReleaseCommand().name()).toBe('release');
  });

  it('should call runRelease when parsed', async () => {
    await createReleaseCommand().parseAsync(['node', 'test']);
    expect(runRelease).toHaveBeenCalled();
  });

  describe('option → ReleaseOptions mapping', () => {
    function capturedOptions(): ReleaseOptions {
      return vi.mocked(runRelease).mock.calls[0][0];
    }

    it('should pass dryRun: true when --dry-run is set', async () => {
      await createReleaseCommand().parseAsync(['node', 'test', '--dry-run']);
      expect(capturedOptions().dryRun).toBe(true);
    });

    it('should pass dryRun: false by default', async () => {
      await createReleaseCommand().parseAsync(['node', 'test']);
      expect(capturedOptions().dryRun).toBe(false);
    });

    it('should pass bump when --bump is set', async () => {
      await createReleaseCommand().parseAsync(['node', 'test', '--bump', 'minor']);
      expect(capturedOptions().bump).toBe('minor');
    });

    it('should pass prerelease identifier when --prerelease <id> is set', async () => {
      await createReleaseCommand().parseAsync(['node', 'test', '--prerelease', 'beta']);
      expect(capturedOptions().prerelease).toBe('beta');
    });

    it('should pass prerelease: true when --prerelease is set without a value', async () => {
      await createReleaseCommand().parseAsync(['node', 'test', '--prerelease']);
      expect(capturedOptions().prerelease).toBe(true);
    });

    it('should pass sync: true when --sync is set', async () => {
      await createReleaseCommand().parseAsync(['node', 'test', '--sync']);
      expect(capturedOptions().sync).toBe(true);
    });

    it('should pass target when --target is set', async () => {
      await createReleaseCommand().parseAsync(['node', 'test', '--target', 'pkg-a,pkg-b']);
      expect(capturedOptions().target).toBe('pkg-a,pkg-b');
    });

    it('should pass branch when --branch is set', async () => {
      await createReleaseCommand().parseAsync(['node', 'test', '--branch', 'develop']);
      expect(capturedOptions().branch).toBe('develop');
    });

    it('should pass branch: undefined when --branch is not set', async () => {
      await createReleaseCommand().parseAsync(['node', 'test']);
      expect(capturedOptions().branch).toBeUndefined();
    });

    it('should pass npmAuth: auto by default', async () => {
      await createReleaseCommand().parseAsync(['node', 'test']);
      expect(capturedOptions().npmAuth).toBe('auto');
    });

    it('should pass npmAuth when --npm-auth is set', async () => {
      await createReleaseCommand().parseAsync(['node', 'test', '--npm-auth', 'oidc']);
      expect(capturedOptions().npmAuth).toBe('oidc');
    });

    it('should reject invalid --npm-auth value', async () => {
      await expect(createReleaseCommand().parseAsync(['node', 'test', '--npm-auth', 'invalid'])).rejects.toThrow();
    });

    it.each([
      ['--skip-notes', 'skipNotes'],
      ['--skip-publish', 'skipPublish'],
      ['--skip-git', 'skipGit'],
      ['--skip-github-release', 'skipGithubRelease'],
      ['--skip-verification', 'skipVerification'],
    ] as const)('%s sets %s: true', async (flag, key) => {
      await createReleaseCommand().parseAsync(['node', 'test', flag]);
      expect(capturedOptions()[key]).toBe(true);
    });

    it('should pass json: true when --json is set', async () => {
      await createReleaseCommand().parseAsync(['node', 'test', '--json']);
      expect(capturedOptions().json).toBe(true);
    });

    it('should pass verbose: true when --verbose is set', async () => {
      await createReleaseCommand().parseAsync(['node', 'test', '--verbose']);
      expect(capturedOptions().verbose).toBe(true);
    });

    it('should pass quiet: true when --quiet is set', async () => {
      await createReleaseCommand().parseAsync(['node', 'test', '--quiet']);
      expect(capturedOptions().quiet).toBe(true);
    });
  });

  describe('JSON output', () => {
    it('should print result as JSON when --json is passed and runRelease returns output', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
      await createReleaseCommand().parseAsync(['node', 'test', '--json']);
      expect(consoleSpy).toHaveBeenCalledWith(JSON.stringify(mockOutput, null, 2));
      consoleSpy.mockRestore();
    });

    it('should not print JSON when --json is not passed', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
      await createReleaseCommand().parseAsync(['node', 'test']);
      expect(consoleSpy).not.toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('should not print JSON when runRelease returns null', async () => {
      vi.mocked(runRelease).mockResolvedValue(null);
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
      await createReleaseCommand().parseAsync(['node', 'test', '--json']);
      expect(consoleSpy).not.toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe('exit behaviour', () => {
    it('should exit 0 when runRelease returns null (no releasable changes)', async () => {
      vi.mocked(runRelease).mockResolvedValue(null);
      await createReleaseCommand().parseAsync(['node', 'test']);
      expect(mockExit).toHaveBeenCalledWith(0);
    });

    it('should not exit when runRelease returns output', async () => {
      await createReleaseCommand().parseAsync(['node', 'test']);
      expect(mockExit).not.toHaveBeenCalled();
    });

    it('should log error message and exit with GENERAL_ERROR when runRelease throws', async () => {
      vi.mocked(runRelease).mockRejectedValue(new Error('pipeline failed'));
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      await createReleaseCommand().parseAsync(['node', 'test']);
      expect(consoleSpy).toHaveBeenCalledWith('pipeline failed');
      expect(mockExit).toHaveBeenCalledWith(EXIT_CODES.GENERAL_ERROR);
      consoleSpy.mockRestore();
    });

    it('should stringify non-Error throws', async () => {
      vi.mocked(runRelease).mockRejectedValue('string error');
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      await createReleaseCommand().parseAsync(['node', 'test']);
      expect(consoleSpy).toHaveBeenCalledWith('string error');
      consoleSpy.mockRestore();
    });
  });
});
