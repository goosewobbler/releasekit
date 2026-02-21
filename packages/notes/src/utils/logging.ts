import chalk from 'chalk';

export type LogLevelName = 'error' | 'warn' | 'info' | 'debug' | 'trace';

const LOG_LEVELS: Record<LogLevelName, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
  trace: 4,
};

let currentLevel: LogLevelName = 'error';
let quietMode = false;

export function setLogLevel(level: LogLevelName): void {
  currentLevel = level;
}

export function setQuietMode(quiet: boolean): void {
  quietMode = quiet;
}

export function getLogLevel(): LogLevelName {
  return currentLevel;
}

function shouldLog(level: LogLevelName): boolean {
  if (quietMode && level !== 'error') return false;
  return LOG_LEVELS[level] <= LOG_LEVELS[currentLevel];
}

function formatMessage(message: string, level: LogLevelName): string {
  const prefix: Record<LogLevelName, string> = {
    error: '[ERROR]',
    warn: '[WARN]',
    info: '[INFO]',
    debug: '[DEBUG]',
    trace: '[TRACE]',
  };

  const colors: Record<LogLevelName, (text: string) => string> = {
    error: chalk.red,
    warn: chalk.yellow,
    info: chalk.blue,
    debug: chalk.gray,
    trace: chalk.dim,
  };

  return colors[level](`${prefix[level]} ${message}`);
}

export function log(message: string, level: LogLevelName = 'info'): void {
  if (!shouldLog(level)) return;

  const formatted = formatMessage(message, level);

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
