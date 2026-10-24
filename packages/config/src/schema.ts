import { z } from 'zod';

// ---------------------------------------------------------------------------
// `.describe()` text is the source of truth: `pnpm schema:gen` generates
// `releasekit.schema.json` from it, and `pnpm docs:config` generates
// `docs/configuration.md` from that. Never hand-edit the JSON schema -
// `pnpm schema:check` enforces in CI that it matches Zod.
// ---------------------------------------------------------------------------

/** Dependabot's default commit scopes. */
export const DEFAULT_DEMOTE_SCOPES: readonly string[] = ['deps', 'deps-dev'];

export const GitConfigSchema = z.object({
  remote: z.string().default('origin').describe('Git remote name'),
  branch: z
    .string()
    .optional()
    .describe(
      'Branch that releases land on: a direct release pushes its commit here, and the standing release PR targets it. When unset, a direct release pushes the current branch and the standing PR targets main.',
    ),
  pushMethod: z.enum(['auto', 'ssh', 'https']).default('auto').describe('Method for pushing to remote'),
  push: z.boolean().optional().describe('Whether to push changes to remote'),
  httpsTokenEnv: z.string().optional().describe('Environment variable name containing a GitHub token for HTTPS pushes'),
  skipHooks: z.boolean().optional().describe('Skip Git hooks when committing'),
});

export const MonorepoConfigSchema = z.object({
  rootPath: z.string().optional().describe('Path to root changelog'),
  packagesPath: z.string().optional().describe('Path to packages directory'),
});

export const VersionNpmConfigSchema = z.object({
  enabled: z
    .boolean()
    .default(true)
    .describe(
      'Version package.json manifests. Detected npm packages are versioned by default; set false to opt out (e.g. npm versioning handled elsewhere).',
    ),
});

export const VersionCargoConfigSchema = z.object({
  enabled: z
    .boolean()
    .default(true)
    .describe(
      'Version Cargo.toml manifests. Detected Rust packages are versioned by default; set false to opt out (e.g. a vendored crate, or Rust versioning handled elsewhere).',
    ),
  paths: z
    .array(z.string())
    .optional()
    .describe(
      "Directories, relative to each package, whose Cargo.toml is bumped instead of the package's own. Each entry resolves to <package dir>/<entry>/Cargo.toml, with no recursive search; version.groups members ignore it.",
    ),
});

export const VersionPubConfigSchema = z.object({
  enabled: z
    .boolean()
    .default(true)
    .describe(
      'Version pubspec.yaml manifests. Detected Dart/Flutter packages are versioned by default; set false to opt out.',
    ),
  paths: z
    .array(z.string())
    .optional()
    .describe(
      "Directories, relative to each package, whose pubspec.yaml is bumped instead of the package's own. Each entry resolves to <package dir>/<entry>/pubspec.yaml, with no recursive search.",
    ),
});

export const VersionGroupSchema = z.object({
  packages: z
    .array(z.string())
    .min(1)
    .describe(
      'Package patterns (exact names, @scope/*, or globs) whose matched packages form this group. Same matching rules as version.packages.',
    ),
  sync: z
    .enum(['fixed', 'linked', 'independent'])
    .describe(
      'fixed: all members release together at the shared group version. linked: only changed members release, all at the same computed version. independent: only changed members release, each on its own commit-driven version line (no shared version), but the set ships atomically.',
    ),
});

export const PresetSchema = z.enum(['angular', 'conventionalcommits']);
export const DEFAULT_PRESET: Preset = 'conventionalcommits';

