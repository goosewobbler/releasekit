import { z } from 'zod';

export const GitConfigSchema = z.object({
  remote: z.string().default('origin'),
  branch: z.string().default('main'),
  pushMethod: z.enum(['auto', 'ssh', 'https']).default('auto'),
  push: z.boolean().optional(),
});

export const MonorepoConfigSchema = z.object({
  mode: z.enum(['root', 'packages', 'both']).optional(),
  rootPath: z.string().optional(),
  packagesPath: z.string().optional(),
  mainPackage: z.string().optional(),
});

export const BranchPatternSchema = z.object({
  pattern: z.string(),
  releaseType: z.enum(['major', 'minor', 'patch', 'prerelease']),
});

export const VersionCargoConfigSchema = z.object({
  enabled: z.boolean().default(true),
  paths: z.array(z.string()).optional(),
});

export const VersionConfigSchema = z.object({
  tagTemplate: z.string().default('v{version}'),
  packageSpecificTags: z.boolean().default(false),
  preset: z.string().default('conventional'),
  sync: z.boolean().default(true),
  packages: z.array(z.string()).default([]),
  mainPackage: z.string().optional(),
  updateInternalDependencies: z.enum(['major', 'minor', 'patch', 'no-internal-update']).default('minor'),
  skip: z.array(z.string()).optional(),
  commitMessage: z.string().optional(),
  versionStrategy: z.enum(['branchPattern', 'commitMessage']).default('commitMessage'),
  branchPatterns: z.array(BranchPatternSchema).optional(),
  defaultReleaseType: z.enum(['major', 'minor', 'patch', 'prerelease']).optional(),
  skipHooks: z.boolean().optional(),
  mismatchStrategy: z.enum(['error', 'warn', 'ignore', 'prefer-package', 'prefer-git']).default('warn'),
  versionPrefix: z.string().default(''),
  prereleaseIdentifier: z.string().optional(),
  baseBranch: z.string().optional(),
  strictReachable: z.boolean().default(false),
  cargo: VersionCargoConfigSchema.optional(),
});

export const NpmConfigSchema = z.object({
  enabled: z.boolean().default(true),
  auth: z.enum(['auto', 'oidc', 'token']).default('auto'),
  provenance: z.boolean().default(true),
  access: z.enum(['public', 'restricted']).default('public'),
  registry: z.string().default('https://registry.npmjs.org'),
  copyFiles: z.array(z.string()).default(['LICENSE']),
  tag: z.string().default('latest'),
});

export const CargoPublishConfigSchema = z.object({
  enabled: z.boolean().default(false),
  noVerify: z.boolean().default(false),
  publishOrder: z.array(z.string()).default([]),
  clean: z.boolean().default(false),
});

export const PublishGitConfigSchema = z.object({
  push: z.boolean().default(true),
  pushMethod: z.enum(['auto', 'ssh', 'https']).optional(),
  remote: z.string().optional(),
  branch: z.string().optional(),
});

export const GitHubReleaseConfigSchema = z.object({
  enabled: z.boolean().default(true),
  draft: z.boolean().default(true),
  generateNotes: z.boolean().default(true),
  perPackage: z.boolean().default(false),
  prerelease: z.union([z.literal('auto'), z.boolean()]).default('auto'),
  notesFile: z.string().optional(),
});

export const VerifyRegistryConfigSchema = z.object({
  enabled: z.boolean().default(true),
  maxAttempts: z.number().int().positive().default(5),
  initialDelay: z.number().int().positive().default(15000),
  backoffMultiplier: z.number().positive().default(2),
});

export const VerifyConfigSchema = z.object({
  npm: VerifyRegistryConfigSchema.default({
    enabled: true,
    maxAttempts: 5,
    initialDelay: 15000,
    backoffMultiplier: 2,
  }),
  cargo: VerifyRegistryConfigSchema.default({
    enabled: true,
    maxAttempts: 10,
    initialDelay: 30000,
    backoffMultiplier: 2,
  }),
});

