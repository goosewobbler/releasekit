<!-- AUTO-GENERATED FROM releasekit.schema.json — DO NOT EDIT DIRECTLY -->
<!-- Run `pnpm docs:config` to regenerate -->

# Configuration Reference

ReleaseKit is configured via a `releasekit.config.json` file in the root of your repository. Add a `$schema` reference for editor autocompletion:

```json
{
  "$schema": "https://goosewobbler.github.io/releasekit/schema.json"
}
```

---

## `git`

Git configuration.

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `remote` | string | `"origin"` | Git remote name |
| `branch` | string | `"main"` | Default branch name |
| `pushMethod` | `"auto"` \| `"ssh"` \| `"https"` | `"auto"` | Method for pushing to remote |
| `push` | boolean | — | Whether to push changes to remote |
| `httpsTokenEnv` | string | — | Environment variable name containing a GitHub token for HTTPS pushes |
| `skipHooks` | boolean | — | Skip Git hooks when committing |

---

## `monorepo`

Monorepo configuration.

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `mode` | `"root"` \| `"packages"` \| `"both"` | — | Changelog aggregation mode |
| `rootPath` | string | — | Path to root changelog |
| `packagesPath` | string | — | Path to packages directory |
| `mainPackage` | string | — | Main package name for versioning |

---

## `version`

Versioning configuration.

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `tagTemplate` | string | `"${prefix}${version}"` | Template for Git tags. Available variables: ${version} (version number), ${prefix} (versionPrefix value, e.g. 'v'), ${packageName} (sanitized package name, e.g. 'scope-pkg'). Example: "${packageName}-${prefix}${version}" produces "scope-pkg-v1.2.3". |
| `packageSpecificTags` | boolean | false | Enable package-specific tagging |
| `preset` | string | `"conventional"` | Commit convention preset |
| `sync` | boolean | true | Sync versions across packages |
| `packages` | `string[]` | `[]` | Packages to include in versioning |
| `mainPackage` | string | — | Package to use for version determination |
| `updateInternalDependencies` | `"major"` \| `"minor"` \| `"patch"` \| `"no-internal-update"` | `"minor"` | How to bump internal dependencies |
| `skip` | `string[]` | — | Packages to exclude from versioning |
| `commitMessage` | string | — | Template for release commit messages |
| `versionStrategy` | `"branchPattern"` \| `"commitMessage"` | `"commitMessage"` | Strategy for determining version bumps |
| `defaultReleaseType` | `"major"` \| `"minor"` \| `"patch"` \| `"prerelease"` | — | Default release type when no pattern matches |
| `mismatchStrategy` | `"error"` \| `"warn"` \| `"ignore"` \| `"prefer-package"` \| `"prefer-git"` | `"warn"` | How to handle version mismatches |
| `versionPrefix` | string | `""` | Prefix for version tags |
| `prereleaseIdentifier` | string | — | Identifier for prerelease versions (e.g., 'alpha', 'beta') |
| `baseBranch` | string | — | Base branch for versioning |
| `strictReachable` | boolean | false | Only use reachable tags |

**`version.branchPatterns`** — Branch name patterns for version determination.

Array of objects with the following properties:

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `pattern` | string | — |  |
| `releaseType` | `"major"` \| `"minor"` \| `"patch"` \| `"prerelease"` | — |  |

### `version.cargo`

Cargo/Rust configuration.

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `enabled` | boolean | true | Enable Cargo.toml version handling |
| `paths` | `string[]` | — | Directories to search for Cargo.toml files |

---

## `publish`

Publishing configuration.


### `publish.git`

Git publishing options.

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `push` | boolean | true | Push tags and commits to remote |
| `pushMethod` | `"auto"` \| `"ssh"` \| `"https"` | — | Push method override |
| `remote` | string | — | Remote name override |
| `branch` | string | — | Branch name override |
| `httpsTokenEnv` | string | — | Environment variable name containing a GitHub token for HTTPS pushes |
| `skipHooks` | boolean | — | Skip Git hooks when committing |

### `publish.npm`

NPM publishing configuration.

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `enabled` | boolean | true | Enable NPM publishing |
| `auth` | `"auto"` \| `"oidc"` \| `"token"` | `"auto"` | Authentication method |
| `provenance` | boolean | true | Enable npm provenance attestation |
| `access` | `"public"` \| `"restricted"` | `"public"` | Package access level |
| `registry` | string | `"https://registry.npmjs.org"` | NPM registry URL |
| `copyFiles` | `string[]` | `["LICENSE"]` | Files to copy to package before publishing |
| `tag` | string | `"latest"` | NPM dist tag |

