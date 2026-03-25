import * as fs from 'node:fs';
import * as path from 'node:path';
import { z } from 'zod';
import { ConfigError } from './errors.js';
import { mergeGitConfig } from './merge.js';
import { parseJsonc } from './parse.js';
import {
  type CIConfig,
  type GitConfig,
  type NotesConfig,
  type PublishConfig,
  type ReleaseConfig,
  type ReleaseKitConfig,
  ReleaseKitConfigSchema,
  type VersionConfig,
} from './schema.js';
import { substituteInObject } from './substitute.js';

export interface LoadOptions {
  cwd?: string;
  configPath?: string;
}

const CONFIG_FILE = 'releasekit.config.json';

function loadConfigFile(configPath: string): ReleaseKitConfig {
  if (!fs.existsSync(configPath)) {
    return {};
  }

  try {
    const content = fs.readFileSync(configPath, 'utf-8');
    const parsed = parseJsonc(content);
    const substituted = substituteInObject(parsed);
    return ReleaseKitConfigSchema.parse(substituted);
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      const issues = error.issues.map((i: z.ZodIssue) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
      throw new ConfigError(`Config validation errors:\n${issues}`);
    }
    if (error instanceof SyntaxError) {
      throw new ConfigError(`Invalid JSON in config file: ${error.message}`);
    }
    throw error;
  }
}

export function loadConfig(options?: LoadOptions): ReleaseKitConfig {
  const cwd = options?.cwd ?? process.cwd();
  const configPath = options?.configPath ?? path.join(cwd, CONFIG_FILE);

  return loadConfigFile(configPath);
}

export function loadVersionConfig(options?: LoadOptions): VersionConfig | undefined {
  const config = loadConfig(options);
  return config.version;
}

export function loadPublishConfig(options?: LoadOptions): PublishConfig | undefined {
  const config = loadConfig(options);

  if (!config.publish) return undefined;

  const mergedGit = mergeGitConfig(config.git, config.publish.git);

  return {
    ...config.publish,
    git: mergedGit
      ? {
          push: mergedGit.push ?? true,
          pushMethod: mergedGit.pushMethod,
          remote: mergedGit.remote,
          branch: mergedGit.branch,
          httpsTokenEnv: mergedGit.httpsTokenEnv,
          skipHooks: mergedGit.skipHooks,
        }
      : undefined,
  };
}

export function loadNotesConfig(options?: LoadOptions): NotesConfig | undefined {
  const config = loadConfig(options);
  return config.notes;
}

export function loadGitConfig(options?: LoadOptions): GitConfig | undefined {
  const config = loadConfig(options);
  return config.git;
}

export function loadMonorepoConfig(options?: LoadOptions) {
  const config = loadConfig(options);
  return config.monorepo;
}

export function loadCIConfig(options?: LoadOptions): CIConfig | undefined {
  const config = loadConfig(options);
  return config.ci;
}

export function loadReleaseConfig(options?: LoadOptions): ReleaseConfig | undefined {
  const config = loadConfig(options);
  return config.release;
}
