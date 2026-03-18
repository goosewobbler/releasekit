import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const MAX_INPUT_LENGTH = 10000;

export function substituteVariables(value: string): string {
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
    const expandedPath = filePath.startsWith('~') ? path.join(os.homedir(), filePath.slice(1)) : filePath;

    try {
      return fs.readFileSync(expandedPath, 'utf-8').trim();
    } catch {
      return '';
    }
  });

  return result;
}

const SOLE_REFERENCE_PATTERN = /^\{(?:env|file):[^}]+\}$/;

export function substituteInObject<T>(obj: T): T {
  if (typeof obj === 'string') {
    const result = substituteVariables(obj);
    // When the entire string was a single {env:…} or {file:…} reference that
    // resolved to nothing, return undefined so downstream ?? fallbacks work.
    if (result === '' && SOLE_REFERENCE_PATTERN.test(obj)) {
      return undefined as T;
    }
    return result as T;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => substituteInObject(item)) as T;
  }

  if (obj && typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = substituteInObject(value);
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