### `publish.cargo`

Cargo publishing configuration.

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `enabled` | boolean | false | Enable Cargo publishing |
| `noVerify` | boolean | false | Skip verification before publish |
| `publishOrder` | `string[]` | `[]` | Order in which to publish packages |
| `clean` | boolean | false | Clean before publishing |

### `publish.githubRelease`

GitHub Release configuration.

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `enabled` | boolean | true | Enable GitHub releases |
| `draft` | boolean | true | Create as draft release |
| `perPackage` | boolean | true | Create separate release per package |
| `prerelease` | boolean \| `"auto"` | `"auto"` | Mark as prerelease |
| `body` | `"auto"` \| `"releaseNotes"` \| `"changelog"` \| `"generated"` \| `"none"` | `"auto"` | Source for GitHub release body. 'auto': use release notes if enabled, else changelog, else GitHub auto. 'releaseNotes': use LLM-generated release notes. 'changelog': use changelog entries. 'generated': GitHub auto-generated. 'none': no body. |
| `titleTemplate` | string | `"${packageName}: ${version}"` | Template for the GitHub release title when a package name is resolved. Available variables: ${packageName} (original scoped name, e.g. '@scope/pkg'), ${version} (e.g. 'v1.0.0'). Version-only tags always use the tag string directly. |

### `publish.verify`

Registry verification configuration.


#### `publish.verify.npm`

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `enabled` | boolean | true | Verify NPM publish |
| `maxAttempts` | integer | 5 | Maximum verification attempts |
| `initialDelay` | integer | 15000 | Initial delay in milliseconds |
| `backoffMultiplier` | number | 2 | Exponential backoff multiplier |

#### `publish.verify.cargo`

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `enabled` | boolean | true | Verify Cargo publish |
| `maxAttempts` | integer | 10 | Maximum verification attempts |
| `initialDelay` | integer | 30000 | Initial delay in milliseconds |
| `backoffMultiplier` | number | 2 | Exponential backoff multiplier |

---

## `notes`

Changelog and release notes configuration.


| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `updateStrategy` | `"prepend"` \| `"regenerate"` | — | How to update existing changelog files. 'prepend' adds new entries to the top; 'regenerate' rewrites the file from scratch. |

### `notes.changelog`

Set to `false` to disable.

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `mode` | `"root"` \| `"packages"` \| `"both"` | — | Where to write changelog files. root: repo root only. packages: per-package (monorepos). both: repo root and per-package. When omitted entirely (no changelog config), defaults to root. |
| `file` | string | — | Changelog file name override (default: CHANGELOG.md) |

**`notes.changelog.templates`** — Template configuration for changelog.

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `path` | string | — | Path to custom template |
| `engine` | `"handlebars"` \| `"liquid"` \| `"ejs"` | — | Template engine |

### `notes.releaseNotes`

Set to `false` to disable.

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `mode` | `"root"` \| `"packages"` \| `"both"` | — | Where to write release notes file. Omit to skip file output (LLM still runs if configured). |
| `file` | string | — | Release notes file name override (default: RELEASE_NOTES.md) |

**`notes.releaseNotes.templates`** — Template configuration for release notes.

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `path` | string | — | Path to custom template |
| `engine` | `"handlebars"` \| `"liquid"` \| `"ejs"` | — | Template engine |

### `notes.releaseNotes.llm`

LLM configuration for release notes.


| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `provider` | string | — | LLM provider |
| `model` | string | — | Model identifier |
| `baseURL` | string | — | Custom API base URL |
| `apiKey` | string | — | API key |
| `concurrency` | integer | — | Concurrent LLM requests |
| `style` | string | — | Writing style for LLM |

#### `notes.releaseNotes.llm.options`

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `timeout` | integer | — | Request timeout in ms |
| `maxTokens` | integer | — | Max tokens to generate |
| `temperature` | number | — | Sampling temperature |

#### `notes.releaseNotes.llm.tasks`

Enable or disable individual LLM processing tasks.

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `summarize` | boolean | — | Enable summarization |
| `enhance` | boolean | — | Enable entry enhancement |
| `categorize` | boolean | — | Enable categorization |
| `releaseNotes` | boolean | — | Enable release note generation |

#### `notes.releaseNotes.llm.categories`

Array of category objects used for commit categorization. Each item has:

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `name` | string | — |  |
| `description` | string | — |  |
| `scopes` | `string[]` | — |  |

#### `notes.releaseNotes.llm.scopes`

Scope validation configuration.

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `mode` | `"restricted"` \| `"packages"` \| `"none"` \| `"unrestricted"` | `"unrestricted"` |  |

