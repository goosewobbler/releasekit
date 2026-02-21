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
let jsonMode = false;

export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

export function setQuietMode(quiet: boolean): void {
  quietMode = quiet;
}

export function setJsonMode(json: boolean): void {
  jsonMode = json;
}

export function getLogLevel(): LogLevel {
  return currentLevel;
}

function shouldLog(level: LogLevel): boolean {
  if (jsonMode && level !== 'error') return false;
  if (quietMode && level !== 'error') return false;
  return LOG_LEVELS[level] <= LOG_LEVELS[currentLevel];
}

export function log(message: string, level: LogLevel = 'info'): void {
  if (!shouldLog(level)) return;

  const formatted = COLORS[level](`${PREFIXES[level]} ${message}`);

  if (level === 'error') {
    console.error(formatted);
  } else {
    console.log(formatted);
  }
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
  console.log(chalk.green(`[SUCCESS] ${message}`));
}

export function debug(message: string): void {
  log(message, 'debug');
}

export function trace(message: string): void {
  log(message, 'trace');
}
