import { z } from 'zod';

// ---------------------------------------------------------------------------
// NOTE FOR EDITORS
//
// Field descriptions live here as Zod `.describe()` calls. They are the single
// source of truth: `releasekit.schema.json` is generated from this file via
// `pnpm schema:gen` (scripts/generate-schema.ts), and `docs/configuration.md`
// is generated from that JSON Schema via `pnpm docs:config`. Never hand-edit
// `releasekit.schema.json`; `pnpm schema:check` enforces that it matches Zod in
// CI. To change a description or add a field, edit it here and run `pnpm
// schema:gen` (then `pnpm docs:config`).
// ---------------------------------------------------------------------------

export const GitConfigSchema = z.object({
  remote: z.string().default('origin').describe('Git remote name'),
  branch: z.string().default('main').describe('Default branch name'),
  pushMethod: z.enum(['auto', 'ssh', 'https']).default('auto').describe('Method for pushing to remote'),
  push: z.boolean().optional().describe('Whether to push changes to remote'),
  httpsTokenEnv: z.string().optional().describe('Environment variable name containing a GitHub token for HTTPS pushes'),
  skipHooks: z.boolean().optional().describe('Skip Git hooks when committing'),
});

export const MonorepoConfigSchema = z.object({
  mode: z.enum(['root', 'packages', 'both']).optional().describe('Changelog aggregation mode'),
  rootPath: z.string().optional().describe('Path to root changelog'),
  packagesPath: z.string().optional().describe('Path to packages directory'),
  mainPackage: z.string().optional().describe('Main package name for versioning'),
});

export const BranchPatternSchema = z.object({
  pattern: z.string().describe("Glob or regex matched against the branch name (e.g. 'release/*')"),
  releaseType: z
    .enum(['major', 'minor', 'patch', 'prerelease'])
    .describe('Version bump type applied when this pattern matches'),
});

export const VersionCargoConfigSchema = z.object({
  enabled: z.boolean().default(true).describe('Enable Cargo.toml version handling'),
  paths: z.array(z.string()).optional().describe('Directories to search for Cargo.toml files'),
});

export const VersionPubConfigSchema = z.object({
  enabled: z.boolean().default(true).describe('Enable pubspec.yaml version handling'),
  paths: z.array(z.string()).optional().describe('Directories to search for pubspec.yaml files'),
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
  preset: z.string().default('conventional').describe('Commit convention preset'),
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
  packages: z.array(z.string()).default([]).describe('Packages to include in versioning'),
  sharedPackages: z
    .array(z.string())
    .optional()
    .describe(
      'Foundational packages whose changes belong in every package’s changelog. A commit touching only a shared package (exact name or glob) is classified as repo-level and surfaced under "Project-wide changes" rather than attributed to that one package. Default: none — no package is treated as shared unless declared.',
    ),
  mainPackage: z.string().optional().describe('Package to use for version determination'),
  updateInternalDependencies: z
    .enum(['major', 'minor', 'patch', 'no-internal-update'])
    .default('minor')
    .describe('How to bump internal dependencies'),
  skip: z.array(z.string()).optional().describe('Packages to exclude from versioning'),
  commitMessage: z.string().optional().describe('Template for release commit messages'),
  versionStrategy: z
    .enum(['branchPattern', 'commitMessage'])
    .default('commitMessage')
    .describe('Strategy for determining version bumps'),
  branchPatterns: z.array(BranchPatternSchema).optional().describe('Branch name patterns for version determination'),
  defaultReleaseType: z
    .enum(['major', 'minor', 'patch', 'prerelease'])
    .optional()
    .describe('Default release type when no pattern matches'),
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
  cargo: VersionCargoConfigSchema.optional().describe('Cargo/Rust configuration'),
  pub: VersionPubConfigSchema.optional().describe('Dart/Flutter pub configuration'),
});

export const NpmConfigSchema = z.object({
  enabled: z.boolean().default(true).describe('Enable NPM publishing'),
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
  enabled: z.boolean().default(false).describe('Enable Cargo publishing'),
  noVerify: z.boolean().default(false).describe('Skip verification before publish'),
  publishOrder: z.array(z.string()).default([]).describe('Order in which to publish packages'),
  clean: z.boolean().default(false).describe('Clean before publishing'),
});

export const PubPublishConfigSchema = z.object({
  enabled: z.boolean().default(false).describe('Enable pub.dev publishing'),
  publishOrder: z.array(z.string()).default([]).describe('Order in which to publish packages'),
});

export const PublishGitConfigSchema = z.object({
  push: z.boolean().default(true).describe('Push tags and commits to remote'),
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
  initialDelay: z.number().int().positive().default(15000).describe('Initial delay in milliseconds'),
  backoffMultiplier: z.number().positive().default(2).describe('Exponential backoff multiplier'),
});

export const VerifyRegistryCargoConfigSchema = z.object({
  enabled: z.boolean().default(true).describe('Verify Cargo publish'),
  maxAttempts: z.number().int().positive().default(10).describe('Maximum verification attempts'),
  initialDelay: z.number().int().positive().default(30000).describe('Initial delay in milliseconds'),
  backoffMultiplier: z.number().positive().default(2).describe('Exponential backoff multiplier'),
});

