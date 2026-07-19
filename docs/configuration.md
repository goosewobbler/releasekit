<!-- AUTO-GENERATED FROM releasekit.schema.json — DO NOT EDIT DIRECTLY -->
<!-- Run `pnpm docs:config` to regenerate -->

# Configuration Reference

ReleaseKit is configured via a `releasekit.config.json` file in the root of your repository. Add a `$schema` reference for editor autocompletion:

```json
{
  "$schema": "https://goosewobbler.github.io/releasekit/schema.json"
}
```

Comments are supported. You can use `//` line comments and `/* … */` block comments, and trailing commas are allowed. To stop your editor from flagging comments as JSON errors, name the file `releasekit.config.jsonc` instead — both filenames are discovered automatically, with `.json` taking precedence when both are present.

```jsonc
{
  // editor autocompletion + comment support
  "$schema": "https://goosewobbler.github.io/releasekit/schema.json",
  "publish": {
    "npm": { "enabled": true } // publish to npm
  }
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
| `rootPath` | string | — | Path to root changelog |
| `packagesPath` | string | — | Path to packages directory |

---

## `version`

Versioning configuration.

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `tagTemplate` | string | `"${prefix}${version}"` | Template for Git tags. Available variables: ${version} (version number), ${prefix} (versionPrefix value, e.g. 'v'), ${packageName} (sanitized package name, e.g. 'scope-pkg'). Example: "${packageName}-${prefix}${version}" produces "scope-pkg-v1.2.3". |
| `baselineTagTemplate` | string | — | Optional secondary tag template for an internal 'baseline' marker that records the release commit on the source branch. Use this when tagTemplate resolves to a tag that gets force-moved off the source branch by a downstream step (e.g. a GitHub Action distributing built artifacts at the version tag) — the baseline tag stays on the release commit so future version-bump and changelog calculations can still find the previous release. Must contain a ${version} placeholder so the baseline prefix can be derived. Supports the same variables as tagTemplate. Example: "release/${prefix}${version}" produces "release/v1.2.3". |
| `packageSpecificTags` | boolean | `false` | Enable package-specific tagging |
| `preset` | string | `"conventional"` | Commit convention preset |
| `sync` | boolean | `true` | Global lockstep versioning. true is sugar for one implicit fixed group of every package — it shares the same mechanism as version.groups. Set to false when using version.groups; sync: true alongside groups is treated as the implicit all-packages fixed group taking precedence (a config conflict, warned about at runtime). |
| `packages` | `string[]` | `[]` | Packages to include in versioning |
| `sharedPackages` | `string[]` | — | Foundational packages whose changes belong in every package’s changelog. A commit touching only a shared package (exact name or glob) is classified as repo-level and surfaced under "Project-wide changes" rather than attributed to that one package. Default: none — no package is treated as shared unless declared. |
| `sharedChangelogFloor` | `"union"` \| `"sinceLastRelease"` | `"union"` | How the "Project-wide changes" block is bounded in package-specific-tag mode. "union" (default): repo-level commits accrue from the union of the releasing packages' ranges, floored by the OLDEST unreleased baseline — so a genuinely-global commit recurs in every release until the oldest-baselined package is released past it. "sinceLastRelease": floor the block by the single nearest tag reachable across the repo, so global commits already shown by the most recent release don't recur (recommended for per-package-tag monorepos). No effect in sync mode, where one shared tag already consumes repo-level commits on each release. |
| `mainPackage` | string | — | Package to use for version determination |
| `skip` | `string[]` | — | Packages to exclude from versioning (glob patterns or exact names). Private packages ("private": true) are skipped automatically — see includePrivate — so they do not need to be listed here. |
| `includePrivate` | boolean | `false` | Include npm packages marked "private": true (in package.json) in the release flow. Default false: private packages are skipped at discovery — they cannot be published to any registry, mirroring the Cargo `publish = false` and pub `publish_to: none` skips already applied during discovery. Set true to version a private package for internal tracking. Packages explicitly named in version.packages are always included regardless of this setting. |
| `commitMessage` | string | — | Template for release commit messages |
| `mismatchStrategy` | `"error"` \| `"warn"` \| `"ignore"` \| `"prefer-package"` \| `"prefer-git"` | `"warn"` | How to handle version mismatches |
| `versionPrefix` | string | `""` | Prefix for version tags |
| `prereleaseIdentifier` | string | — | Identifier for prerelease versions (e.g., 'alpha', 'beta') |
| `allowFirstBump` | boolean | `false` | Acknowledge applying a bump on a first release with an already-stable manifest. On a first release (no prior tag), `--stable --bump <type>` applies the bump (e.g. 1.0.0 → 2.0.0) rather than graduating, which can silently overshoot the staged first version. By default this is flagged per `mismatchStrategy` (warn, or abort under "error"); set true (or pass --allow-first-bump) to apply the bump silently — legitimate when importing a package with prior external version history. |
| `strictReachable` | boolean | `false` | Only use reachable tags |
| `zeroMajor` | `"spec"` \| `"strict"` | `"spec"` | Pre-1.0 handling of commit-inferred breaking changes. 'spec' (default): bump the 0.x minor (0.24.0 → 0.25.0), per semver §4. 'strict': bump the next major (→ 1.0.0). Inferred path only — explicit overrides (--bump major, bump:major) always graduate to 1.0.0. |
| `npm` | object | — | npm/JavaScript version handling |
| `pub` | object | — | Dart/Flutter pub configuration |

### `version.zeroMajor`

How a **commit-inferred** breaking change (`feat!:` / `BREAKING CHANGE:`) bumps a pre-1.0 version (current major `0`):

- `"spec"` (default): bumps the 0.x minor — `0.24.0` → `0.25.0`. Per [semver §4](https://semver.org/#spec-item-4); also matches npm caret (`^0.24.0` excludes `0.25.0`), Cargo, and changesets.
- `"strict"`: bumps the next major — `0.24.0` → `1.0.0` (the semantic-release convention).

Inferred path only. Explicit overrides (`--bump major`, `bump:major` on the standing PR, `release:immediate` + `bump:major` on a feeder PR) always graduate to `1.0.0` — cutting 1.0 stays a deliberate act.

### `version.groups`

Named version groups let a co-evolving family of packages version together while the rest
of the monorepo versions independently. Groups are one of three release-coordination
mechanisms — see the [release taxonomy](./release-taxonomy.md) for groups vs. derived
prerequisites vs. selection. Each entry under `groups` is a group name mapping to
`{ packages, sync }`, where `packages` is a list of patterns (same matching as
`version.packages`) and `sync` is one of:

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `packages` | `string[]` | — | Package patterns (exact names, @scope/*, or globs) whose matched packages form this group. Same matching rules as version.packages. |
| `sync` | `"fixed"` \| `"linked"` \| `"independent"` | — | fixed: all members release together at the shared group version. linked: only changed members release, all at the same computed version. independent: only changed members release, each on its own commit-driven version line (no shared version), but the set ships atomically. |

- **`fixed`** — any releasable change in *any* member releases **all** members at the shared
  group version, computed as `bump(max(member baselines))`. This is the changesets `fixed`
  semantics. The global `version.sync: true` flag is exactly this, applied to one implicit
  group of every package — there is one mechanism, not two.
- **`linked`** — only members with a releasable change release, but every releasing member
  shares the same computed version. Unchanged members are left untouched (no empty re-release).
- **`independent`** — only members with a releasable change release, each on its **own**
  commit-driven version line (no shared group version). The set is still atomic: targeting any
  member pulls in the whole group, and dropping a changed member (via `config.skip`) warns. Use
  this for packages coupled by a contract but versioned separately (e.g. a wire protocol across
  an npm package and a Rust crate on different version lines).

**Group baseline** is the highest member version found in tags / manifests; the group bumps
from there.

> **Member adoption.** A member below the group baseline — never released, or at an older version
> than the family — adopts the group version on its next release (joining a family at `2.3.0`
> releases at `2.4.0`, skipping its own `1.x` line), overriding the per-package "initial version
> from `package.json`" rule. The version step warns when the jump skips versions.

**`--target` and atomic groups.** Targeting a strict subset of an atomic group (`fixed` or
`independent`) expands to the whole group, so it never silently splits. `linked` groups and
ungrouped packages honor targets as-is.

**Workspace pins.** Intra-group `workspace:*` dependencies resolve to the group version within a
run, so a fixed group publishes internally consistent.

### `version.npm`

npm/JavaScript version handling.

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `enabled` | boolean | `true` | Version package.json manifests. Detected npm packages are versioned by default; set false to opt out (e.g. npm versioning handled elsewhere). |

### `version.cargo`

Cargo/Rust configuration.

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `enabled` | boolean | `true` | Version Cargo.toml manifests. Detected Rust packages are versioned by default; set false to opt out (e.g. a vendored crate, or Rust versioning handled elsewhere). |
| `paths` | `string[]` | — | Directories to search for Cargo.toml files |

---

## `publish`

Publishing configuration.


### `publish.git`

Git publishing options.

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `push` | boolean | — | Push tags and commits to remote. When unset, inherits the top-level git.push (which defaults to push). |
| `pushMethod` | `"auto"` \| `"ssh"` \| `"https"` | — | Push method override |
| `remote` | string | — | Remote name override |
| `branch` | string | — | Branch name override |
| `httpsTokenEnv` | string | — | Environment variable name containing a GitHub token for HTTPS pushes |
| `skipHooks` | boolean | — | Skip Git hooks when committing |

### `publish.npm`

NPM publishing configuration.

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `enabled` | boolean | `true` | Publish to npm. Detected npm packages are published by default; set false to opt out (version and tag only). |
| `auth` | `"auto"` \| `"oidc"` \| `"token"` | `"auto"` | Authentication method |
| `provenance` | boolean | `true` | Enable npm provenance attestation |
| `access` | `"public"` \| `"restricted"` | `"public"` | Package access level |
| `registry` | string | `"https://registry.npmjs.org"` | NPM registry URL |
| `copyFiles` | `string[]` | `["LICENSE"]` | Files to copy to package before publishing |
| `tag` | string | `"latest"` | NPM dist tag |
| `publishOrder` | `string[]` | `[]` | Explicit publish order for npm packages; empty auto-sorts dependencies first |

### `publish.cargo`

Cargo publishing configuration.

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `enabled` | boolean | `true` | Publish to crates.io. Detected Rust packages are published by default; set false to opt out (version and tag only). |
| `noVerify` | boolean | `false` | Skip verification before publish |
| `publishOrder` | `string[]` | `[]` | Order in which to publish packages |
| `clean` | boolean | `false` | Clean before publishing |

### `publish.pub`

Dart/Flutter publishing configuration via pub.

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `enabled` | boolean | `true` | Publish to pub.dev. Detected Dart/Flutter packages are published by default; set false to opt out (version and tag only). |
| `publishOrder` | `string[]` | `[]` | Order in which to publish packages |

### `publish.githubRelease`

GitHub Release configuration.

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `enabled` | boolean | `true` | Enable GitHub releases |
| `draft` | boolean | `true` | Create as draft release |
| `perPackage` | boolean | `true` | Create separate release per package |
| `prerelease` | boolean \| `"auto"` | `"auto"` | Mark as prerelease |
| `body` | `"auto"` \| `"releaseNotes"` \| `"changelog"` \| `"generated"` \| `"none"` | `"auto"` | Source for GitHub release body. 'auto': use release notes if enabled, else changelog, else GitHub auto. 'releaseNotes': use LLM-generated release notes. 'changelog': use changelog entries. 'generated': GitHub auto-generated. 'none': no body. |
| `titleTemplate` | string | `"${packageName}: ${version}"` | Template for the GitHub release title when a package name is resolved. Available variables: ${packageName} (original scoped name, e.g. '@scope/pkg'), ${version} (e.g. 'v1.0.0'). Version-only tags always use the tag string directly. |
| `skipPackages` | `string[]` | `[]` | Package names to exclude from GitHub release creation |

### `publish.verify`

Registry verification configuration.


#### `publish.verify.npm`

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `enabled` | boolean | `true` | Verify NPM publish |
| `maxAttempts` | integer | `5` | Maximum verification attempts |
| `initialDelay` | integer | `15000` | Initial delay in milliseconds |
| `backoffMultiplier` | number | `2` | Exponential backoff multiplier |

#### `publish.verify.cargo`

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `enabled` | boolean | `true` | Verify Cargo publish |
| `maxAttempts` | integer | `10` | Maximum verification attempts |
| `initialDelay` | integer | `30000` | Initial delay in milliseconds |
| `backoffMultiplier` | number | `2` | Exponential backoff multiplier |

#### `publish.verify.pub`

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `enabled` | boolean | `true` | Verify Dart pub publish |
| `maxAttempts` | integer | `10` | Maximum verification attempts |
| `initialDelay` | integer | `30000` | Initial delay in milliseconds |
| `backoffMultiplier` | number | `2` | Exponential backoff multiplier |

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
| `refs` | `"strip"` \| `"escape"` \| `"link"` | `"link"` | How `#NNN` issue/PR refs in the changelog are rendered. Applies to the whole entry — both the appended label and any bare `#N` carried over from the commit subject into the description (a description ref that also appears in the appended label is de-duplicated away). 'link' (default): the PR and the issues it closed are labelled as `(PR #503 · closes #500)`, where the PR links to its canonical /pull/ URL with `PR #503` as the visible text — this keeps the GitHub hovercard but stops the bare-token rich inline card that duplicated the entry; closed issues link to /issues/. An entry with no identifiable PR (a non-squash commit, or a non-GitHub repo) falls back to a plain ref list. 'escape': plain text \\#NNN (no link, no hovercard, no PR/closes labelling). 'strip': refs are removed entirely. Scoped-package / @user mentions in entry text are always neutralised regardless of this setting. |
| `demoteScopes` | `string[]` | `["deps"]` | Conventional-commit scopes whose changelog entries are demoted into a trailing "Dependencies & version bumps" subsection instead of interleaving with Added / Fixed / Changed. Applies to the standing-PR changelogs — each releasable row and the "Show all changes" footer. Nothing is hidden or dropped: low-signal dependency bumps just stop crowding the user-facing changes at the top, and a reader who wants the exact per-package deps expands the subsection. The de-duplicated change count is unchanged. Default: ["deps"]. Set to [] to render every scope inline. |

