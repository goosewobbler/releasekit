import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { isPathWithinRoot } from '@releasekit/core';
import { ConfigError } from './errors.js';

const MAX_INPUT_LENGTH = 10000;

/**
 * Trust boundary: substituted values can surface in bot-authored output (tag templates, `standingPr.title`,
 * notes echoed into PR comments and releases). `{env:NAME}` is the trusted operator's injection point for
 * secrets, but `{file:REL_PATH}` is confined to `rootDir` so a config can't exfiltrate files such as
 * `~/.ssh/id_rsa`.
 */
export function substituteVariables(value: string, rootDir: string = process.cwd()): string {
  // Guards against ReDoS
  if (value.length > MAX_INPUT_LENGTH) {
    throw new Error(`Input too long: ${value.length} characters (max ${MAX_INPUT_LENGTH})`);
  }

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
    // A sole reference that resolved to nothing becomes undefined so downstream ?? fallbacks apply.
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
