import {
  init_esm_shims
} from "./chunk-NOZSTVTV.js";

// ../version/dist/chunk-Q3FHZORY.js
init_esm_shims();
import chalk from "chalk";
var LOG_LEVELS = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
  trace: 4
};
var PREFIXES = {
  error: "[ERROR]",
  warn: "[WARN]",
  info: "[INFO]",
  debug: "[DEBUG]",
  trace: "[TRACE]"
};
var COLORS = {
  error: chalk.red,
  warn: chalk.yellow,
  info: chalk.blue,
  debug: chalk.gray,
  trace: chalk.dim
};
var currentLevel = "info";
var quietMode = false;
function shouldLog(level) {
  if (quietMode && level !== "error") return false;
  return LOG_LEVELS[level] <= LOG_LEVELS[currentLevel];
}
function log(message, level = "info") {
  if (!shouldLog(level)) return;
  const formatted = COLORS[level](`${PREFIXES[level]} ${message}`);
  console.error(formatted);
}
var ReleaseKitError = class _ReleaseKitError extends Error {
  constructor(message) {
    super(message);
    this.name = this.constructor.name;
  }
  logError() {
    log(this.message, "error");
    if (this.suggestions.length > 0) {
      log("\nSuggested solutions:", "info");
      for (const [i, suggestion] of this.suggestions.entries()) {
        log(`${i + 1}. ${suggestion}`, "info");
      }
    }
  }
  static isReleaseKitError(error2) {
    return error2 instanceof _ReleaseKitError;
  }
};
function sanitizePackageName(name) {
  return name.startsWith("@") ? name.slice(1).replace(/\//g, "-") : name;
}
var BaseVersionError = class _BaseVersionError extends ReleaseKitError {
  code;
  suggestions;
  constructor(message, code, suggestions) {
    super(message);
    this.code = code;
    this.suggestions = suggestions ?? [];
  }
  static isVersionError(error) {
    return error instanceof _BaseVersionError;
  }
};

export {
  ReleaseKitError,
  sanitizePackageName,
  BaseVersionError
};
