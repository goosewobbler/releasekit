import * as cp from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { execAsync, execSync } from '../../../src/git/commandExecutor.js';

// Mock child_process module
vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
  execFileSync: vi.fn(),
}));

describe('commandExecutor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('execAsync', () => {
    it('should execute a command and return stdout and stderr', async () => {
      // Mock successful execution
      vi.mocked(cp.execFile, { partial: true }).mockImplementation(
        (_file: string, _args: any, _options: any, callback?: any) => {
          if (callback) callback(null, 'command output', 'command error output');
          return {} as cp.ChildProcess;
        },
      );

      const result = await execAsync('git', ['log', '--oneline']);

      expect(cp.execFile).toHaveBeenCalledWith(
        'git',
        ['log', '--oneline'],
        expect.objectContaining({ maxBuffer: 1024 * 1024 * 10 }),
        expect.any(Function),
      );
      expect(result).toEqual({ stdout: 'command output', stderr: 'command error output' });
    });

    it('should reject with error when command fails', async () => {
      // Mock failed execution
      const mockError = new Error('Command failed') as cp.ExecFileException;
      (mockError as any).code = 1;

      vi.mocked(cp.execFile, { partial: true }).mockImplementation(
        (_file: string, _args: any, _options: any, callback?: any) => {
          if (callback) callback(mockError, '', '');
          return {} as cp.ChildProcess;
        },
      );

      await expect(execAsync('git', ['failing-cmd'])).rejects.toEqual(mockError);
    });

    it('should pass options to child_process.execFile', async () => {
      // Mock successful execution
      vi.mocked(cp.execFile, { partial: true }).mockImplementation(
        (_file: string, _args: any, _options: any, callback?: any) => {
          if (callback) callback(null, '', '');
          return {} as cp.ChildProcess;
        },
      );

      const options = { cwd: '/some/path', timeout: 1000 };
      await execAsync('git', ['status'], options);

      expect(cp.execFile).toHaveBeenCalledWith(
        'git',
        ['status'],
        expect.objectContaining({
          maxBuffer: 1024 * 1024 * 10,
          cwd: '/some/path',
          timeout: 1000,
        }),
        expect.any(Function),
      );
    });
  });

  describe('execSync', () => {
    it('should execute a command synchronously and return result', () => {
      vi.mocked(cp.execFileSync, { partial: true }).mockReturnValue(Buffer.from('sync output'));

      const result = execSync('git', ['status']);

      expect(cp.execFileSync).toHaveBeenCalledWith(
        'git',
        ['status'],
        expect.objectContaining({ maxBuffer: 1024 * 1024 * 10 }),
      );
      expect(result).toEqual(Buffer.from('sync output'));
    });

    it('should pass options to child_process.execFileSync', () => {
      vi.mocked(cp.execFileSync, { partial: true }).mockReturnValue(Buffer.from(''));

      execSync('git', ['log'], { cwd: '/custom/path' });

      expect(cp.execFileSync).toHaveBeenCalledWith(
        'git',
        ['log'],
        expect.objectContaining({
          maxBuffer: 1024 * 1024 * 10,
          cwd: '/custom/path',
        }),
      );
    });

    it('should throw error when execFileSync throws', () => {
      const syncError = new Error('Sync command failed');
      vi.mocked(cp.execFileSync, { partial: true }).mockImplementation(() => {
        throw syncError;
      });

      expect(() => execSync('git', ['failing-sync'])).toThrow(syncError);
    });
  });
});