export const VersionConfigSchema = z.object({
  // biome-ignore lint/suspicious/noTemplateCurlyInString: intentional template-placeholder syntax
  tagTemplate: z.string().default('${prefix}${version}').describe(
    // biome-ignore lint/suspicious/noTemplateCurlyInString: documenting placeholder syntax to the user
    'Template for Git tags. Available variables: ${version} (version number), ${prefix} (versionPrefix value, e.g. \'v\'), ${packageName} (sanitized package name, e.g. \'scope-pkg\'). Example: "${packageName}-${prefix}${version}" produces "scope-pkg-v1.2.3".',
  ),
  baselineTagTemplate: z
    .string()
    // Pattern (not a refine) so it round-trips into the JSON Schema as `pattern`.
    .regex(/.*\$\{version\}.*/, {
      message:
        // biome-ignore lint/suspicious/noTemplateCurlyInString: documenting the expected placeholder syntax to the user
        'baselineTagTemplate must contain a ${version} placeholder so the prefix can be derived (e.g. "release/${prefix}${version}").',
    })
    .optional()
    .describe(
      // biome-ignore lint/suspicious/noTemplateCurlyInString: documenting placeholder syntax to the user
      'Optional secondary tag template for an internal \'baseline\' marker that records the release commit on the source branch. Use this when tagTemplate resolves to a tag that gets force-moved off the source branch by a downstream step (e.g. a GitHub Action distributing built artifacts at the version tag) — the baseline tag stays on the release commit so future version-bump and changelog calculations can still find the previous release. Must contain a ${version} placeholder so the baseline prefix can be derived. Supports the same variables as tagTemplate. Example: "release/${prefix}${version}" produces "release/v1.2.3".',
    ),
  packageSpecificTags: z.boolean().default(false).describe('Enable package-specific tagging'),
  preset: PresetSchema.default(DEFAULT_PRESET).describe('Commit convention preset'),
  sync: z
    .boolean()
    .default(true)
    .describe(
      'Global lockstep versioning. true is sugar for one implicit fixed group of every package — it shares the same mechanism as version.groups. Set to false when using version.groups; sync: true alongside groups is treated as the implicit all-packages fixed group taking precedence (a config conflict, warned about at runtime).',
    ),
  groups: z
    .record(z.string(), VersionGroupSchema)
    .optional()
    .describe(
      'Named version groups. Each group binds a set of package patterns to a fixed, linked, or independent sync mode. fixed: any releasable change in any member releases ALL members at the shared group version (bump(max(member baselines))). linked: only members with releasable changes release, but every releasing member shares the same computed version. independent: only members with releasable changes release, each on its own commit-driven version line (no shared version), but the set is atomic — targeting any member pulls in the whole group. Packages not matched by any group version independently. A package may belong to at most one group. Set version.sync to false when using groups.',
    ),
  packages: z
    .array(z.string())
    .default([])
    .describe('Packages to include in versioning. Empty includes every discovered package.'),
  sharedPackages: z
    .array(z.string())
    .optional()
    .describe(
      'Foundational packages whose changes belong in every package’s changelog. A commit touching only a shared package (exact name or glob) is classified as repo-level and surfaced under "Project-wide changes" rather than attributed to that one package. Default: none — no package is treated as shared unless declared.',
    ),
  sharedChangelogFloor: z
    .enum(['union', 'sinceLastRelease'])
    .default('union')
    .describe(
      'How the "Project-wide changes" block is bounded in package-specific-tag mode. "union" (default): repo-level commits accrue from the union of the releasing packages\' ranges, floored by the OLDEST unreleased baseline — so a genuinely-global commit recurs in every release until the oldest-baselined package is released past it. "sinceLastRelease": floor the block by the single nearest tag reachable across the repo, so global commits already shown by the most recent release don\'t recur (recommended for per-package-tag monorepos). No effect in sync mode, where one shared tag already consumes repo-level commits on each release.',
    ),
  mainPackage: z.string().optional().describe('Package to use for version determination'),
  skip: z
    .array(z.string())
    .optional()
    .describe(
      'Packages to exclude from versioning (glob patterns or exact names). Private packages ("private": true) are skipped automatically — see includePrivate — so they do not need to be listed here.',
    ),
  includePrivate: z
    .boolean()
    .default(false)
    .describe(
      'Include npm packages marked "private": true (in package.json) in the release flow. Default false: private packages are skipped at discovery — they cannot be published to any registry, mirroring the Cargo `publish = false` and pub `publish_to: none` skips already applied during discovery. Set true to version a private package for internal tracking. Packages explicitly named in version.packages are always included regardless of this setting.',
    ),
  commitMessage: z.string().optional().describe(
    // biome-ignore lint/suspicious/noTemplateCurlyInString: documenting placeholder syntax to the user
    "Template for the release commit message, with ${version} and ${packageName}. Default: 'chore: release ${packageName} v${version}' for sync and single-package releases; otherwise 'chore: release' followed by each released package and version.",
  ),
  mismatchStrategy: z
    .enum(['error', 'warn', 'ignore', 'prefer-package', 'prefer-git'])
    .default('warn')
    .describe('How to handle version mismatches'),
  versionPrefix: z.string().default('').describe('Prefix for version tags'),
  prereleaseIdentifier: z.string().optional().describe("Identifier for prerelease versions (e.g., 'alpha', 'beta')"),
  allowFirstBump: z
    .boolean()
    .default(false)
    .describe(
      'Acknowledge applying a bump on a first release with an already-stable manifest. On a first release (no prior tag), `--stable --bump <type>` applies the bump (e.g. 1.0.0 → 2.0.0) rather than graduating, which can silently overshoot the staged first version. By default this is flagged per `mismatchStrategy` (warn, or abort under "error"); set true (or pass --allow-first-bump) to apply the bump silently — legitimate when importing a package with prior external version history.',
    ),
  strictReachable: z.boolean().default(false).describe('Only use reachable tags'),
  zeroMajor: z
    .enum(['spec', 'strict'])
    .default('spec')
    .describe(
      "Pre-1.0 handling of commit-inferred breaking changes. 'spec' (default): bump the 0.x minor (0.24.0 → 0.25.0), per semver §4. 'strict': bump the next major (→ 1.0.0). Inferred path only — explicit overrides (--bump major, bump:major) always graduate to 1.0.0.",
    ),
  npm: VersionNpmConfigSchema.optional().describe('npm/JavaScript version handling'),
  cargo: VersionCargoConfigSchema.optional().describe('Cargo/Rust configuration'),
  pub: VersionPubConfigSchema.optional().describe('Dart/Flutter pub configuration'),
});

export const NpmConfigSchema = z.object({
  enabled: z
    .boolean()
    .default(true)
    .describe(
      'Publish to npm. Detected npm packages are published by default; set false to opt out (version and tag only).',
    ),
  auth: z.enum(['auto', 'oidc', 'token']).default('auto').describe('Authentication method'),
  provenance: z.boolean().default(true).describe('Enable npm provenance attestation'),
  access: z.enum(['public', 'restricted']).default('public').describe('Package access level'),
  registry: z.string().default('https://registry.npmjs.org').describe('NPM registry URL'),
  copyFiles: z.array(z.string()).default(['LICENSE']).describe('Files to copy to package before publishing'),
  tag: z.string().default('latest').describe('NPM dist tag'),
  publishOrder: z
    .array(z.string())
    .default([])
    .describe('Explicit publish order for npm packages; empty auto-sorts dependencies first'),
});

