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
  PublishConfigSchema,
  type ReleaseConfig,
  type ReleaseKitConfig,
  ReleaseKitConfigSchema,
  type VersionConfig,
} from './schema.js';
import { substituteInObject } from './substitute.js';
import { rememberUnsetEnv, type UnsetEnvReference, zodConfigError } from './validation.js';

export interface LoadOptions {
  cwd?: string;
  configPath?: string;
}

const CONFIG_FILES = ['releasekit.config.json', 'releasekit.config.jsonc'] as const;

function resolveConfigPath(cwd: string): string {
  for (const file of CONFIG_FILES) {
    const candidate = path.join(cwd, file);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  // Return the primary path so loadConfigFile's not-found handling applies.
  return path.join(cwd, CONFIG_FILES[0]);
}

function loadConfigFile(configPath: string): ReleaseKitConfig {
  if (!fs.existsSync(configPath)) {
    return {};
  }

  const unsetEnv: UnsetEnvReference[] = [];
  try {
    const content = fs.readFileSync(configPath, 'utf-8');
    const parsed = parseJsonc(content);
    // Confine {file:} substitution to the config file's directory so a config can't read files outside the tree.
    const substituted = substituteInObject(parsed, path.dirname(configPath), (refPath, name) =>
      unsetEnv.push({ path: refPath, name }),
    );
    const config = ReleaseKitConfigSchema.parse(substituted);
    rememberUnsetEnv(config, unsetEnv);
    return config;
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      throw zodConfigError(error, unsetEnv);
    }
    if (error instanceof SyntaxError) {
      throw new ConfigError(`Invalid JSON in config file: ${error.message}`);
    }
    throw error;
  }
}

export function loadConfig(options?: LoadOptions): ReleaseKitConfig {
  const cwd = options?.cwd ?? process.cwd();
  const configPath = options?.configPath ?? resolveConfigPath(cwd);

  return loadConfigFile(configPath);
}

export function loadVersionConfig(options?: LoadOptions): VersionConfig | undefined {
  const config = loadConfig(options);
  return config.version;
}

export function loadPublishConfig(options?: LoadOptions): PublishConfig {
  const config = loadConfig(options);
  const publish = config.publish ?? PublishConfigSchema.parse({});
  const mergedGit = mergeGitConfig(config.git, publish.git);

  return {
    ...publish,
    git: mergedGit
      ? {
          push: mergedGit.push ?? true,
          pushMethod: mergedGit.pushMethod,
          remote: mergedGit.remote,
          branch: mergedGit.branch,
          httpsTokenEnv: mergedGit.httpsTokenEnv,
          skipHooks: mergedGit.skipHooks,
          formatCommand: mergedGit.formatCommand,
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
