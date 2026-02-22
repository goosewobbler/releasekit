import * as fs from 'node:fs';
import * as path from 'node:path';
import { z } from 'zod';
import { createPublishError, PublishErrorCode } from './errors/index.js';
import type { PublishConfig } from './types.js';

const VerifyRegistryConfigSchema = z.object({
  enabled: z.boolean().default(true),
  maxAttempts: z.number().int().positive().default(5),
  initialDelay: z.number().int().positive().default(15000),
  backoffMultiplier: z.number().positive().default(2),
});

const NpmConfigSchema = z.object({
  enabled: z.boolean().default(true),
  auth: z.enum(['auto', 'oidc', 'token']).default('auto'),
  provenance: z.boolean().default(true),
  access: z.enum(['public', 'restricted']).default('public'),
  registry: z.string().default('https://registry.npmjs.org'),
  copyFiles: z.array(z.string()).default(['LICENSE']),
  tag: z.string().default('latest'),
});

const CargoConfigSchema = z.object({
  enabled: z.boolean().default(false),
  noVerify: z.boolean().default(false),
  publishOrder: z.array(z.string()).default([]),
  clean: z.boolean().default(false),
});

const GitConfigSchema = z.object({
  push: z.boolean().default(true),
  pushMethod: z.enum(['auto', 'ssh', 'https']).default('auto'),
  remote: z.string().default('origin'),
  branch: z.string().default('main'),
});

const GitHubReleaseConfigSchema = z.object({
  enabled: z.boolean().default(true),
  draft: z.boolean().default(true),
  generateNotes: z.boolean().default(true),
  perPackage: z.boolean().default(false),
  prerelease: z.union([z.literal('auto'), z.boolean()]).default('auto'),
  notesFile: z.string().optional(),
});

const VerifyConfigSchema = z.object({
  npm: VerifyRegistryConfigSchema.default({}),
  cargo: VerifyRegistryConfigSchema.default({
    enabled: true,
    maxAttempts: 10,
    initialDelay: 30000,
    backoffMultiplier: 2,
  }),
});

const PublishConfigSchema = z.object({
  npm: NpmConfigSchema.default({}),
  cargo: CargoConfigSchema.default({}),
  git: GitConfigSchema.default({}),
  githubRelease: GitHubReleaseConfigSchema.default({}),
  verify: VerifyConfigSchema.default({}),
});

export function loadConfig(projectDir: string, configFile?: string): PublishConfig {
  const configPath = configFile ?? path.join(projectDir, 'publish.config.json');

  if (!fs.existsSync(configPath)) {
    return getDefaultConfig();
  }

  try {
    const content = fs.readFileSync(configPath, 'utf-8');
    const raw = JSON.parse(content);
    return PublishConfigSchema.parse(raw);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const issues = error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
      throw createPublishError(PublishErrorCode.CONFIG_ERROR, `Validation errors:\n${issues}`);
    }
    if (error instanceof SyntaxError) {
      throw createPublishError(PublishErrorCode.CONFIG_ERROR, `Invalid JSON: ${error.message}`);
    }
    throw error;
  }
}

export function getDefaultConfig(): PublishConfig {
  return PublishConfigSchema.parse({});
}