export const CargoPublishConfigSchema = z.object({
  enabled: z
    .boolean()
    .default(true)
    .describe(
      'Publish to crates.io. Detected Rust packages are published by default; set false to opt out (version and tag only).',
    ),
  noVerify: z
    .boolean()
    .default(false)
    .describe("Pass --no-verify to cargo publish, skipping cargo's pre-publish build of the packaged crate."),
  publishOrder: z
    .array(z.string())
    .default([])
    .describe(
      'Crate names to publish first, in this order; the rest follow in discovery order. Empty sorts crates by their path dependencies.',
    ),
  clean: z.boolean().default(false).describe("Run cargo clean in each crate's directory before publishing."),
});

export const PubPublishConfigSchema = z.object({
  enabled: z
    .boolean()
    .default(true)
    .describe(
      'Publish to pub.dev. Detected Dart/Flutter packages are published by default; set false to opt out (version and tag only).',
    ),
  publishOrder: z
    .array(z.string())
    .default([])
    .describe(
      'Package names to publish first, in this order; the rest follow in discovery order, which is also the order when empty.',
    ),
});

export const PublishGitConfigSchema = z.object({
  push: z
    .boolean()
    .optional()
    .describe('Push tags and commits to remote. When unset, inherits the top-level git.push (which defaults to push).'),
  pushMethod: z.enum(['auto', 'ssh', 'https']).optional().describe('Push method override'),
  remote: z.string().optional().describe('Remote name override'),
  branch: z.string().optional().describe('Branch name override'),
  httpsTokenEnv: z.string().optional().describe('Environment variable name containing a GitHub token for HTTPS pushes'),
  skipHooks: z.boolean().optional().describe('Skip Git hooks when committing'),
});

export const GitHubReleaseConfigSchema = z.object({
  enabled: z.boolean().default(true).describe('Enable GitHub releases'),
  draft: z.boolean().default(true).describe('Create as draft release'),
  perPackage: z.boolean().default(true).describe('Create separate release per package'),
  prerelease: z
    .union([z.boolean(), z.literal('auto')])
    .default('auto')
    .describe('Mark as prerelease'),
  body: z
    .enum(['auto', 'releaseNotes', 'changelog', 'generated', 'none'])
    .default('auto')
    .describe(
      "Source for GitHub release body. 'auto': use release notes if enabled, else changelog, else GitHub auto. 'releaseNotes': use LLM-generated release notes. 'changelog': use changelog entries. 'generated': GitHub auto-generated. 'none': no body.",
    ),
  /* biome-ignore lint/suspicious/noTemplateCurlyInString: default template value */
  titleTemplate: z.string().default('${packageName}: ${version}').describe(
    // biome-ignore lint/suspicious/noTemplateCurlyInString: documenting placeholder syntax to the user
    "Template for the GitHub release title when a package name is resolved. Available variables: ${packageName} (original scoped name, e.g. '@scope/pkg'), ${version} (e.g. 'v1.0.0'). Version-only tags always use the tag string directly.",
  ),
  skipPackages: z.array(z.string()).default([]).describe('Package names to exclude from GitHub release creation'),
});

export const VerifyRegistryNpmConfigSchema = z.object({
  enabled: z.boolean().default(true).describe('Verify NPM publish'),
  maxAttempts: z.number().int().positive().default(5).describe('Maximum verification attempts'),
  initialDelay: z
    .number()
    .int()
    .positive()
    .default(15000)
    .describe('Wait in ms after the first failed check; each later wait is multiplied by backoffMultiplier.'),
  backoffMultiplier: z.number().positive().default(2).describe('Exponential backoff multiplier'),
});

export const VerifyRegistryCargoConfigSchema = z.object({
  enabled: z.boolean().default(true).describe('Verify Cargo publish'),
  maxAttempts: z.number().int().positive().default(10).describe('Maximum verification attempts'),
  initialDelay: z
    .number()
    .int()
    .positive()
    .default(30000)
    .describe('Wait in ms after the first failed check; each later wait is multiplied by backoffMultiplier.'),
  backoffMultiplier: z.number().positive().default(2).describe('Exponential backoff multiplier'),
});

export const VerifyRegistryPubConfigSchema = z.object({
  enabled: z.boolean().default(true).describe('Verify Dart pub publish'),
  maxAttempts: z.number().int().positive().default(10).describe('Maximum verification attempts'),
  initialDelay: z
    .number()
    .int()
    .positive()
    .default(30000)
    .describe('Wait in ms after the first failed check; each later wait is multiplied by backoffMultiplier.'),
  backoffMultiplier: z.number().positive().default(2).describe('Exponential backoff multiplier'),
});

export const VerifyConfigSchema = z.object({
  npm: VerifyRegistryNpmConfigSchema.default({
    enabled: true,
    maxAttempts: 5,
    initialDelay: 15000,
    backoffMultiplier: 2,
  }),
  cargo: VerifyRegistryCargoConfigSchema.default({
    enabled: true,
    maxAttempts: 10,
    initialDelay: 30000,
    backoffMultiplier: 2,
  }),
  pub: VerifyRegistryPubConfigSchema.default({
    enabled: true,
    maxAttempts: 10,
    initialDelay: 30000,
    backoffMultiplier: 2,
  }),
});