export const PublishConfigSchema = z.object({
  git: PublishGitConfigSchema.optional(),
  npm: NpmConfigSchema.default({
    enabled: true,
    auth: 'auto',
    provenance: true,
    access: 'public',
    registry: 'https://registry.npmjs.org',
    copyFiles: ['LICENSE'],
    tag: 'latest',
  }),
  cargo: CargoPublishConfigSchema.default({
    enabled: false,
    noVerify: false,
    publishOrder: [],
    clean: false,
  }),
  githubRelease: GitHubReleaseConfigSchema.default({
    enabled: true,
    draft: true,
    generateNotes: true,
    perPackage: false,
    prerelease: 'auto',
  }),
  verify: VerifyConfigSchema.default({
    npm: {
      enabled: true,
      maxAttempts: 5,
      initialDelay: 15000,
      backoffMultiplier: 2,
    },
    cargo: {
      enabled: true,
      maxAttempts: 10,
      initialDelay: 30000,
      backoffMultiplier: 2,
    },
  }),
});

export const OutputConfigSchema = z.object({
  format: z.enum(['markdown', 'github-release', 'json']),
  file: z.string().optional(),
  options: z.record(z.string(), z.unknown()).optional(),
});

export const LLMOptionsSchema = z.object({
  timeout: z.number().optional(),
  maxTokens: z.number().optional(),
  temperature: z.number().optional(),
});

export const LLMRetryConfigSchema = z.object({
  maxAttempts: z.number().int().positive().optional(),
  initialDelay: z.number().nonnegative().optional(),
  maxDelay: z.number().positive().optional(),
  backoffFactor: z.number().positive().optional(),
});

export const LLMTasksConfigSchema = z.object({
  summarize: z.boolean().optional(),
  enhance: z.boolean().optional(),
  categorize: z.boolean().optional(),
  releaseNotes: z.boolean().optional(),
});

export const LLMCategorySchema = z.object({
  name: z.string(),
  description: z.string(),
});

export const LLMConfigSchema = z.object({
  provider: z.string(),
  model: z.string(),
  baseURL: z.string().optional(),
  apiKey: z.string().optional(),
  options: LLMOptionsSchema.optional(),
  concurrency: z.number().int().positive().optional(),
  retry: LLMRetryConfigSchema.optional(),
  tasks: LLMTasksConfigSchema.optional(),
  categories: z.array(LLMCategorySchema).optional(),
  style: z.string().optional(),
});

export const TemplateConfigSchema = z.object({
  path: z.string().optional(),
  engine: z.enum(['handlebars', 'liquid', 'ejs']).optional(),
});

export const NotesInputConfigSchema = z.object({
  source: z.string().optional(),
  file: z.string().optional(),
});

export const NotesConfigSchema = z.object({
  input: NotesInputConfigSchema.optional(),
  output: z.array(OutputConfigSchema).default([{ format: 'markdown', file: 'CHANGELOG.md' }]),
  monorepo: MonorepoConfigSchema.optional(),
  templates: TemplateConfigSchema.optional(),
  llm: LLMConfigSchema.optional(),
  updateStrategy: z.enum(['prepend', 'regenerate']).default('prepend'),
});

export const ReleaseKitConfigSchema = z.object({
  git: GitConfigSchema.optional(),
  monorepo: MonorepoConfigSchema.optional(),
  version: VersionConfigSchema.optional(),
  publish: PublishConfigSchema.optional(),
  notes: NotesConfigSchema.optional(),
});

export type GitConfig = z.infer<typeof GitConfigSchema>;
export type MonorepoConfig = z.infer<typeof MonorepoConfigSchema>;
export type VersionConfig = z.infer<typeof VersionConfigSchema>;
export type NpmConfig = z.infer<typeof NpmConfigSchema>;
export type CargoPublishConfig = z.infer<typeof CargoPublishConfigSchema>;
export type PublishGitConfig = z.infer<typeof PublishGitConfigSchema>;
export type GitHubReleaseConfig = z.infer<typeof GitHubReleaseConfigSchema>;
export type VerifyRegistryConfig = z.infer<typeof VerifyRegistryConfigSchema>;
export type VerifyConfig = z.infer<typeof VerifyConfigSchema>;
export type PublishConfig = z.infer<typeof PublishConfigSchema>;
export type OutputConfig = z.infer<typeof OutputConfigSchema>;
export type LLMConfig = z.infer<typeof LLMConfigSchema>;
export type TemplateConfig = z.infer<typeof TemplateConfigSchema>;
export type NotesConfig = z.infer<typeof NotesConfigSchema>;
export type ReleaseKitConfig = z.infer<typeof ReleaseKitConfigSchema>;