export const VerifyRegistryPubConfigSchema = z.object({
  enabled: z.boolean().default(true).describe('Verify Dart pub publish'),
  maxAttempts: z.number().int().positive().default(10).describe('Maximum verification attempts'),
  initialDelay: z.number().int().positive().default(30000).describe('Initial delay in milliseconds'),
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
    enabled: false,
    noVerify: false,
    publishOrder: [],
    clean: false,
  }).describe('Cargo publishing configuration'),
  pub: PubPublishConfigSchema.default({
    enabled: false,
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
  path: z.string().optional().describe('Path to custom template'),
  engine: z.enum(['handlebars', 'liquid', 'ejs']).optional().describe('Template engine'),
});

export const LocationModeSchema = z.enum(['root', 'packages', 'both']);

// Release notes are not a changelog, so they don't share the changelog's location modes. Their
// only file shape is an immutable per-version directory; the default target is the GitHub release
// body (no file). Hence a dedicated `file` config rather than a `mode` enum.
export const ReleaseNotesFileConfigSchema = z.object({
  dir: z.string().default('release-notes').describe('Directory for the per-version release-notes files.'),
});

export const ChangelogConfigSchema = z
  .object({
    mode: LocationModeSchema.optional().describe(
      'Where to write changelog files. root: repo root only. packages: per-package (monorepos). both: repo root and per-package. When omitted entirely (no changelog config), defaults to root.',
    ),
    file: z.string().optional().describe('Changelog file name override (default: CHANGELOG.md)'),
    templates: TemplateConfigSchema.optional().describe('Template configuration for changelog'),
  })
  .describe('Changelog file configuration');

export const LLMOptionsSchema = z.object({
  timeout: z.number().int().optional().describe('Request timeout in ms'),
  maxTokens: z.number().int().optional().describe('Max tokens to generate'),
  temperature: z.number().optional().describe('Sampling temperature'),
});

export const LLMRetryConfigSchema = z.object({
  maxAttempts: z.number().int().positive().optional().describe('Maximum number of attempts'),
  // `.int()` here matches the generated JSON Schema (`type: integer`, `minimum`),
  // and closes a pre-generator gap where the Zod runtime accepted floats. Keep
  // these in sync with scripts/generate-schema.ts — relaxing one without the
  // other re-introduces the divergence.
  initialDelay: z.number().int().nonnegative().optional().describe('Initial delay in ms'),
  maxDelay: z.number().int().positive().optional().describe('Maximum delay in ms'),
  backoffFactor: z.number().positive().optional().describe('Delay multiplier per attempt'),
});

export const LLMTasksConfigSchema = z.object({
  summarize: z.boolean().optional().describe('Enable summarization'),
  enhance: z.boolean().optional().describe('Enable entry enhancement'),
  categorize: z.boolean().optional().describe('Enable categorization'),
  releaseNotes: z.boolean().optional().describe('Enable release note generation'),
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
  enhance: z.string().optional().describe('Instruction override for the enhance task'),
  categorize: z.string().optional().describe('Instruction override for the categorize task'),
  enhanceAndCategorize: z
    .string()
    .optional()
    .describe('Instruction override for the combined enhance + categorize task'),
  summarize: z.string().optional().describe('Instruction override for the summarize task'),
  releaseNotes: z.string().optional().describe('Instruction override for the release-notes task'),
});

export const LLMPromptsConfigSchema = z.object({
  instructions: LLMPromptOverridesSchema.optional().describe(
    'Per-task instruction overrides appended to the built-in prompts.',
  ),
});

