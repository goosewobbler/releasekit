import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export function substituteVariables(value: string): string {
  const envPattern = /\{env:([^}]+)\}/g;
  const filePattern = /\{file:([^}]+)\}/g;

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

export function substituteInObject<T>(obj: T): T {
  if (typeof obj === 'string') {
    return substituteVariables(obj) as T;
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