export const PublishConfigSchema = z.object({
  git: PublishGitConfigSchema.optional().describe('Git publishing options'),
  npm: NpmConfigSchema.default({
    enabled: true,
    auth: 'auto',
    provenance: true,
    access: 'public',
    registry: 'https://registry.npmjs.org',
    copyFiles: ['LICENSE'],
    tag: 'latest',
    publishOrder: [],
  }).describe('NPM publishing configuration'),
  cargo: CargoPublishConfigSchema.default({
    enabled: true,
    noVerify: false,
    publishOrder: [],
    clean: false,
  }).describe('Cargo publishing configuration'),
  pub: PubPublishConfigSchema.default({
    enabled: true,
    publishOrder: [],
  }).describe('Dart/Flutter publishing configuration via pub'),
  githubRelease: GitHubReleaseConfigSchema.default({
    enabled: true,
    draft: true,
    perPackage: true,
    prerelease: 'auto',
    body: 'auto',
    /* biome-ignore lint/suspicious/noTemplateCurlyInString: default template value */
    titleTemplate: '${packageName}: ${version}',
    skipPackages: [],
  }).describe('GitHub Release configuration'),
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
    pub: {
      enabled: true,
      maxAttempts: 10,
      initialDelay: 30000,
      backoffMultiplier: 2,
    },
  }).describe('Registry verification configuration'),
});

export const TemplateConfigSchema = z.object({
  path: z.string().optional().describe('Template file, or a directory of composable templates.'),
  engine: z
    .enum(['handlebars', 'liquid', 'ejs'])
    .optional()
    .describe('Template engine. Detected from the template files when omitted; ignored without path.'),
});

export const LocationModeSchema = z.enum(['root', 'packages', 'both']);

// Release notes are not a changelog, so they get a dedicated `file` config rather than the changelog's `mode` enum.
export const ReleaseNotesFileConfigSchema = z.object({
  dir: z.string().default('release-notes').describe('Directory for the per-version release-notes files.'),
});

export const ChangelogConfigSchema = z
  .object({
    mode: LocationModeSchema.optional().describe(
      "Where to write changelog files: 'root' (the default) at the repo root, 'packages' in each package (monorepos only), or 'both'.",
    ),
    file: z.string().optional().describe('Changelog file name override (default: CHANGELOG.md)'),
    templates: TemplateConfigSchema.optional().describe('Template configuration for changelog'),
    refs: z
      .enum(['strip', 'escape', 'link'])
      .default('link')
      .describe(
        "How `#NNN` issue/PR refs in the changelog are rendered. Applies to the whole entry — both the appended label and any bare `#N` carried over from the commit subject into the description (a description ref that also appears in the appended label is de-duplicated away). 'link' (default): the PR and the issues it closed are labelled as `(PR #503 · closes #500)`, where the PR links to its canonical /pull/ URL with `PR #503` as the visible text — this keeps the GitHub hovercard but stops the bare-token rich inline card that duplicated the entry; closed issues link to /issues/. An entry with no identifiable PR (a non-squash commit, or a non-GitHub repo) falls back to a plain ref list. 'escape': plain text \\#NNN (no link, no hovercard, no PR/closes labelling). 'strip': refs are removed entirely. Scoped-package / @user mentions in entry text are always neutralised regardless of this setting.",
      ),
    demoteScopes: z
      .array(z.string())
      .default([...DEFAULT_DEMOTE_SCOPES])
      .describe(
        'Conventional-commit scopes whose changelog entries are demoted into a trailing "Dependencies & version bumps" subsection instead of interleaving with Added / Fixed / Changed. Applies to the standing-PR changelogs — each releasable row and the "Show all changes" footer. Nothing is hidden or dropped: low-signal dependency bumps just stop crowding the user-facing changes at the top, and a reader who wants the exact per-package deps expands the subsection. The de-duplicated change count is unchanged. Default: ["deps", "deps-dev"] (the scopes Dependabot uses for production and development bumps). Set to [] to render every scope inline.',
      ),
  })
  .describe('Changelog file configuration');

export const LLMOptionsSchema = z.object({
  timeout: z
    .number()
    .int()
    .optional()
    .describe('Idle timeout in ms: a streamed response fails only when nothing arrives for this long. Default: 60000.'),
  maxTokens: z.number().int().optional().describe('Max tokens to generate. Default: 16384.'),
  temperature: z.number().optional().describe('Sampling temperature. Default: 0.7; the anthropic provider ignores it.'),
});

export const LLMRetryConfigSchema = z.object({
  maxAttempts: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('Maximum number of attempts, including the first. Default: 3.'),
  initialDelay: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe('Delay in ms before the first retry. Default: 1000.'),
  maxDelay: z.number().int().positive().optional().describe('Maximum delay in ms between attempts. Default: 30000.'),
  backoffFactor: z.number().positive().optional().describe('Delay multiplier per attempt. Default: 2.'),
});

export const LLMTasksConfigSchema = z.object({
  summarize: z.boolean().optional().describe('Write a 2–3 sentence summary of the release.'),
  enhance: z.boolean().optional().describe("Rewrite each entry's description to be clearer for users."),
  categorize: z.boolean().optional().describe('Group entries into the configured categories.'),
  releaseNotes: z
    .boolean()
    .optional()
    .describe('Write prose release notes for the GitHub Release body and any release-notes files.'),
});

export const LLMCategorySchema = z.object({
  name: z.string().describe("Category label shown in release notes (e.g. 'Features')"),
  description: z.string().describe('LLM instruction describing what commits belong in this category'),
  scopes: z.array(z.string()).optional().describe('Conventional commit scopes assigned to this category'),
});

export const ScopeRulesSchema = z.object({
  allowed: z
    .array(z.string())
    .optional()
    .describe('Explicit list of valid scope names; commits with unlisted scopes trigger invalidScopeAction'),
  caseSensitive: z.boolean().default(false).describe('Whether scope comparison is case-sensitive'),
  invalidScopeAction: z
    .enum(['remove', 'keep', 'fallback'])
    .default('remove')
    .describe(
      "Action for commits whose scope is not in the allowed list: 'remove' strips the scope, 'keep' leaves it, 'fallback' substitutes fallbackScope",
    ),
  fallbackScope: z.string().optional().describe("Scope substituted when invalidScopeAction is 'fallback'"),
});

