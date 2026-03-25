import { z } from 'zod';

export const GitConfigSchema = z.object({
  remote: z.string().default('origin'),
  branch: z.string().default('main'),
  pushMethod: z.enum(['auto', 'ssh', 'https']).default('auto'),
  /**
   * Optional env var name containing a GitHub token for HTTPS pushes.
   * When set, publish steps can use this token without mutating git remotes.
   */
  httpsTokenEnv: z.string().optional(),
  push: z.boolean().optional(),
  skipHooks: z.boolean().optional(),
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
  mismatchStrategy: z.enum(['error', 'warn', 'ignore', 'prefer-package', 'prefer-git']).default('warn'),
  versionPrefix: z.string().default(''),
  prereleaseIdentifier: z.string().optional(),
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
  httpsTokenEnv: z.string().optional(),
  skipHooks: z.boolean().optional(),
});

export const GitHubReleaseConfigSchema = z.object({
  enabled: z.boolean().default(true),
  draft: z.boolean().default(true),
  perPackage: z.boolean().default(true),
  prerelease: z.union([z.literal('auto'), z.boolean()]).default('auto'),
  /**
   * Controls how release notes are sourced for GitHub releases.
   * - 'auto': Use RELEASE_NOTES.md if it exists, then per-package changelog
   *   data from the version output, then GitHub's auto-generated notes.
   * - 'github': Always use GitHub's auto-generated notes.
   * - 'none': No notes body.
   * - Any other string: Treated as a file path to read notes from.
   */
  releaseNotes: z.union([z.literal('auto'), z.literal('github'), z.literal('none'), z.string()]).default('auto'),
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
    perPackage: true,
    prerelease: 'auto',
    releaseNotes: 'auto',
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

export const TemplateConfigSchema = z.object({
  path: z.string().optional(),
  engine: z.enum(['handlebars', 'liquid', 'ejs']).optional(),
});

export const OutputConfigSchema = z.object({
  format: z.enum(['markdown', 'github-release', 'json']),
  file: z.string().optional(),
  options: z.record(z.string(), z.unknown()).optional(),
  templates: TemplateConfigSchema.optional(),
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
  scopes: z.array(z.string()).optional(),
});

export const ScopeRulesSchema = z.object({
  allowed: z.array(z.string()).optional(),
  caseSensitive: z.boolean().default(false),
  invalidScopeAction: z.enum(['remove', 'keep', 'fallback']).default('remove'),
  fallbackScope: z.string().optional(),
});

export const ScopeConfigSchema = z.object({
  mode: z.enum(['restricted', 'packages', 'none', 'unrestricted']).default('unrestricted'),
  rules: ScopeRulesSchema.optional(),
});

export const LLMPromptOverridesSchema = z.object({
  enhance: z.string().optional(),
  categorize: z.string().optional(),
  enhanceAndCategorize: z.string().optional(),
  summarize: z.string().optional(),
  releaseNotes: z.string().optional(),
});

export const LLMPromptsConfigSchema = z.object({
  instructions: LLMPromptOverridesSchema.optional(),
  templates: LLMPromptOverridesSchema.optional(),
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
  scopes: ScopeConfigSchema.optional(),
  prompts: LLMPromptsConfigSchema.optional(),
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

export const CILabelsConfigSchema = z.object({
  stable: z.string().default('release:stable'),
  prerelease: z.string().default('release:prerelease'),
  skip: z.string().default('release:skip'),
  major: z.string().default('release:major'),
  minor: z.string().default('release:minor'),
  patch: z.string().default('release:patch'),
});

export const CIConfigSchema = z.object({
  releaseStrategy: z.enum(['manual', 'direct', 'standing-pr', 'scheduled']).default('direct'),
  releaseTrigger: z.enum(['commit', 'label']).default('label'),
  prPreview: z.boolean().default(true),
  autoRelease: z.boolean().default(false),
  /**
   * Commit message prefixes that should not trigger a release.
   * Defaults to `['chore: release ']` to match the release commit template
   * (`chore: release ${packageName}@${version} [skip ci]`) and provide a
   * secondary loop-prevention guard alongside `[skip ci]`.
   */
  skipPatterns: z.array(z.string()).default(['chore: release ']),
  minChanges: z.number().int().positive().default(1),
  labels: CILabelsConfigSchema.default({
    stable: 'release:stable',
    prerelease: 'release:prerelease',
    skip: 'release:skip',
    major: 'release:major',
    minor: 'release:minor',
    patch: 'release:patch',
  }),
});

export const ReleaseCIConfigSchema = z.object({
  skipPatterns: z.array(z.string().min(1)).optional(),
  minChanges: z.number().int().positive().optional(),
  /** Set to `false` to disable GitHub release creation in CI. */
  githubRelease: z.literal(false).optional(),
  /** Set to `false` to disable changelog generation in CI. */
  notes: z.literal(false).optional(),
});

export const ReleaseConfigSchema = z.object({
  /**
   * Optional steps to enable. The version step always runs; only 'notes' and
   * 'publish' can be opted out. Omitting a step is equivalent to --skip-<step>.
   */
  steps: z
    .array(z.enum(['notes', 'publish']))
    .min(1)
    .optional(),
  ci: ReleaseCIConfigSchema.optional(),
});

export const ReleaseKitConfigSchema = z.object({
  git: GitConfigSchema.optional(),
  monorepo: MonorepoConfigSchema.optional(),
  version: VersionConfigSchema.optional(),
  publish: PublishConfigSchema.optional(),
  notes: NotesConfigSchema.optional(),
  ci: CIConfigSchema.optional(),
  release: ReleaseConfigSchema.optional(),
});

export type CIConfig = z.infer<typeof CIConfigSchema>;
export type CILabelsConfig = z.infer<typeof CILabelsConfigSchema>;
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
export type LLMCategory = z.infer<typeof LLMCategorySchema>;
export type ScopeRules = z.infer<typeof ScopeRulesSchema>;
export type ScopeConfig = z.infer<typeof ScopeConfigSchema>;
export type LLMPromptOverrides = z.infer<typeof LLMPromptOverridesSchema>;
export type LLMPromptsConfig = z.infer<typeof LLMPromptsConfigSchema>;
export type TemplateConfig = z.infer<typeof TemplateConfigSchema>;
export type NotesConfig = z.infer<typeof NotesConfigSchema>;
export type ReleaseCIConfig = z.infer<typeof ReleaseCIConfigSchema>;
export type ReleaseConfig = z.infer<typeof ReleaseConfigSchema>;
export type ReleaseKitConfig = z.infer<typeof ReleaseKitConfigSchema>;