**`notes.changelog.templates`** — Template configuration for changelog.

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `path` | string | — | Path to custom template |
| `engine` | `"handlebars"` \| `"liquid"` \| `"ejs"` | — | Template engine |

### `notes.releaseNotes`

Set to `false` to disable.

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `file` | object | — | Optional in-repo file output. Omit to keep release notes only on the GitHub release body (the default). When set, writes one immutable Markdown file per version under `dir` — release-notes/<package>/<version>.md in a monorepo, release-notes/<version>.md in a single-package repo — giving a browsable, provider-independent per-release history. |
| `links` | object | — | Extra links to append to the release notes. |
| `firstRelease` | `false` \| object | — | First-release placeholder intro, shown when a package has no prior version (previousVersion is null). Default-on with a factual line; set to false to disable. |

**`notes.releaseNotes.templates`** — Template for rendering release notes (e.g. to add docs-site frontmatter). Takes precedence over LLM prose and the default formatted section.

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
| `examples` | integer | `3` | Number of few-shot examples to include in LLM prompts (0–5). |
| `context` | object | — | Additional context sources for the LLM. |
| `categoryOrder` | `string[]` | — | Explicit ordering of categories in the output. Categories not listed retain their configured order after the listed ones. |
| `cache` | boolean | `false` | Cache LLM responses on disk (under the OS temp dir), keyed by a hash of the provider, model, prompt, and request options. A re-run or backfill with the same inputs reuses the cached generation instead of re-calling the provider. Off by default. |

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
| `name` | string | — | Category label shown in release notes (e.g. 'Features') |
| `description` | string | — | LLM instruction describing what commits belong in this category |
| `scopes` | `string[]` | — | Conventional commit scopes assigned to this category |