export const ScopeConfigSchema = z.object({
  mode: z
    .enum(['restricted', 'packages', 'none', 'unrestricted'])
    .default('unrestricted')
    .describe(
      "Scope allowlist source: 'restricted' uses rules.allowed, 'packages' derives scopes from workspace package names, 'none' strips all scopes, 'unrestricted' allows any scope",
    ),
  rules: ScopeRulesSchema.optional().describe('Scope validation and transformation rules'),
});

export const LLMPromptOverridesSchema = z.object({
  enhance: z.string().optional().describe('For the enhance task when categorize is off.'),
  categorize: z.string().optional().describe('For the categorize task when enhance is off.'),
  enhanceAndCategorize: z
    .string()
    .optional()
    .describe('For the combined task that replaces enhance and categorize when both are on.'),
  summarize: z.string().optional().describe('For the summarize task.'),
  releaseNotes: z.string().optional().describe('For the releaseNotes task.'),
});

export const LLMPromptsConfigSchema = z.object({
  instructions: LLMPromptOverridesSchema.optional().describe(
    "Extra instructions appended to a task's built-in system prompt. The task's output format is unchanged.",
  ),
});

const LLMConfigBaseSchema = z.object({
  provider: z.enum(['openai', 'openai-compatible', 'anthropic', 'ollama']).describe('LLM provider'),
  model: z
    .string()
    // Otherwise "model": "" passes load and only fails deep in the pipeline.
    .min(1, 'model must be a non-empty string — set it to a model the provider serves.')
    .describe(
      'Model identifier for the selected provider. Required — releasekit ships no default, so enabling LLM enhancement needs an explicit, current model (a missing model fails config validation).',
    ),
  baseURL: z.string().optional().describe('Custom API base URL. Required for the openai-compatible provider.'),
  apiKey: z
    .string()
    .optional()
    .describe(
      "API key. When unset, releasekit uses the key saved by releasekit-notes auth, then the provider's environment variable (e.g. OPENAI_API_KEY); prefer either to an inline key.",
    ),
  options: LLMOptionsSchema.optional().describe('Options for each request to the provider.'),
  concurrency: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      "Parallelism limit, default 5. It caps the packages processed at once and, separately, the entries each package's standalone enhance task rewrites at once.",
    ),
  retry: LLMRetryConfigSchema.optional().describe('Retries for LLM requests that fail with a retryable error.'),
  tasks: LLMTasksConfigSchema.optional().describe('LLM tasks to run. Each is off unless set to true.'),
  categories: z
    .array(LLMCategorySchema)
    .default(() => [
      { name: 'Breaking', description: 'Breaking changes that require user action to upgrade' },
      { name: 'New', description: 'New features and capabilities' },
      { name: 'Changed', description: 'Changes to existing functionality' },
      { name: 'Fixed', description: 'Bug fixes' },
      { name: 'Developer', description: 'Internal changes: CI, tooling, dependencies, refactoring' },
    ])
    .describe(
      'Categories the categorize task sorts entries into. Default: Breaking, New, Changed, Fixed and Developer, each with a built-in description.',
    ),
  style: z
    .string()
    .default(
      'Write in past tense ("Added feature", not "Add feature"). Be concise and user-focused. Lead with the impact, not the implementation detail.',
    )
    .describe(
      'Writing-style instruction for the enhance and combined enhance+categorize prompts. Default: past tense, concise and user-focused, leading with the impact.',
    ),
  scopes: ScopeConfigSchema.optional().describe('Validation of the scopes the LLM assigns to entries.'),
  prompts: LLMPromptsConfigSchema.optional().describe('Per-task prompt additions.'),
  examples: z
    .number()
    .int()
    .min(0)
    .max(5)
    .default(3)
    .describe(
      "Number of the project's past GitHub Releases (0–5) used as style examples in the enhance+categorize and releaseNotes prompts. Needs GITHUB_TOKEN or GH_TOKEN.",
    ),
  context: z
    .object({
      pullRequests: z
        .boolean()
        .default(true)
        .describe("Fetch the title and body of each entry's linked PR as LLM context. Needs GITHUB_TOKEN or GH_TOKEN."),
    })
    .default({ pullRequests: true })
    .describe('Additional context sources for the LLM.'),
  categoryOrder: z
    .array(z.string())
    .optional()
    .describe(
      'Order of the rendered categories. Listed ones come first; the rest keep their categories order, except Breaking, which stays first unless listed.',
    ),
  cache: z
    .boolean()
    .default(false)
    .describe(
      'Cache LLM responses on disk (under the OS temp dir), keyed by a hash of the provider, model, prompt, and request options. A re-run or backfill with the same inputs reuses the cached generation instead of re-calling the provider. Off by default.',
    ),
});

// Validated here so a missing openai-compatible baseURL fails loudly rather than silently degrading to non-LLM notes
// inside the notes soft-fail catch.
export const LLMConfigSchema = LLMConfigBaseSchema.superRefine((cfg, ctx) => {
  if (cfg.provider === 'openai-compatible' && !cfg.baseURL) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['baseURL'],
      message: 'baseURL is required when provider is "openai-compatible".',
    });
  }
});

