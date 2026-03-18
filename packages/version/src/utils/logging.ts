/**
 * Logging utilities for releasekit-version
 */

import chalk from 'chalk';
import figlet from 'figlet';
import { isJsonOutputMode } from './jsonOutput.js';

/**
 * Print a figlet banner
 */
export function printFiglet(text: string): void {
  if (isJsonOutputMode()) return;

  console.log(
    chalk.yellow(
      figlet.textSync(text, {
        font: 'Standard',
        horizontalLayout: 'default',
        verticalLayout: 'default',
      }),
    ),
  );
}

/**
 * Log level type
 */
export type LogLevel = 'info' | 'success' | 'warning' | 'error' | 'debug';

/**
 * Format and output log messages
 * @param message Message to log
 * @param level Log level (info, success, warning, error, debug)
 */
export function log(message: string, level: LogLevel = 'info'): void {
  // Debug messages are only shown when DEBUG env var is set
  const showDebug = process.env.DEBUG === 'true' || process.env.DEBUG === '1';

  if (level === 'debug' && !showDebug) {
    return;
  }

  let chalkFn: (text: string) => string;

  switch (level) {
    case 'success':
      chalkFn = chalk.green;
      break;
    case 'warning':
      chalkFn = chalk.yellow;
      break;
    case 'error':
      chalkFn = chalk.red;
      break;
    case 'debug':
      chalkFn = chalk.gray;
      break;
    default:
      chalkFn = chalk.blue;
  }

  const formattedMessage = level === 'debug' ? `[DEBUG] ${message}` : message;

  // In JSON mode, send all logs to stderr so they don't pollute JSON stdout
  if (isJsonOutputMode()) {
    console.error(chalkFn(formattedMessage));
    return;
  }

  // In non-JSON mode, output errors to stderr, other logs to stdout
  if (level === 'error') {
    console.error(chalkFn(formattedMessage));
  } else {
    console.log(chalkFn(formattedMessage));
  }
}