#### `notes.releaseNotes.llm.scopes`

Scope validation configuration.

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `mode` | `"restricted"` \| `"packages"` \| `"none"` \| `"unrestricted"` | `"unrestricted"` | Scope allowlist source: 'restricted' uses rules.allowed, 'packages' derives scopes from workspace package names, 'none' strips all scopes, 'unrestricted' allows any scope |

**`notes.releaseNotes.llm.scopes.rules`**

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `allowed` | `string[]` | — | Explicit list of valid scope names; commits with unlisted scopes trigger invalidScopeAction |
| `caseSensitive` | boolean | `false` | Whether scope comparison is case-sensitive |
| `invalidScopeAction` | `"remove"` \| `"keep"` \| `"fallback"` | `"remove"` | Action for commits whose scope is not in the allowed list: 'remove' strips the scope, 'keep' leaves it, 'fallback' substitutes fallbackScope |
| `fallbackScope` | string | — | Scope substituted when invalidScopeAction is 'fallback' |

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
| `instructions` | object | — | Per-task instruction overrides appended to the built-in prompts. |

---

## `ci`

CI automation configuration for release triggers, PR previews, and label management.


| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `releaseStrategy` | `"manual"` \| `"direct"` \| `"standing-pr"` | `"direct"` | How releases are delivered. 'direct': release on merge to main. 'manual': releases triggered manually (e.g. workflow_dispatch). 'standing-pr': changes accumulate in a release PR; gate mode acts as the immediate-release evaluator, firing only for merges labelled with the immediate label. |
| `releaseTrigger` | `"commit"` \| `"label"` | `"label"` | What triggers a release. 'label': a PR bump label (bump:patch/minor/major) is required. 'commit': conventional commits drive the bump automatically; every merge can trigger a release. |
| `scopeLabels` | object | — | Map of scope labels to package patterns. When a PR has a label matching a key, only packages matching the corresponding pattern are released. |