export const ReleaseNotesConfigSchema = z
  .object({
    file: ReleaseNotesFileConfigSchema.optional().describe(
      'Optional in-repo file output. Omit to keep release notes only on the GitHub release body (the default). When set, writes one immutable Markdown file per version under `dir` — release-notes/<package>/<version>.md in a monorepo, release-notes/<version>.md in a single-package repo — giving a browsable, provider-independent per-release history.',
    ),
    templates: TemplateConfigSchema.optional().describe(
      'Template for rendering release notes (e.g. to add docs-site frontmatter). Takes precedence over LLM prose and the default formatted section.',
    ),
    llm: LLMConfigSchema.optional().describe('LLM configuration for release notes'),
    links: z
      .object({
        items: z
          .array(
            z.object({
              label: z.string().describe('Link text'),
              url: z.string().url().describe('Link URL'),
            }),
          )
          .optional()
          .describe('Static links, each { label, url }, listed first.'),
        fromPRBodyMarker: z
          .string()
          .optional()
          .describe(
            'Also collect links from linked PR bodies: each line starting with this marker adds its markdown link or bare URL, skipping URLs already listed. Needs llm.context.pullRequests.',
          ),
        title: z.string().optional().describe('Heading for the links section. Default: Links.'),
      })
      .optional()
      .describe(
        'Links section the built-in renderer appends to each version. Rendered only when the categorize task produced categories.',
      ),
    firstRelease: z
      .union([
        z.literal(false).describe('Set to false to disable the first-release placeholder intro.'),
        z.object({
          text: z.string().optional().describe(
            // biome-ignore lint/suspicious/noTemplateCurlyInString: documenting placeholder syntax to the user
            "Placeholder intro line for a package's first release. Supports ${packageName} and ${version}. Default: '_First release of ${packageName}._'.",
          ),
        }),
      ])
      .optional()
      .describe(
        'First-release placeholder intro, shown when a package has no prior version (previousVersion is null). Default-on with a factual line; set to false to disable.',
      ),
  })
  .describe('Release notes configuration');

export const NotesInputConfigSchema = z.object({
  source: z.string().optional(),
  file: z.string().optional(),
});

export const NotesConfigSchema = z.object({
  changelog: z
    .union([z.literal(false).describe('Set to false to disable changelog generation'), ChangelogConfigSchema])
    .optional()
    .describe('Changelog files. On by default, writing CHANGELOG.md at the repo root; set to false to disable.'),
  releaseNotes: z
    .union([z.literal(false).describe('Set to false to disable release notes'), ReleaseNotesConfigSchema])
    .optional()
    .describe(
      "Release notes for the GitHub Release body and optional per-version files. Off unless set: {} turns them on with each version's changelog section as the content, and llm or templates change it.",
    ),
  updateStrategy: z
    .enum(['prepend', 'regenerate'])
    .optional()
    .describe(
      "How to update existing changelog files. 'prepend' (the default) adds the new entries at the top; 'regenerate' overwrites the file with this run's output.",
    ),
});

export const CILabelsConfigSchema = z.object({
  graduate: z
    .string()
    .default('release:graduate')
    .describe(
      'Label that graduates a prerelease to its stable base version (e.g. 1.0.0-next.6 → 1.0.0). A standalone release trigger in label/direct mode; in standing-pr mode it sets the next merge to graduate.',
    ),
  graduatePackagePrefix: z
    .string()
    .default('graduate:')
    .describe(
      'Prefix for per-package graduate labels on the standing PR. A `graduate:<package>` label graduates just that prerelease package (and, atomically, any fixed/linked group it belongs to) to its stable base version on the next update, while other prerelease packages stay on their line. The whole-batch `graduate` label still graduates everything. Standing-pr mode only.',
    ),
  prerelease: z
    .string()
    .default('channel:prerelease')
    .describe('Label that makes the release a prerelease. In label-trigger mode it needs a bump label too.'),
  skip: z
    .string()
    .default('release:skip')
    .describe(
      'Label that stops a merged PR from releasing. Commit-trigger mode only; in label mode, leave off the bump label instead.',
    ),
  immediate: z
    .string()
    .default('release:immediate')
    .describe('Label to bypass the standing PR for one merge — triggers a direct release. Standing-pr mode only.'),
  retry: z
    .string()
    .default('release:retry')
    .describe('Label to retry a failed publish by re-applying it to a merged standing PR. Standing-pr mode only.'),
  previewNotes: z
    .string()
    .default('release:preview-notes')
    .describe(
      'Label on the standing PR that generates LLM release notes on demand into an editable region in the PR body, for review and editing before merge. Standing-pr mode only.',
    ),
  major: z.string().default('bump:major').describe('Label to force a major bump'),
  minor: z.string().default('bump:minor').describe('Label to force a minor bump'),
  patch: z.string().default('bump:patch').describe('Label to force a patch bump'),
  withPrerequisites: z
    .string()
    .default('release:with-prerequisites')
    .describe(
      'Label on the standing PR that also releases the changed prerequisites (transitive internal dependencies) of the targeted/scoped packages — each at its own commit-driven bump. Standing-pr mode only.',
    ),
});

