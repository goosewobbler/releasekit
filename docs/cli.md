# CLI Reference

ReleaseKit ships a unified `releasekit` command plus three standalone binaries. This page is a reference: one section per command with a flags table and a short example. For workflows and concepts, start with [Getting Started](./getting-started.md) and the [Architecture](./architecture.md) guide.

## Binaries

| Binary | Provided by | Commands |
|---|---|---|
| `releasekit` | `@releasekit/release` | `preview` (default), `release`, `standing-pr`, `init`, `version`, `notes`, `publish` |
| `releasekit-release` | `@releasekit/release` | `preview` (default), `release`, `standing-pr`, [`gate`](#releasekit-release-gate) |
| `releasekit-version` | `@releasekit/version` | `version` |
| `releasekit-notes` | `@releasekit/notes` | `notes` |
| `releasekit-publish` | `@releasekit/publish` | `publish` |

The `releasekit` dispatcher re-exports `version`, `notes`, and `publish`, so `releasekit version` and `releasekit-version` are equivalent. Examples below use `releasekit`.

> **Conventions:** `<value>` is required; `[value]` is optional. Boolean flags default to `false` unless noted. Every command accepts `--help`. `--version` prints the binary version.

---

## `releasekit preview`

Post a release preview comment on the current pull request. This is the default command, so `releasekit` with no arguments runs `preview`.

| Flag | Type | Default | Description |
|---|---|---|---|
| `-c, --config <path>` | string | auto-discovered | Path to config file |
| `--project-dir <path>` | string | `cwd` | Project directory |
| `--pr <number>` | string | auto | PR number (auto-detected from GitHub Actions) |
| `--repo <owner/repo>` | string | auto | Repository (auto-detected from `GITHUB_REPOSITORY`) |
| `-p, --prerelease [identifier]` | boolean \| string | auto | Force prerelease preview (auto-detected by default) |
| `--stable` | boolean | `false` | Force stable release preview (graduation from prerelease) |
| `-t, --target <packages>` | string | all | Target specific packages (comma-separated) |
| `-d, --dry-run` | boolean | `false` | Print the comment to stdout without posting (GitHub context not available in dry-run mode) |

```bash
releasekit preview --dry-run
```

---

## `releasekit release`

Run the full release pipeline: version, changelog, publish, git, and GitHub Release.

| Flag | Type | Default | Description |
|---|---|---|---|
| `-c, --config <path>` | string | auto-discovered | Path to config file |
| `-d, --dry-run` | boolean | `false` | Preview all steps without side effects |
| `-b, --bump <type>` | `patch` \| `minor` \| `major` \| `prerelease` | auto | Force bump type |
| `-p, --prerelease [identifier]` | boolean \| string | - | Create prerelease version |
| `--stable` | boolean | `false` | Graduate prerelease packages to stable without bumping |
| `-s, --sync` | boolean | `false` | Use synchronized versioning across all packages |
| `-t, --target <packages>` | string | all | Target specific packages (comma-separated) |
| `--include-prerequisites` | boolean | `false` | Also release the changed internal dependencies of `--target` packages (and the rest of their groups) |
| `--scope <name>` | string | - | Resolve scope name to target packages from `ci.scopeLabels` config |
| `--branch <name>` | string | current | Override the git branch used for push |
| `--npm-auth <method>` | `auto` \| `oidc` \| `token` | `auto` | NPM auth method |
| `--skip-notes` | boolean | `false` | Skip changelog generation |
| `--skip-publish` | boolean | `false` | Skip registry publishing and git operations |
| `--skip-git` | boolean | `false` | Skip git commit/tag/push |
| `--skip-github-release` | boolean | `false` | Skip GitHub release creation |
| `--skip-verification` | boolean | `false` | Skip post-publish verification |
| `-j, --json` | boolean | `false` | Output results as JSON |
| `-v, --verbose` | boolean | `false` | Verbose logging |
| `-q, --quiet` | boolean | `false` | Suppress non-error output |
| `--project-dir <path>` | string | `cwd` | Project directory |

`--stable` and `--prerelease` are mutually exclusive.

```bash
releasekit release --dry-run
```

---

## `releasekit standing-pr`

Manage the standing release PR (create/update or publish on merge). Pick a subcommand: `update`, `publish`, or `merge`. All three share these options:

| Flag | Type | Default | Description |
|---|---|---|---|
| `-c, --config <path>` | string | auto-discovered | Path to config file |
| `--project-dir <path>` | string | `cwd` | Project directory |
| `--npm-auth <method>` | `auto` \| `oidc` \| `token` | `auto` | NPM auth method |
| `-j, --json` | boolean | `false` | Output results as JSON |
| `-v, --verbose` | boolean | `false` | Verbose logging |
| `-q, --quiet` | boolean | `false` | Suppress non-error output |

### `releasekit standing-pr update`

Calculate versions, commit to the release branch, and create/update the standing PR.

| Flag | Type | Default | Description |
|---|---|---|---|
| `-t, --target <packages>` | string | labels | Ad-hoc override: release only these packages (comma-separated). Wins over label-derived targets |
| `--include-prerequisites` | boolean | `false` | With `--target`, also release the changed internal dependencies (and group members) of the targets |
| `--reconcile` | boolean | `false` | Bypass the skip-pattern guard so a post-release reconcile run still updates the standing PR (HEAD is a release commit at that point) |

```bash
releasekit standing-pr update --reconcile
```

### `releasekit standing-pr publish`

Publish packages from a merged standing release PR (reads the manifest from the PR comment).

| Flag | Type | Default | Description |
|---|---|---|---|
| `--pr <number>` | integer | auto | PR number of the merged standing release PR. When omitted, falls back to the `pull_request` event payload, then to the most recently merged standing PR via the GitHub API |

```bash
releasekit standing-pr publish --pr 123
```

### `releasekit standing-pr merge`

Merge the open standing release PR, optionally publishing immediately.

| Flag | Type | Default | Description |
|---|---|---|---|
| `--publish` | boolean | `false` | Publish packages immediately after merging |

```bash
releasekit standing-pr merge --publish
```

---

## `releasekit labels`

Create and reconcile the GitHub labels ReleaseKit relies on (`bump:*`, `channel:*`, `release:*`, configured `scope:*`, and the standing-PR labels). The label names honour `ci.labels` renames and `ci.scopeLabels`; descriptions and colours are canonical.

The repository is resolved from `--repo`, then `GITHUB_REPOSITORY`, then the `origin` git remote. The token is read from `GITHUB_TOKEN`, then `GH_TOKEN`.

### `releasekit labels sync`

Idempotently create every config-implied label that is missing from the repo. Existing labels are left untouched (a 422 "already exists" is ignored).

| Flag | Type | Default | Description |
|---|---|---|---|
| `-c, --config <path>` | string | auto-discovered | Path to config file |
| `--project-dir <path>` | string | `cwd` | Project directory |
| `--repo <owner/repo>` | string | auto | Repository (auto-detected from `GITHUB_REPOSITORY` or the `origin` remote) |
| `--check` | boolean | `false` | Report missing/misnamed labels and exit non-zero **without** making any changes |

`--check` makes no mutations and exits non-zero when any label is missing — wire it into CI to catch the silent typo'd-label failure mode (a mistyped `bump:minor` means nothing releases, with no error).

```bash
releasekit labels sync
releasekit labels sync --check   # CI guard: non-zero exit if labels are missing
```

---

## `releasekit init`

Create a default `releasekit.config.json`. Detects whether the project is a monorepo to choose the changelog mode. After writing the config it prints a next-steps checklist (run `labels sync`, do a `--dry-run`, link the CI guide).

| Flag | Type | Default | Description |
|---|---|---|---|
| `-f, --force` | boolean | `false` | Overwrite existing config |
| `--labels` | boolean | `false` | Also run `labels sync` to create the required GitHub labels (requires a GitHub token) |

`init` stays a local generator: it never touches the remote unless `--labels` is passed (and even then it falls back to the printed instructions if no token is available).

```bash
releasekit init
releasekit init --labels   # also create the GitHub labels (needs GITHUB_TOKEN)
```

---

## `releasekit version`

Version a package or packages based on configuration and conventional commits. Also available as the standalone `releasekit-version` binary.

| Flag | Type | Default | Description |
|---|---|---|---|
| `-c, --config <path>` | string | `releasekit.config.json` | Path to config file |
| `-d, --dry-run` | boolean | `false` | Dry run (no changes made) |
| `-b, --bump <type>` | `patch` \| `minor` \| `major` \| `prerelease` | auto | Specify bump type |
| `-p, --prerelease [identifier]` | boolean \| string | - | Create prerelease version |
| `--stable` | boolean | `false` | Graduate prerelease packages to stable without bumping |
| `-s, --sync` | boolean | config | Use synchronized versioning across all packages |
| `-j, --json` | boolean | `false` | Output results as JSON |
| `-t, --target <packages>` | string | all | Comma-delimited list of package names to target |
| `--include-prerequisites` | boolean | `false` | Also release the changed internal dependencies of `--target` packages (and the rest of their groups) |
| `--project-dir <path>` | string | `cwd` | Project directory to run commands in |

`--stable` and `--prerelease` are mutually exclusive. `--target` is ignored for single-package repos.

```bash
releasekit version --json --dry-run
```

---

## `releasekit notes`

Generate changelogs with optional LLM-powered enhancement and flexible templating. Also available as the standalone `releasekit-notes` binary. Subcommands: `generate` (default), `auth`, `providers`. See the [LLM providers guide](../packages/notes/docs/llm-providers.md) for provider setup.

### `releasekit notes generate`

Generate changelog from input data (a version-output JSON, read from a file or stdin). This is the default subcommand.

| Flag | Type | Default | Description |
|---|---|---|---|
| `-i, --input <file>` | string | stdin | Input file |
| `--no-changelog` | boolean | - | Disable changelog generation |
| `--changelog-mode <mode>` | `root` \| `packages` \| `both` | config | Changelog location mode |
| `--changelog-file <name>` | string | config | Changelog file name override |
| `--release-notes-dir <dir>` | string | config | Write per-version release-notes files to this directory |
| `--no-release-notes` | boolean | - | Disable release notes generation |
| `-t, --template <path>` | string | config | Template file or directory |
| `-e, --engine <engine>` | `handlebars` \| `liquid` \| `ejs` | config | Template engine |
| `--monorepo <mode>` | `root` \| `packages` \| `both` | config | Monorepo mode |
| `--llm-provider <provider>` | string | config | LLM provider |
| `--llm-model <model>` | string | config | LLM model |
| `--llm-base-url <url>` | string | config | LLM base URL (for `openai-compatible` provider) |
| `--llm-tasks <tasks>` | string | config | Comma-separated LLM tasks (`enhance`, `summarize`, `categorize`, `release-notes`) |
| `--no-llm` | boolean | - | Disable LLM processing |
| `--target <package>` | string | all | Filter to a specific package name |
| `--config <path>` | string | auto-discovered | Config file path |
| `--regenerate` | boolean | `false` | Regenerate entire changelog instead of prepending new entries |
| `--dry-run` | boolean | `false` | Preview without writing |
| `-v, --verbose` | count | `0` | Increase verbosity (repeatable: `-vv`, `-vvv`) |
| `-q, --quiet` | boolean | `false` | Suppress non-error output |

```bash
releasekit version --json | releasekit notes generate --dry-run
```

### `releasekit notes auth <provider>`

Configure the API key for an LLM provider.

| Flag | Type | Default | Description |
|---|---|---|---|
| `--key <key>` | string | prompt | API key (omit to be prompted) |

```bash
releasekit notes auth anthropic --key sk-...
```

### `releasekit notes providers`

List available LLM providers. Takes no flags.

```bash
releasekit notes providers
```

---

## `releasekit publish`

Publish packages to registries with git tagging and GitHub releases. Reads a version-output JSON from a file or stdin. Also available as the standalone `releasekit-publish` binary.

| Flag | Type | Default | Description |
|---|---|---|---|
| `--input <path>` | string | stdin | Path to version output JSON |
| `--config <path>` | string | auto-discovered | Path to releasekit config |
| `--registry <type>` | `npm` \| `cargo` \| `pub` \| `all` | `all` | Registry to publish to |
| `--npm-auth <method>` | `oidc` \| `token` \| `auto` | `auto` | NPM auth method |
| `--dry-run` | boolean | `false` | Simulate all operations |
| `--skip-git` | boolean | `false` | Skip git commit/tag/push |
| `--skip-publish` | boolean | `false` | Skip registry publishing |
| `--skip-github-release` | boolean | `false` | Skip GitHub Release creation |
| `--skip-verification` | boolean | `false` | Skip post-publish verification |
| `--json` | boolean | `false` | Output results as JSON |
| `--verbose` | boolean | `false` | Verbose logging |

```bash
releasekit version --json | releasekit publish --dry-run
```

---

## `releasekit-release gate`

The standalone `releasekit-release` binary (also from `@releasekit/release`) exposes an extra `gate` command used by the GitHub Action's `gate` mode. It checks whether a release should proceed based on PR labels and config.

| Flag | Type | Default | Description |
|---|---|---|---|
| `-c, --config <path>` | string | auto-discovered | Path to config file |
| `--scope <name>` | string | - | Resolve scope name to target packages from `ci.scopeLabels` config |
| `-j, --json` | boolean | `false` | Output results as JSON |
| `-v, --verbose` | boolean | `false` | Verbose logging |
| `-q, --quiet` | boolean | `false` | Suppress non-error output |
| `--project-dir <path>` | string | `cwd` | Project directory |

```bash
releasekit-release gate --json
```

> Most users run `gate` through the [GitHub Action](./action.md) (`mode: gate`) rather than the CLI directly.

## `releasekit-release backfill`

Regenerate release notes for **already-released** versions of one or more packages by reconstructing each version's notes from git history. Each version is rendered through the notes pipeline and written to per-version files (`notes.releaseNotes.file.dir`), to the matching GitHub release bodies (`--update-releases`), or both. Dry-run by default — pass `--apply` to write. Needs at least one output: `notes.releaseNotes.file.dir` set, `--update-releases`, or both.

| Flag | Type | Default | Description |
|---|---|---|---|
| `-p, --package <name>` | string | package.json name at `--path` | Package to backfill |
| `--path <dir>` | string | `.` | Package directory |
| `--all` | boolean | `false` | Backfill every package in the workspace (monorepo discovery) |
| `--from <version>` | string | - | Earliest version to backfill (inclusive) |
| `--to <version>` | string | - | Latest version to backfill (inclusive) |
| `--update-releases` | boolean | `false` | Update matching GitHub release bodies via `gh release edit` |
| `--only-missing` | boolean | `false` | With `--update-releases`, skip releases already carrying releasekit notes |
| `--apply` | boolean | `false` | Apply changes (default: dry-run preview) |
| `-c, --config <path>` | string | auto-discovered | Path to config file |

```bash
# Preview what would be regenerated
releasekit-release backfill --package @scope/pkg --path packages/pkg

# Write the per-version files
releasekit-release backfill --package @scope/pkg --path packages/pkg --apply

# Backfill every package in the workspace
releasekit-release backfill --all --apply

# Update GitHub release bodies, filling only the gaps
releasekit-release backfill --package @scope/pkg --update-releases --only-missing --apply
```

`--all` discovers every package a release would version — npm/JS workspaces, pure-Cargo crates, and pubspec-only Dart/Flutter packages, scoped by `version.packages` — using the version stage's own discovery, and backfills each; packages with no matching tags are skipped. It is mutually exclusive with `--package`. Tags are resolved per package (package-specific) or from the shared global series (sync/single), and each package's notes are scoped to its own directory's commits.

`--update-releases` edits existing releases only (it never creates them) and skips any tag without a release. Backfilled bodies carry a `<!-- releasekit-notes -->` marker: `--only-missing` skips releases that already have it (so re-runs fill only new gaps), while the default run refreshes every targeted body, including auto-generated or previously backfilled ones.

> **Experimental (#293).** Backfills a single package or, with `--all`, every package a release would version — npm/JS workspaces, pure-Cargo crates, and pubspec-only Dart/Flutter packages. Works with both package-specific tags (`pkg@v1.2.0`, `version.packageSpecificTags: true`) and the global sync/single tag series (`v1.2.0`), and dates each version from its tag's commit date. LLM range caching and the Action surface are planned follow-ups.
