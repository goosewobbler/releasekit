import { beforeEach, describe, expect, it, vi } from 'vitest';
import { execCommand, execCommandSafe } from '../../../src/utils/exec.js';

vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}));

describe('exec utils', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('execCommand', () => {
    it('should return empty result in dry-run mode without executing', async () => {
      const { execFile } = await import('node:child_process');

      const result = await execCommand('echo', ['hello'], { dryRun: true, label: 'test command' });

      expect(result).toEqual({ stdout: '', stderr: '', exitCode: 0 });
      expect(execFile).not.toHaveBeenCalled();
    });

    it('should execute command and return result', async () => {
      const { execFile } = await import('node:child_process');
      vi.mocked(execFile).mockImplementation((_file, _args, _opts, cb) => {
        (cb as (...args: unknown[]) => void)(null, 'output', '');
        return {} as ReturnType<typeof execFile>;
      });

      const result = await execCommand('echo', ['hello']);

      expect(result).toEqual({ stdout: 'output', stderr: '', exitCode: 0 });
    });

    it('should reject on command failure', async () => {
      const { execFile } = await import('node:child_process');
      vi.mocked(execFile).mockImplementation((_file, _args, _opts, cb) => {
        (cb as (...args: unknown[]) => void)(new Error('command failed'), '', 'error output');
        return {} as ReturnType<typeof execFile>;
      });

      await expect(execCommand('bad', ['command'])).rejects.toThrow('command failed');
    });

    it('should pass cwd and env options', async () => {
      const { execFile } = await import('node:child_process');
      vi.mocked(execFile).mockImplementation((_file, _args, _opts, cb) => {
        (cb as (...args: unknown[]) => void)(null, JSON.stringify(_opts), '');
        return {} as ReturnType<typeof execFile>;
      });

      await execCommand('test', [], { cwd: '/tmp', env: { FOO: 'bar' } });

      expect(execFile).toHaveBeenCalledWith('test', [], expect.objectContaining({ cwd: '/tmp' }), expect.any(Function));
    });
  });

  describe('execCommandSafe', () => {
    it('should return result on success', async () => {
      const { execFile } = await import('node:child_process');
      vi.mocked(execFile).mockImplementation((_file, _args, _opts, cb) => {
        (cb as (...args: unknown[]) => void)(null, 'ok', '');
        return {} as ReturnType<typeof execFile>;
      });

      const result = await execCommandSafe('echo', ['ok']);
      expect(result).toEqual({ stdout: 'ok', stderr: '', exitCode: 0 });
    });

    it('should catch errors and return them as result', async () => {
      const { execFile } = await import('node:child_process');
      vi.mocked(execFile).mockImplementation((_file, _args, _opts, cb) => {
        const err = Object.assign(new Error('fail'), { stdout: '', stderr: 'err', exitCode: 1 });
        (cb as (...args: unknown[]) => void)(err, '', 'err');
        return {} as ReturnType<typeof execFile>;
      });

      const result = await execCommandSafe('bad', ['cmd']);
      expect(result.exitCode).toBe(1);
    });
  });
});