export const StandingPrConfigSchema = z.object({
  branch: z
    .string()
    .default('release/next')
    .describe(
      "Branch name for the standing release PR. Each update resets it to the base branch and force-pushes it, so don't commit to it.",
    ),
  title: z.string().optional().describe(
    // biome-ignore lint/suspicious/noTemplateCurlyInString: documenting placeholder syntax to the user
    "PR title template. Variables: ${count} (publishable package count), ${version} (the first publishable package's new version), ${tag} (version with tag prefix). Also the release commit's subject, so it must match a release.ci.skipPatterns entry and carry no CI-skip marker. A title with a CI-skip marker is replaced by 'chore: release preparation'. So is one the skip patterns miss, if they match 'chore: release preparation'. The run warns either way. Default depends on the versioning strategy: 'chore: release ${tag}' in sync mode, 'chore: release ${count} package(s)' otherwise.",
  ),
  labels: z
    .array(z.string())
    .default(['release'])
    .describe(
      'Labels to apply to the standing release PR. Leave out the ci.labels release-control labels: the standing PR reads its own labels as overrides.',
    ),
  deleteBranchOnMerge: z
    .boolean()
    .default(true)
    .describe(
      "Whether to auto-delete the release branch after the PR is merged. Publish keeps it if an update has moved it since the merge, or if the merged PR's head commit can't be read.",
    ),
  mergeMethod: z
    .enum(['merge', 'squash', 'rebase'])
    .default('merge')
    .describe(
      "Merge method for releasekit standing-pr merge. Use 'squash' or 'rebase' so the release commit's subject reaches the base branch, where release.ci.skipPatterns can match it.",
    ),
  minAge: z
    .string()
    .optional()
    .describe(
      "Minimum age of the standing PR, counted from when it was first opened, before it can be merged. Duration string, e.g. '6h', '30m', '1d'. Gate enforced via the releasekit/standing-pr commit status check; configure it as a required status check in branch protection to block merges.",
    ),
  minPackages: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      'Minimum number of packages with releasable changes required to create or maintain the standing PR. Below this threshold the PR is closed and no new PR is opened.',
    ),
  authorization: z
    .object({
      requiredPermission: z
        .enum(['admin', 'maintain', 'write'])
        .default('admin')
        .describe(
          'Minimum repository permission an actor needs to steer the standing PR — tick/untick selection checkboxes, flip per-row channel toggles, apply release labels, and (with branch protection) merge. Default: admin.',
        ),
      allowedActors: z
        .array(
          // `@octocat` (no slash) is neither a username nor a team and would silently match nobody.
          z.string().regex(/^(?:[A-Za-z0-9-]+|@[A-Za-z0-9-]+\/[A-Za-z0-9._-]+)$/, {
            message:
              'allowedActors entries must be a GitHub username (e.g. "octocat") or a team as "@org/team-slug" (note the slash).',
          }),
        )
        .optional()
        .describe(
          'Extra actors authorized regardless of permission level: GitHub usernames, or "@org/team-slug" to authorize a whole team. Team-membership checks need a token with read:org scope (a PAT or GitHub App), not the default GITHUB_TOKEN; without it, team entries fail closed — the 403 is surfaced as a warning and the actor is not authorized.',
        ),
      enforceMergeAuthor: z
        .boolean()
        .default(true)
        .describe(
          'Refuse to publish the standing PR when the actor who merged it is not authorized (defense-in-depth behind a branch-protection ruleset, which is the primary merge gate). Set false to rely on branch protection alone.',
        ),
    })
    .optional()
    .describe(
      'Restrict who can steer the standing PR — its selection checkboxes, per-row channel toggles, release labels, and merge. Omit to allow anyone with the GitHub permission GitHub itself requires for each action.',
    ),
  primaryPackages: z
    .array(z.string())
    .default([])
    .describe(
      'Packages that drive releases — rendered as parent rows in the standing-PR selection list, with their coupled group-mates and changed prerequisites nested beneath, so one parent toggle holds back the whole release unit. Glob patterns or exact names. Empty (default) → flat per-package list (current behavior).',
    ),
  selection: z
    .enum(['streamlined', 'granular'])
    .default('streamlined')
    .describe(
      'How the selection list renders when primaryPackages is set. streamlined: one checkbox per primary, coupled members shown read-only in a collapsed pane, and a held-back primary cascades to its unit. granular: every package keeps its own checkbox, nested under its primary, with no cascade. No effect when primaryPackages is empty.',
    ),
  combinedChangelogFooter: z
    .boolean()
    .default(true)
    .describe(
      'Append the de-duplicated combined-changelog footer to the standing PR: every change listed once, flat across packages and grouped by change type (Added/Fixed/Changed). It complements the per-row changelogs co-located with each releasable row. Set false to suppress this redundant per-package summary — the per-row changelogs remain, project-wide (shared) changes are still shown in their own block, and sync releases (which have no per-row changelogs) always show the combined changelog regardless of this setting.',
    ),
  channelToggle: z
    .boolean()
    .default(false)
    .describe(
      'Add a per-row channel toggle to the standing-PR selection list: a nested checkbox under each releasable row to ship a stable package as a prerelease (→ X.Y.Z-next.0 on the `next` dist-tag) or graduate a prerelease package to its stable base — shifting just that package (and its group) without narrowing the release. Off by default so repos that do not need it keep the tight one-line-per-package list. A held-back (unticked) row hides its channel toggle. No effect on sync releases (which ship atomically as one unit).',
    ),
  summaryTable: z
    .boolean()
    .default(false)
    .describe(
      'Render a collapsed "Version summary" table near the top of the standing PR: one row per publishing package showing its current version, next version, bump magnitude, and dist-tag. A scannable from → to overview (the Dependabot mental model) that complements the interactive checkbox list — which GitHub only renders as a list, never in a table cell. Off by default.',
    ),
});