### `ci.prPreview`

PR preview comments showing what would be released if the PR is merged. `true`/`false` toggles them; the object form additionally enables `refreshAfterRelease` to refresh feeder-PR previews after a release.

Set to `false` to disable.

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `enabled` | boolean | `true` | Whether PR preview comments are posted. |
| `refreshAfterRelease` | boolean | `false` | After a release completes, replay the preview comment on still-open feeder PRs so their "what would release" estimate is not left stale against the moved baseline. Cosmetic and best-effort — a failure here never fails the release. Driven automatically in-process after a successful release (both the direct and standing-PR publish paths); the standalone `refresh-after-release` command also performs it for setups that run it as a separate step. |


### `ci.labels`

PR label names used for release control. Override to match your repository's label conventions.

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `graduate` | string | `"release:graduate"` | Label that graduates a prerelease to its stable base version (e.g. 1.0.0-next.6 → 1.0.0). A standalone release trigger in label/direct mode; in standing-pr mode it sets the next merge to graduate. |
| `graduatePackagePrefix` | string | `"graduate:"` | Prefix for per-package graduate labels on the standing PR. A `graduate:<package>` label graduates just that prerelease package (and, atomically, any fixed/linked group it belongs to) to its stable base version on the next update, while other prerelease packages stay on their line. The whole-batch `graduate` label still graduates everything. Standing-pr mode only. |
| `prerelease` | string | `"channel:prerelease"` | Label to create a prerelease |
| `skip` | string | `"release:skip"` | Label to suppress a release on this PR |
| `immediate` | string | `"release:immediate"` | Label to bypass the standing PR for one merge — triggers a direct release. Standing-pr mode only. |
| `retry` | string | `"release:retry"` | Label to retry a failed publish by re-applying it to a merged standing PR. Standing-pr mode only. |
| `previewNotes` | string | `"release:preview-notes"` | Label on the standing PR that generates LLM release notes on demand into an editable region in the PR body, for review and editing before merge. Standing-pr mode only. |
| `major` | string | `"bump:major"` | Label to force a major bump |
| `minor` | string | `"bump:minor"` | Label to force a minor bump |
| `patch` | string | `"bump:patch"` | Label to force a patch bump |
| `withPrerequisites` | string | `"release:with-prerequisites"` | Label on the standing PR that also releases the changed prerequisites (transitive internal dependencies) of the targeted/scoped packages — each at its own commit-driven bump. Standing-pr mode only. |

