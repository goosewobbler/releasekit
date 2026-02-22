import * as fs from 'node:fs';
import * as path from 'node:path';
import { type LoadOptions, loadNotesConfig as loadSharedNotesConfig, type NotesConfig } from '@releasekit/config';

export function loadConfig(projectDir: string = process.cwd(), configFile?: string): NotesConfig {
  const options: LoadOptions = { cwd: projectDir, configPath: configFile };
  return loadSharedNotesConfig(options) ?? getDefaultConfig();
}

export function getDefaultConfig(): NotesConfig {
  return {
    output: [{ format: 'markdown', file: 'CHANGELOG.md' }],
    updateStrategy: 'prepend',
  };
}

export function loadAuth(): Record<string, string> {
  const authPath = path.join(process.env.HOME ?? '', '.config', 'releasekit', 'auth.json');

  if (fs.existsSync(authPath)) {
    try {
      const content = fs.readFileSync(authPath, 'utf-8');
      return JSON.parse(content);
    } catch {
      return {};
    }
  }

  return {};
}

export function saveAuth(provider: string, apiKey: string): void {
  const authDir = path.join(process.env.HOME ?? '', '.config', 'releasekit');

  if (!fs.existsSync(authDir)) {
    fs.mkdirSync(authDir, { recursive: true });
  }

  const authPath = path.join(authDir, 'auth.json');
  const existing = loadAuth();

  existing[provider] = apiKey;

  fs.writeFileSync(authPath, JSON.stringify(existing, null, 2), { encoding: 'utf-8', mode: 0o600 });
}