**`notes.releaseNotes.llm.scopes.rules`**

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `allowed` | `string[]` | — |  |
| `caseSensitive` | boolean | false |  |
| `invalidScopeAction` | `"remove"` \| `"keep"` \| `"fallback"` | `"remove"` |  |
| `fallbackScope` | string | — |  |

#### `notes.releaseNotes.llm.retry`

Retry behaviour for failed LLM requests.

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `maxAttempts` | integer | — | Maximum number of attempts |
| `initialDelay` | integer | — | Initial delay in ms |
| `maxDelay` | integer | — | Maximum delay in ms |
| `backoffFactor` | number | — | Delay multiplier per attempt |

#### `notes.releaseNotes.llm.prompts`

Override built-in prompt instructions per task.

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `instructions` | object | — | Per-task instruction overrides |
| `templates` | object | — | Per-task prompt template overrides |

---

## `ci`

CI automation configuration for release triggers, PR previews, and label management.


| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `releaseStrategy` | `"manual"` \| `"direct"` \| `"standing-pr"` \| `"scheduled"` | `"direct"` | How releases are delivered. 'direct': release on merge to main. 'manual': releases triggered manually (e.g. workflow_dispatch). 'standing-pr': changes accumulate in a release PR. 'scheduled': releases triggered on a schedule. |
| `releaseTrigger` | `"commit"` \| `"label"` | `"label"` | What triggers a release. 'label': a PR bump label (bump:patch/minor/major) is required. 'commit': conventional commits drive the bump automatically; every merge can trigger a release. |
| `prPreview` | boolean | true | Enable PR preview comments showing what would be released if the PR is merged. Set to false to disable. |
| `autoRelease` | boolean | false | Automatically trigger a release when CI conditions are met, without manual intervention. |
| `skipPatterns` | `string[]` | `["chore: release "]` | Commit message prefixes that suppress a release. The default matches the release commit template to prevent release loops. |
| `minChanges` | integer | 1 | Minimum number of packages with releasable changes required to trigger a release. |

### `ci.labels`

PR label names used for release control. Override to match your repository's label conventions.

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `stable` | string | `"release:stable"` | Label to graduate a prerelease to stable |
| `prerelease` | string | `"release:prerelease"` | Label to create a prerelease |
| `skip` | string | `"release:skip"` | Label to suppress a release on this PR |
| `major` | string | `"bump:major"` | Label to force a major bump |
| `minor` | string | `"bump:minor"` | Label to force a minor bump |
| `patch` | string | `"bump:patch"` | Label to force a patch bump |

### `ci.standingPr`

Configuration for the standing release PR feature (ci.releaseStrategy: 'standing-pr').

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `branch` | string | `"release/next"` | Branch name for the standing release PR. |
| `title` | string | `"chore: release ${count} package(s)"` | PR title template. Variables: ${count} (package count), ${version} (for single-package repos). Must start with 'chore: release' to match the default skip pattern on squash merge. |
| `labels` | `string[]` | `["release"]` | Labels to apply to the standing release PR. |
| `deleteBranchOnMerge` | boolean | true | Whether to auto-delete the release branch after the PR is merged. |
| `editableNotes` | boolean | false | Allow teams to edit the release notes section in the PR body before publishing. When enabled, the notes section is wrapped in editable markers and preserved across updates if manually changed. |
| `mergeMethod` | `"merge"` \| `"squash"` \| `"rebase"` | `"merge"` | Merge method to use when merging the standing release PR via CLI. |
| `minAge` | string | — | Minimum age of the standing PR before it can be merged. Duration string, e.g. '6h', '30m', '1d'. Gate enforced via the releasekit/standing-pr commit status check; configure it as a required status check in branch protection to block merges. |
| `minPackages` | integer | — | Minimum number of packages with releasable changes required to create or maintain the standing PR. Below this threshold the PR is closed and no new PR is opened. |

---

## `release`

Release pipeline automation configuration.


| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `steps` | `string[]` | — | Which steps to run by default. Omitting a step is equivalent to --skip-<step>. Allowed values: `"notes"`, `"publish"`. |

### `release.ci`

CI-specific automation settings.

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `skipPatterns` | `string[]` | — | Commit message prefixes that prevent a release (e.g. 'chore(deps):', 'ci:') |
| `minChanges` | integer | — | Minimum number of packages with releasable changes required to trigger a release |
| `githubRelease` | boolean | — | Set to false to disable GitHub release creation in CI |
| `notes` | boolean | — | Set to false to disable changelog generation in CI |

---

For the canonical machine-readable schema, see [releasekit.schema.json](https://goosewobbler.github.io/releasekit/schema.json).
