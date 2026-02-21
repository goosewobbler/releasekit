import chalk from 'chalk';
import figlet from 'figlet';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as jsonOutput from '../../../src/utils/jsonOutput.js';
import { log, printFiglet } from '../../../src/utils/logging.js';

// Mock dependencies
vi.mock('../../../src/utils/jsonOutput.js');
vi.mock('chalk', () => ({
  default: {
    blue: vi.fn((text) => `BLUE:${text}`),
    green: vi.fn((text) => `GREEN:${text}`),
    yellow: vi.fn((text) => `YELLOW:${text}`),
    red: vi.fn((text) => `RED:${text}`),
    gray: vi.fn((text) => `GRAY:${text}`),
  },
}));
vi.mock('figlet', () => ({
  default: {
    textSync: vi.fn(() => 'FIGLET_BANNER'),
  },
}));

describe('Logging Utilities', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(jsonOutput.isJsonOutputMode, { partial: true }).mockReturnValue(false);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('printFiglet', () => {
    it('should print a figlet banner', () => {
      printFiglet('Test Banner');

      expect(figlet.textSync).toHaveBeenCalledWith('Test Banner', expect.any(Object));
      expect(chalk.yellow).toHaveBeenCalledWith('FIGLET_BANNER');
      expect(console.log).toHaveBeenCalled();
    });

    it('should not print banner when in JSON output mode', () => {
      vi.mocked(jsonOutput.isJsonOutputMode, { partial: true }).mockReturnValue(true);

      printFiglet('Test Banner');

      expect(figlet.textSync).not.toHaveBeenCalled();
      expect(console.log).not.toHaveBeenCalled();
    });
  });

  describe('log', () => {
    it('should log message with default info (blue) color', () => {
      log('Test message');

      expect(chalk.blue).toHaveBeenCalledWith('Test message');
      expect(console.log).toHaveBeenCalledWith('BLUE:Test message');
    });

    it('should log success message with green color', () => {
      log('Success message', 'success');

      expect(chalk.green).toHaveBeenCalledWith('Success message');
      expect(console.log).toHaveBeenCalledWith('GREEN:Success message');
    });

    it('should log warning message with yellow color', () => {
      log('Warning message', 'warning');

      expect(chalk.yellow).toHaveBeenCalledWith('Warning message');
      expect(console.log).toHaveBeenCalledWith('YELLOW:Warning message');
    });

    it('should log error message with red color', () => {
      log('Error message', 'error');

      expect(chalk.red).toHaveBeenCalledWith('Error message');
      expect(console.error).toHaveBeenCalledWith('RED:Error message');
    });

    it('should log debug message with gray color', () => {
      // Set DEBUG to true to ensure debug messages are shown
      const originalDebug = process.env.DEBUG;
      process.env.DEBUG = 'true';

      log('Debug message', 'debug');

      expect(chalk.gray).toHaveBeenCalledWith('[DEBUG] Debug message');
      expect(console.log).toHaveBeenCalledWith('GRAY:[DEBUG] Debug message');

      // Restore original DEBUG value
      process.env.DEBUG = originalDebug;
    });

    it('should not log non-error messages when in JSON output mode', () => {
      vi.mocked(jsonOutput.isJsonOutputMode, { partial: true }).mockReturnValue(true);

      log('Info message', 'info');

      expect(console.log).not.toHaveBeenCalled();
      expect(console.error).not.toHaveBeenCalled();
    });

    it('should log error messages even when in JSON output mode', () => {
      vi.mocked(jsonOutput.isJsonOutputMode, { partial: true }).mockReturnValue(true);

      log('Error message', 'error');

      expect(chalk.red).toHaveBeenCalledWith('Error message');
      expect(console.error).toHaveBeenCalledWith('Error message');
    });
  });
});
