import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LogLevel } from '../../src/logger.js';
import {
  debug,
  error,
  getLogLevel,
  info,
  log,
  setJsonMode,
  setLogLevel,
  setQuietMode,
  success,
  trace,
  warn,
} from '../../src/logger.js';

describe('logger', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    setLogLevel('info');
    setQuietMode(false);
    setJsonMode(false);
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('setLogLevel / getLogLevel', () => {
    it('should set and gets log level', () => {
      setLogLevel('debug');
      expect(getLogLevel()).toBe('debug');
    });

    it('can set all log levels', () => {
      const levels: LogLevel[] = ['error', 'warn', 'info', 'debug', 'trace'];
      for (const level of levels) {
        setLogLevel(level);
        expect(getLogLevel()).toBe(level);
      }
    });
  });

  describe('setQuietMode', () => {
    it('should suppress non-error messages when true', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      setQuietMode(true);
      info('This should not appear');

      expect(consoleSpy).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it('still shows errors in quiet mode', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      setQuietMode(true);
      error('This should appear');

      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });

  describe('setJsonMode', () => {
    it('still logs non-error messages to stderr in json mode', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      setJsonMode(true);
      info('This should appear on stderr');

      expect(consoleSpy).toHaveBeenCalled();
      expect(consoleSpy.mock.calls[0]?.[0]).toContain('This should appear on stderr');

      consoleSpy.mockRestore();
    });

    it('still shows errors in json mode', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      setJsonMode(true);
      error('This should appear');

      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });

  describe('log', () => {
    it('logs to console.log for non-error levels', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      log('Test message', 'info');

      expect(consoleSpy).toHaveBeenCalled();
      expect(consoleSpy.mock.calls[0]?.[0]).toContain('[INFO]');
      expect(consoleSpy.mock.calls[0]?.[0]).toContain('Test message');

      consoleSpy.mockRestore();
    });

    it('logs to console.error for error level', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      log('Error message', 'error');

      expect(consoleSpy).toHaveBeenCalled();
      expect(consoleSpy.mock.calls[0]?.[0]).toContain('[ERROR]');

      consoleSpy.mockRestore();
    });

    it('should respect log level hierarchy', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      setLogLevel('warn');
      info('This should not appear');
      warn('This should appear');

      expect(consoleSpy).toHaveBeenCalledTimes(1);
      expect(consoleSpy.mock.calls[0]?.[0]).toContain('[WARN]');

      consoleSpy.mockRestore();
    });

    it('defaults to info level', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      log('Default level message');

      expect(consoleSpy).toHaveBeenCalled();
      expect(consoleSpy.mock.calls[0]?.[0]).toContain('[INFO]');

      consoleSpy.mockRestore();
    });
  });

  describe('convenience functions', () => {
    it('error logs with error level', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      error('Error message');

      expect(consoleSpy).toHaveBeenCalled();
      expect(consoleSpy.mock.calls[0]?.[0]).toContain('[ERROR]');

      consoleSpy.mockRestore();
    });

    it('warn logs with warn level', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      warn('Warn message');

      expect(consoleSpy).toHaveBeenCalled();
      expect(consoleSpy.mock.calls[0]?.[0]).toContain('[WARN]');

      consoleSpy.mockRestore();
    });

    it('info logs with info level', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      info('Info message');

      expect(consoleSpy).toHaveBeenCalled();
      expect(consoleSpy.mock.calls[0]?.[0]).toContain('[INFO]');

      consoleSpy.mockRestore();
    });

    it('success logs with [SUCCESS] prefix', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      success('Operation completed');

      expect(consoleSpy).toHaveBeenCalled();
      expect(consoleSpy.mock.calls[0]?.[0]).toContain('[SUCCESS]');
      expect(consoleSpy.mock.calls[0]?.[0]).toContain('Operation completed');

      consoleSpy.mockRestore();
    });

    it('debug logs with debug level', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      setLogLevel('debug');
      debug('Debug message');

      expect(consoleSpy).toHaveBeenCalled();
      expect(consoleSpy.mock.calls[0]?.[0]).toContain('[DEBUG]');

      consoleSpy.mockRestore();
    });

    it('trace logs with trace level', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      setLogLevel('trace');
      trace('Trace message');

      expect(consoleSpy).toHaveBeenCalled();
      expect(consoleSpy.mock.calls[0]?.[0]).toContain('[TRACE]');

      consoleSpy.mockRestore();
    });

    it('success respects quiet mode', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      setQuietMode(true);
      success('This should not appear');

      expect(consoleSpy).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it('success respects log level filtering', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      setLogLevel('warn');
      success('This should not appear');

      expect(consoleSpy).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });
});
