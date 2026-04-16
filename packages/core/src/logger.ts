import chalk from 'chalk';

export type LogLevel = 'error' | 'warn' | 'info' | 'debug' | 'trace';

const LOG_LEVELS: Record<LogLevel, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
  trace: 4,
};

const PREFIXES: Record<LogLevel, string> = {
  error: '[ERROR]',
  warn: '[WARN]',
  info: '[INFO]',
  debug: '[DEBUG]',
  trace: '[TRACE]',
};

const COLORS: Record<LogLevel, (text: string) => string> = {
  error: chalk.red,
  warn: chalk.yellow,
  info: chalk.blue,
  debug: chalk.gray,
  trace: chalk.dim,
};

export interface LoggerOptions {
  level?: LogLevel;
  quiet?: boolean;
  json?: boolean;
}

let currentLevel: LogLevel = 'info';
let quietMode = false;

export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
  if (level === 'debug') {
    process.env.DEBUG = 'true';
  }
}

export function setQuietMode(quiet: boolean): void {
  quietMode = quiet;
}

/**
 * No-op retained for API compatibility.
 * JSON mode no longer suppresses stderr logging — JSON goes to stdout,
 * logs go to stderr, so they don't interfere.
 */
export function setJsonMode(_json: boolean): void {
  // intentionally empty
}

export function getLogLevel(): LogLevel {
  return currentLevel;
}

function shouldLog(level: LogLevel): boolean {
  // JSON mode no longer suppresses stderr logging — JSON output goes to stdout,
  // logs go to stderr, so they don't interfere with each other.
  if (quietMode && level !== 'error') return false;
  // Debug messages are shown when DEBUG env var is set or log level allows it
  if (level === 'debug' && (process.env.DEBUG === 'true' || process.env.DEBUG === '1')) return true;
  return LOG_LEVELS[level] <= LOG_LEVELS[currentLevel];
}

export function log(message: string, level: LogLevel = 'info'): void {
  if (!shouldLog(level)) return;

  const formatted = COLORS[level](`${PREFIXES[level]} ${message}`);

  console.error(formatted);
}

export function error(message: string): void {
  log(message, 'error');
}

export function warn(message: string): void {
  log(message, 'warn');
}

export function info(message: string): void {
  log(message, 'info');
}

export function success(message: string): void {
  if (!shouldLog('info')) return;
  console.error(chalk.green(`[SUCCESS] ${message}`));
}

export function debug(message: string): void {
  log(message, 'debug');
}

export function trace(message: string): void {
  log(message, 'trace');
}