export const CIConfigSchema = z.object({
  releaseStrategy: z
    .enum(['manual', 'direct', 'standing-pr'])
    .default('direct')
    .describe(
      "How releases are delivered. 'direct': release on merge to main. 'manual': releases triggered manually (e.g. workflow_dispatch). 'standing-pr': changes accumulate in a release PR; gate mode acts as the immediate-release evaluator, firing only for merges labelled with the immediate label.",
    ),
  releaseTrigger: z
    .enum(['commit', 'label'])
    .default('label')
    .describe(
      "What triggers a release. 'label': a PR bump label (bump:patch/minor/major) is required. 'commit': conventional commits drive the bump automatically; every merge can trigger a release.",
    ),
  prPreview: z
    .union([
      z.boolean(),
      z.object({
        enabled: z.boolean().default(true).describe('Whether PR preview comments are posted.'),
        refreshAfterRelease: z
          .boolean()
          .default(false)
          .describe(
            'After a release completes, replay the preview comment on still-open feeder PRs so their "what would release" estimate is not left stale against the moved baseline. Cosmetic and best-effort — a failure here never fails the release. Driven automatically in-process after a successful release (both the direct and standing-PR publish paths); the standalone `refresh-after-release` command also performs it for setups that run it as a separate step.',
          ),
      }),
    ])
    .default(true)
    .transform((v) =>
      typeof v === 'boolean'
        ? { enabled: v, refreshAfterRelease: false }
        : { enabled: v.enabled ?? true, refreshAfterRelease: v.refreshAfterRelease ?? false },
    )
    .describe(
      'PR preview comments showing what would be released if the PR is merged. `true`/`false` toggles them; the object form additionally enables `refreshAfterRelease` to refresh feeder-PR previews after a release.',
    ),
  labels: CILabelsConfigSchema.default({
    graduate: 'release:graduate',
    graduatePackagePrefix: 'graduate:',
    prerelease: 'channel:prerelease',
    skip: 'release:skip',
    immediate: 'release:immediate',
    retry: 'release:retry',
    previewNotes: 'release:preview-notes',
    major: 'bump:major',
    minor: 'bump:minor',
    patch: 'bump:patch',
    withPrerequisites: 'release:with-prerequisites',
  }).describe("PR label names used for release control. Override to match your repository's label conventions."),
  scopeLabels: z
    .record(z.string(), z.string())
    .optional()
    .describe(
      'Map of scope labels to package patterns. When a PR has a label matching a key, only packages matching the corresponding pattern are released.',
    ),
  standingPr: StandingPrConfigSchema.optional().describe(
    "Configuration for the standing release PR feature (ci.releaseStrategy: 'standing-pr').",
  ),
});

export const ReleaseCIConfigSchema = z.object({
  skipPatterns: z
    .array(z.string().min(1))
    .optional()
    .describe(
      "Strings that skip a release, gate run or standing-PR update when found anywhere in the HEAD commit's subject. When unset, only standing-PR updates skip, and only on 'chore: release '.",
    ),
  minChanges: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('Minimum number of packages with releasable changes required to trigger a release'),
  githubRelease: z.literal(false).optional().describe('Set to false to disable GitHub release creation in CI'),
  notes: z.literal(false).optional().describe('Set to false to disable changelog generation in CI'),
});

export const ReleaseConfigSchema = z.object({
  steps: z
    .array(z.enum(['notes', 'publish']))
    .min(1)
    .optional()
    .describe('Which steps to run by default. Omitting a step is equivalent to --skip-<step>.'),
  ci: ReleaseCIConfigSchema.optional().describe('CI-specific automation settings'),
});

export const ReleaseKitConfigSchema = z
  .object({
    $schema: z.string().optional().describe('JSON schema reference URL'),
    git: GitConfigSchema.optional().describe('Git configuration'),
    monorepo: MonorepoConfigSchema.optional().describe('Monorepo configuration'),
    version: VersionConfigSchema.optional().describe('Versioning configuration'),
    publish: PublishConfigSchema.optional().describe('Publishing configuration'),
    notes: NotesConfigSchema.optional().describe('Changelog and release notes configuration'),
    ci: CIConfigSchema.optional().describe(
      'CI automation configuration for release triggers, PR previews, and label management',
    ),
    release: ReleaseConfigSchema.optional().describe('Release pipeline automation configuration'),
  })
  .describe('Configuration schema for ReleaseKit - Automated versioning, changelog generation, and publishing');

export type CIConfig = z.infer<typeof CIConfigSchema>;
export type CILabelsConfig = z.infer<typeof CILabelsConfigSchema>;
export type StandingPrConfig = z.infer<typeof StandingPrConfigSchema>;
export type GitConfig = z.infer<typeof GitConfigSchema>;
export type MonorepoConfig = z.infer<typeof MonorepoConfigSchema>;
export type VersionConfig = z.infer<typeof VersionConfigSchema>;
export type Preset = z.infer<typeof PresetSchema>;
export type VersionGroup = z.infer<typeof VersionGroupSchema>;
export type NpmConfig = z.infer<typeof NpmConfigSchema>;
export type CargoPublishConfig = z.infer<typeof CargoPublishConfigSchema>;
export type PubPublishConfig = z.infer<typeof PubPublishConfigSchema>;
export type PublishGitConfig = z.infer<typeof PublishGitConfigSchema>;
export type GitHubReleaseConfig = z.infer<typeof GitHubReleaseConfigSchema>;
export type VerifyConfig = z.infer<typeof VerifyConfigSchema>;
export type PublishConfig = z.infer<typeof PublishConfigSchema>;
export type LocationMode = z.infer<typeof LocationModeSchema>;
export type ChangelogConfig = z.infer<typeof ChangelogConfigSchema>;
export type ReleaseNotesConfig = z.infer<typeof ReleaseNotesConfigSchema>;
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
