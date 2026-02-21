import * as cp from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { execAsync, execSync } from '../../../src/git/commandExecutor.js';

// Mock child_process module
vi.mock('node:child_process', () => ({
  exec: vi.fn(),
  execSync: vi.fn(),
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
      vi.mocked(cp.exec, { partial: true }).mockImplementation(
        (
          _command: string,
          _options: cp.ExecOptions | null | undefined,
          callback?: (error: cp.ExecException | null, stdout: string | Buffer, stderr: string | Buffer) => void,
        ) => {
          if (callback) callback(null, 'command output', 'command error output');
          return {} as cp.ChildProcess;
        },
      );

      const result = await execAsync('test command');

      expect(cp.exec).toHaveBeenCalledWith(
        'test command',
        expect.objectContaining({ maxBuffer: 1024 * 1024 * 10 }),
        expect.any(Function),
      );
      expect(result).toEqual({ stdout: 'command output', stderr: 'command error output' });
    });

    it('should reject with error when command fails', async () => {
      // Mock failed execution
      const mockError: cp.ExecException = {
        name: 'Error',
        message: 'Command failed',
        code: 1,
      };

      vi.mocked(cp.exec, { partial: true }).mockImplementation(
        (
          _command: string,
          _options: cp.ExecOptions | null | undefined,
          callback?: (error: cp.ExecException | null, stdout: string | Buffer, stderr: string | Buffer) => void,
        ) => {
          if (callback) callback(mockError, '', '');
          return {} as cp.ChildProcess;
        },
      );

      await expect(execAsync('failing command')).rejects.toEqual(mockError);
    });

    it('should pass options to child_process.exec', async () => {
      // Mock successful execution
      vi.mocked(cp.exec, { partial: true }).mockImplementation(
        (
          _command: string,
          _options: cp.ExecOptions | null | undefined,
          callback?: (error: cp.ExecException | null, stdout: string | Buffer, stderr: string | Buffer) => void,
        ) => {
          if (callback) callback(null, '', '');
          return {} as cp.ChildProcess;
        },
      );

      const options = { cwd: '/some/path', timeout: 1000 };
      await execAsync('test command', options);

      expect(cp.exec).toHaveBeenCalledWith(
        'test command',
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
      vi.mocked(cp.execSync, { partial: true }).mockReturnValue(Buffer.from('sync output'));

      const result = execSync('sync command');

      expect(cp.execSync).toHaveBeenCalledWith(
        'sync command',
        expect.objectContaining({ maxBuffer: 1024 * 1024 * 10 }),
      );
      expect(result).toEqual(Buffer.from('sync output'));
    });

    it('should pass options to child_process.execSync', () => {
      vi.mocked(cp.execSync, { partial: true }).mockReturnValue(Buffer.from(''));

      execSync('sync command', { cwd: '/custom/path' });

      expect(cp.execSync).toHaveBeenCalledWith(
        'sync command',
        expect.objectContaining({
          maxBuffer: 1024 * 1024 * 10,
          cwd: '/custom/path',
        }),
      );
    });

    it('should throw error when execSync throws', () => {
      const syncError = new Error('Sync command failed');
      vi.mocked(cp.execSync, { partial: true }).mockImplementation(() => {
        throw syncError;
      });

      expect(() => execSync('failing sync command')).toThrow(syncError);
    });
  });
});