### `ci.standingPr`

Configuration for the standing release PR feature (ci.releaseStrategy: 'standing-pr').

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `branch` | string | `"release/next"` | Branch name for the standing release PR. |
| `title` | string | — | PR title template. Variables: ${count} (publishable package count), ${version} (raw version), ${tag} (version with tag prefix). Must start with 'chore: release' to match the default skip pattern on squash merge. Default depends on the versioning strategy: 'chore: release ${tag}' in sync mode, 'chore: release ${count} package(s)' otherwise. |
| `labels` | `string[]` | `["release"]` | Labels to apply to the standing release PR. |
| `deleteBranchOnMerge` | boolean | `true` | Whether to auto-delete the release branch after the PR is merged. |
| `mergeMethod` | `"merge"` \| `"squash"` \| `"rebase"` | `"merge"` | Merge method to use when merging the standing release PR via CLI. |
| `minAge` | string | — | Minimum age of the standing PR before it can be merged. Duration string, e.g. '6h', '30m', '1d'. Gate enforced via the releasekit/standing-pr commit status check; configure it as a required status check in branch protection to block merges. |
| `minPackages` | integer | — | Minimum number of packages with releasable changes required to create or maintain the standing PR. Below this threshold the PR is closed and no new PR is opened. |
| `authorization` | object | — | Restrict who can steer the standing PR — its selection checkboxes, per-row channel toggles, release labels, and merge. Omit to allow anyone with the GitHub permission GitHub itself requires for each action (today’s behavior). |
| `primaryPackages` | `string[]` | `[]` | Packages that drive releases — rendered as parent rows in the standing-PR selection list, with their coupled group-mates and changed prerequisites nested beneath, so one parent toggle holds back the whole release unit. Glob patterns or exact names. Empty (default) → flat per-package list (current behavior). |
| `selection` | `"streamlined"` \| `"granular"` | `"streamlined"` | How the selection list renders when primaryPackages is set. streamlined: one checkbox per primary, coupled members shown read-only in a collapsed pane, and a held-back primary cascades to its unit. granular: every package keeps its own checkbox, nested under its primary, with no cascade. No effect when primaryPackages is empty. |
| `combinedChangelogFooter` | boolean | `true` | Append the de-duplicated combined-changelog footer to the standing PR: every change listed once, flat across packages and grouped by change type (Added/Fixed/Changed). It complements the per-row changelogs co-located with each releasable row. Set false to suppress this redundant per-package summary — the per-row changelogs remain, project-wide (shared) changes are still shown in their own block, and sync releases (which have no per-row changelogs) always show the combined changelog regardless of this setting. |
| `channelToggle` | boolean | `false` | Add a per-row channel toggle to the standing-PR selection list: a nested checkbox under each releasable row to ship a stable package as a prerelease (→ X.Y.Z-next.0 on the `next` dist-tag) or graduate a prerelease package to its stable base — shifting just that package (and its group) without narrowing the release. Off by default so repos that do not need it keep the tight one-line-per-package list. A held-back (unticked) row hides its channel toggle. No effect on sync releases (which ship atomically as one unit). |
| `summaryTable` | boolean | `false` | Render a collapsed "Version summary" table near the top of the standing PR: one row per publishing package showing its current version, next version, bump magnitude, and dist-tag. A scannable from → to overview (the Dependabot mental model) that complements the interactive checkbox list — which GitHub only renders as a list, never in a table cell. Off by default. |

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
