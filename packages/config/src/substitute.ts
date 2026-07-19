import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { isPathWithinRoot } from '@releasekit/core';
import { ConfigError } from './errors.js';

const MAX_INPUT_LENGTH = 10000;

/**
 * Inline `{env:NAME}` and `{file:REL_PATH}` references in a config string.
 *
 * Trust boundary: substituted values flow into config fields that can surface in bot-authored
 * output — tag templates, `standingPr.title`, changelog/notes text echoed into PR comments and
 * releases — so the two read primitives are scoped differently:
 * - `{env:NAME}` reads process env, the trusted-operator injection point for secrets (npm/LLM
 *   tokens). Returned verbatim; an unset variable resolves to an empty string.
 * - `{file:REL_PATH}` is confined to `rootDir` (the config file's directory). A reference that
 *   escapes it — via `..` or an absolute path outside the tree — is rejected rather than read, so a
 *   config cannot exfiltrate files such as `~/.ssh/id_rsa` or `/etc/passwd`. An in-bounds but
 *   unreadable path resolves to an empty string.
 */
export function substituteVariables(value: string, rootDir: string = process.cwd()): string {
  // Limit input length to prevent ReDoS attacks
  if (value.length > MAX_INPUT_LENGTH) {
    throw new Error(`Input too long: ${value.length} characters (max ${MAX_INPUT_LENGTH})`);
  }

  // Use safer regex patterns with length limits for capture groups
  const envPattern = /\{env:([^}]{1,1000})\}/g;
  const filePattern = /\{file:([^}]{1,1000})\}/g;

  let result = value;

  result = result.replace(envPattern, (_, varName: string) => {
    return process.env[varName] ?? '';
  });

  result = result.replace(filePattern, (_, filePath: string) => {
    const resolved = path.resolve(rootDir, filePath);
    if (!isPathWithinRoot(rootDir, resolved)) {
      throw new ConfigError(
        `{file:${filePath}} resolves outside the config directory (${path.resolve(rootDir)}); ` +
          'config file references are confined to the repository. Use {env:NAME} for secrets kept outside the repo.',
      );
    }

    try {
      return fs.readFileSync(resolved, 'utf-8').trim();
    } catch {
      return '';
    }
  });

  return result;
}

const SOLE_REFERENCE_PATTERN = /^\{(?:env|file):[^}]+\}$/;

export function substituteInObject<T>(obj: T, rootDir: string = process.cwd()): T {
  if (typeof obj === 'string') {
    const result = substituteVariables(obj, rootDir);
    // When the entire string was a single {env:…} or {file:…} reference that
    // resolved to nothing, return undefined so downstream ?? fallbacks work.
    if (result === '' && SOLE_REFERENCE_PATTERN.test(obj)) {
      return undefined as T;
    }
    return result as T;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => substituteInObject(item, rootDir)) as T;
  }

  if (obj && typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = substituteInObject(value, rootDir);
    }
    return result as T;
  }

  return obj;
}

const AUTH_DIR = path.join(os.homedir(), '.config', 'releasekit');
const AUTH_FILE = path.join(AUTH_DIR, 'auth.json');

export function loadAuth(): Record<string, string> {
  if (fs.existsSync(AUTH_FILE)) {
    try {
      const content = fs.readFileSync(AUTH_FILE, 'utf-8');
      return JSON.parse(content);
    } catch {
      return {};
    }
  }

  return {};
}

export function saveAuth(provider: string, apiKey: string): void {
  if (!fs.existsSync(AUTH_DIR)) {
    fs.mkdirSync(AUTH_DIR, { recursive: true });
  }

  const existing = loadAuth();
  existing[provider] = apiKey;

  fs.writeFileSync(AUTH_FILE, JSON.stringify(existing, null, 2), { encoding: 'utf-8', mode: 0o600 });
}
