import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { z } from 'zod';
import { ConfigError } from '../errors/index.js';
import type { Config } from './types.js';

const OutputConfigSchema = z.object({
  format: z.enum(['markdown', 'github-release', 'json']),
  file: z.string().optional(),
  options: z.record(z.unknown()).optional(),
});

const LLMConfigSchema = z.object({
  provider: z.string(),
  model: z.string(),
  baseURL: z.string().optional(),
  apiKey: z.string().optional(),
  options: z
    .object({
      timeout: z.number().optional(),
      maxTokens: z.number().optional(),
      temperature: z.number().optional(),
    })
    .optional(),
  concurrency: z.number().int().positive().optional(),
  retry: z
    .object({
      maxAttempts: z.number().int().positive().optional(),
      initialDelay: z.number().nonnegative().optional(),
      maxDelay: z.number().positive().optional(),
      backoffFactor: z.number().positive().optional(),
    })
    .optional(),
  tasks: z
    .object({
      summarize: z.boolean().optional(),
      enhance: z.boolean().optional(),
      categorize: z.boolean().optional(),
      releaseNotes: z.boolean().optional(),
    })
    .optional(),
});

const MonorepoConfigSchema = z.object({
  mode: z.enum(['root', 'packages', 'both']),
  rootPath: z.string().optional(),
  packagesPath: z.string().optional(),
});

const TemplateConfigSchema = z.object({
  path: z.string().optional(),
  engine: z.enum(['handlebars', 'liquid', 'ejs']).optional(),
});

const ConfigSchema = z.object({
  input: z
    .object({
      source: z.string().optional(),
      file: z.string().optional(),
    })
    .optional(),
  output: z.array(OutputConfigSchema).default([]),
  monorepo: MonorepoConfigSchema.optional(),
  templates: TemplateConfigSchema.optional(),
  llm: LLMConfigSchema.optional(),
  updateStrategy: z.enum(['prepend', 'regenerate']).optional(),
});

function substituteVariables(value: string): string {
  const envPattern = /\{env:([^}]+)\}/g;
  const filePattern = /\{file:([^}]+)\}/g;

  let result = value;

  result = result.replace(envPattern, (_, varName) => {
    return process.env[varName] ?? '';
  });

  result = result.replace(filePattern, (_, filePath) => {
    const expandedPath = filePath.startsWith('~') ? path.join(os.homedir(), filePath.slice(1)) : filePath;

    try {
      return fs.readFileSync(expandedPath, 'utf-8').trim();
    } catch {
      return '';
    }
  });

  return result;
}

function substituteInObject<T>(obj: T): T {
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

function getConfigPaths(projectDir: string): string[] {
  return [
    process.env.CHANGELOG_CONFIG ?? '',
    path.join(projectDir, 'changelog.config.json'),
    path.join(projectDir, 'changelog.config.jsonc'),
    path.join(os.homedir(), '.config', 'releasekit', 'config.json'),
  ].filter(Boolean);
}

function parseJsonc(content: string): unknown {
  try {
    return JSON.parse(content);
  } catch {
    const cleaned = content
      .replace(/\/\/.*$/gm, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .trim();
    return JSON.parse(cleaned);
  }
}

function loadConfigFile(configPath: string): Config {
  if (!fs.existsSync(configPath)) {
    throw new ConfigError(`Config file not found: ${configPath}`);
  }
  try {
    const content = fs.readFileSync(configPath, 'utf-8');
    const parsed = parseJsonc(content);
    const substituted = substituteInObject(parsed);
    return ConfigSchema.parse(substituted);
  } catch (error) {
    if (error instanceof ConfigError) throw error;
    throw new ConfigError(
      `Failed to parse config at ${configPath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export function loadConfig(projectDir: string = process.cwd(), configFile?: string): Config {
  const inlineConfig = process.env.CHANGELOG_CONFIG_CONTENT;

  if (inlineConfig) {
    try {
      const parsed = parseJsonc(inlineConfig);
      const substituted = substituteInObject(parsed);
      return ConfigSchema.parse(substituted);
    } catch (error) {
      throw new ConfigError(`Failed to parse inline config: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (configFile) {
    return loadConfigFile(configFile);
  }

  const configPaths = getConfigPaths(projectDir);

  for (const configPath of configPaths) {
    if (configPath && fs.existsSync(configPath)) {
      return loadConfigFile(configPath);
    }
  }

  return ConfigSchema.parse({});
}

export function loadAuth(): Record<string, string> {
  const authPath = path.join(os.homedir(), '.config', 'releasekit', 'auth.json');

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
  const authDir = path.join(os.homedir(), '.config', 'releasekit');

  if (!fs.existsSync(authDir)) {
    fs.mkdirSync(authDir, { recursive: true });
  }

  const authPath = path.join(authDir, 'auth.json');
  const existing = loadAuth();

  existing[provider] = apiKey;

  fs.writeFileSync(authPath, JSON.stringify(existing, null, 2), { encoding: 'utf-8', mode: 0o600 });
}

export function getDefaultConfig(): Config {
  return {
    output: [{ format: 'markdown', file: 'CHANGELOG.md' }],
    updateStrategy: 'prepend',
  };
}