export const LLMConfigSchema = z.object({
  provider: z.string().describe('LLM provider'),
  model: z.string().describe('Model identifier'),
  baseURL: z.string().optional().describe('Custom API base URL'),
  apiKey: z.string().optional().describe('API key'),
  options: LLMOptionsSchema.optional(),
  concurrency: z.number().int().positive().optional().describe('Concurrent LLM requests'),
  retry: LLMRetryConfigSchema.optional(),
  tasks: LLMTasksConfigSchema.optional(),
  categories: z.array(LLMCategorySchema).default(() => [
    { name: 'Breaking', description: 'Breaking changes that require user action to upgrade' },
    { name: 'New', description: 'New features and capabilities' },
    { name: 'Changed', description: 'Changes to existing functionality' },
    { name: 'Fixed', description: 'Bug fixes' },
    { name: 'Developer', description: 'Internal changes: CI, tooling, dependencies, refactoring' },
  ]),
  style: z
    .string()
    .default(
      'Write in past tense ("Added feature", not "Add feature"). Be concise and user-focused. Lead with the impact, not the implementation detail.',
    )
    .describe('Writing style for LLM'),
  scopes: ScopeConfigSchema.optional(),
  prompts: LLMPromptsConfigSchema.optional(),
  examples: z
    .number()
    .int()
    .min(0)
    .max(5)
    .default(3)
    .describe('Number of few-shot examples to include in LLM prompts (0–5).'),
  context: z
    .object({
      pullRequests: z.boolean().default(true).describe('Include linked pull request titles/bodies as context.'),
    })
    .default({ pullRequests: true })
    .describe('Additional context sources for the LLM.'),
  categoryOrder: z
    .array(z.string())
    .optional()
    .describe(
      'Explicit ordering of categories in the output. Categories not listed retain their configured order after the listed ones.',
    ),
  cache: z
    .boolean()
    .default(false)
    .describe(
      'Cache LLM responses on disk (under the OS temp dir), keyed by a hash of the provider, model, prompt, and request options. A re-run or backfill with the same inputs reuses the cached generation instead of re-calling the provider. Off by default.',
    ),
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
          .describe('Static list of links to append.'),
        fromPRBodyMarker: z
          .string()
          .optional()
          .describe('Marker string in PR bodies; content after it is extracted and appended as links.'),
        title: z.string().optional().describe('Heading for the links section.'),
      })
      .optional()
      .describe('Extra links to append to the release notes.'),
    firstRelease: z
      .union([
        z.literal(false).describe('Set to false to disable the first-release placeholder intro.'),
        z.object({
          text: z.string().optional().describe(
            // biome-ignore lint/suspicious/noTemplateCurlyInString: documenting placeholder syntax to the user
            "Placeholder intro line for a package's first release. Supports ${packageName} and ${version}. Defaults to a factual line so it reads cleanly even when published unedited.",
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
    .optional(),
  releaseNotes: z
    .union([z.literal(false).describe('Set to false to disable release notes'), ReleaseNotesConfigSchema])
    .optional(),
  updateStrategy: z
    .enum(['prepend', 'regenerate'])
    .optional()
    .describe(
      "How to update existing changelog files. 'prepend' adds new entries to the top; 'regenerate' rewrites the file from scratch.",
    ),
});

export const CILabelsConfigSchema = z.object({
  stable: z.string().default('channel:stable').describe('Label to graduate a prerelease to stable'),
  prerelease: z.string().default('channel:prerelease').describe('Label to create a prerelease'),
  skip: z.string().default('release:skip').describe('Label to suppress a release on this PR'),
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
  branch: z.string().default('release/next').describe('Branch name for the standing release PR.'),
  title: z.string().optional().describe(
    // biome-ignore lint/suspicious/noTemplateCurlyInString: documenting placeholder syntax to the user
    "PR title template. Variables: ${count} (publishable package count), ${version} (raw version), ${tag} (version with tag prefix). Must start with 'chore: release' to match the default skip pattern on squash merge. Default depends on the versioning strategy: 'chore: release ${tag}' in sync mode, 'chore: release ${count} package(s)' otherwise.",
  ),
  labels: z.array(z.string()).default(['release']).describe('Labels to apply to the standing release PR.'),
  deleteBranchOnMerge: z
    .boolean()
    .default(true)
    .describe('Whether to auto-delete the release branch after the PR is merged.'),
  mergeMethod: z
    .enum(['merge', 'squash', 'rebase'])
    .default('merge')
    .describe('Merge method to use when merging the standing release PR via CLI.'),
  minAge: z
    .string()
    .optional()
    .describe(
      "Minimum age of the standing PR before it can be merged. Duration string, e.g. '6h', '30m', '1d'. Gate enforced via the releasekit/standing-pr commit status check; configure it as a required status check in branch protection to block merges.",
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
          'Minimum repository permission an actor needs to steer the standing PR — tick/untick selection checkboxes, apply release labels, and (with branch protection) merge. Default: admin.',
        ),
      allowedActors: z
        .array(
          // A GitHub username (e.g. `octocat`) or a team as `@org/team-slug`. The `@…/…` form needs
          // the slash — `@octocat` is neither a username nor a team and would silently match nobody,
          // so reject it at config-load time. Round-trips into the JSON Schema as `pattern`.
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
      'Restrict who can steer the standing PR — its selection checkboxes, release labels, and merge. Omit to allow anyone with the GitHub permission GitHub itself requires for each action (today’s behavior).',
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
    .boolean()
    .default(true)
    .describe(
      'Enable PR preview comments showing what would be released if the PR is merged. Set to false to disable.',
    ),
  autoRelease: z
    .boolean()
    .default(false)
    .describe('Automatically trigger a release when CI conditions are met, without manual intervention.'),
  skipPatterns: z
    .array(z.string())
    .default(['chore: release '])
    .describe(
      'Commit message prefixes that suppress a release. The default matches the release commit template to prevent release loops.',
    ),
  minChanges: z
    .number()
    .int()
    .positive()
    .default(1)
    .describe('Minimum number of packages with releasable changes required to trigger a release.'),
  labels: CILabelsConfigSchema.default({
    stable: 'channel:stable',
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
    .describe("Commit message prefixes that prevent a release (e.g. 'chore(deps):', 'ci:')"),
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
